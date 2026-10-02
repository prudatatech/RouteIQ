/**
 * margixindia — The HSN master in memory, and the layered fuzzy search over it.
 *
 * Ported from frontend/src/utils/hsnDatabase.ts. Exact matches (code, keyword, description word) win; typo and
 * similar-spelling hits only show when none exist. Layers, in order of weight: HSN code prefix, exact keyword,
 * keyword starts-with, keyword contains, description word, description word prefix, description substring,
 * Levenshtein typo tolerance and bigram similarity. Hindi and everyday words ("clothes", "chawal") are expanded to the
 * words the master uses first. Among equal matches a curated row (keywords, synonyms) and a heading come before a long
 * tariff-item text. The full official list is about 22,000 codes, so a word index narrows each search to the entries
 * that can match. Nothing here needs pg_trgm. Up to 8 hits come back (PRD 3.2).
 */
import { supabase } from '../../core/supabase';
import { memoize } from '../../core/memo';

export const HSN_CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_HSN_HITS = 8;

/** A row of public.hsn_codes. */
export interface HsnRow {
  hsn_code: string;
  description: string;
  gst_rate: number | string | null;
  gst_rates?: Array<number | string> | null;
  rate_note?: string | null;
  category?: string | null;
  keywords?: string[] | null;
  synonyms?: string[] | null;
  is_hazmat?: boolean | null;
  is_perishable?: boolean | null;
  eway_always?: boolean | null;
  is_active?: boolean | null;
}

export interface HsnEntry {
  hsn_code: string;
  /** As stored (the official list is mostly in capitals) */
  description: string;
  /** For the screen: sentence case, with the heading in front of a bare "Other" */
  display: string;
  category: string | null;
  /** The default rate */
  gst_rate: number;
  /** Every applicable rate; more than one means the customer picks */
  gst_rates: number[];
  rate_note: string | null;
  is_hazmat: boolean;
  is_perishable: boolean;
  eway_always: boolean;
  /** keywords and synonyms, lower-case */
  terms: string[];
  descWords: string[];
  /** Has keywords or synonyms (hand-curated) */
  curated: boolean;
}

/** What the public search returns for each hit. */
export interface HsnHit {
  hsn_code: string;
  description: string;
  category: string | null;
  gst_rates: number[];
  rate_note: string | null;
  is_hazmat: boolean;
  is_perishable: boolean;
}

export interface HsnIndex {
  entries: HsnEntry[];
  byCode: Map<string, HsnEntry>;
  /** word (singular) -> positions in `entries` */
  postings: Map<string, number[]>;
  vocabulary: string[];
  /** positions of the curated entries */
  curated: number[];
}

// Everyday, Hindi and regional words -> the words the master uses
export const SYNONYM_MAP: Record<string, string[]> = {
  // Clothing
  clothes: ['garments', 'apparel', 'clothing'], clothing: ['garments', 'apparel'], cloth: ['fabric', 'textile'], kapde: ['garments', 'clothes'],
  dress: ['garments'], garment: ['garments'], shirts: ['shirt'], readymade: ['garments'],
  // Food
  chawal: ['rice'], gehu: ['wheat'], atta: ['flour', 'wheat flour'], cheeni: ['sugar'], shakkar: ['sugar'], gur: ['jaggery', 'sugar'],
  doodh: ['milk'], ghee: ['butter', 'milk'], makhan: ['butter', 'cream'], sabzi: ['vegetables'], pyaaz: ['onion'], tamatar: ['tomato'],
  lehsun: ['garlic'], adrak: ['ginger'], aloo: ['potato'], nimbu: ['lemon', 'lime'], santra: ['orange'], kela: ['banana'],
  aam: ['mango'], chai: ['tea'], daal: ['dal', 'lentil'], mirch: ['chilli', 'pepper'], haldi: ['turmeric'], kesar: ['saffron'],
  sarso: ['mustard'], til: ['sesame'], moongfali: ['groundnut', 'peanut'], kapas: ['cotton'], kapda: ['cloth', 'fabric', 'textile'],
  tambaku: ['tobacco'], supari: ['betel nut'], masala: ['spice', 'condiment'], namak: ['salt'],
  // Medicine
  medicines: ['medicine'], dawai: ['medicine'], dawa: ['medicine'], tablets: ['tablet'],
  // Product aliases
  phones: ['phone', 'smartphone'], drinks: ['beverages'], drink: ['beverages'], laptop: ['computer', 'data processing'],
  computer: ['data processing'], tmt: ['bars', 'rods', 'steel'], tyre: ['tyres'], cycle: ['bicycle'],
  ac: ['air conditioner'], tv: ['television'], pc: ['computer'], mobile: ['smartphone', 'phone'], fridge: ['refrigerator'],
  bike: ['motorcycle'], scooter: ['motorcycle'], scooty: ['motorcycle'], bulb: ['led bulb', 'lamp'], fan: ['electric fan'],
  cooler: ['air cooler'], heater: ['water heater'], charger: ['power supply', 'converter'],
  earphones: ['earphone', 'headphone'], buds: ['earbuds', 'earphone'], pendrive: ['usb', 'storage device'], harddisk: ['hard drive', 'ssd'],
  // Construction and industrial
  saria: ['tmt bar', 'rebar', 'steel bar'], gitti: ['gravel', 'aggregate'], bajri: ['sand', 'gravel'], lakdi: ['wood', 'timber'],
  ply: ['plywood'], pipe: ['steel pipe', 'pvc pipe'], taar: ['wire', 'cable'], eent: ['brick'], seement: ['cement'],
  // Packaging
  dabba: ['box', 'container'], bori: ['bag', 'sack'], thela: ['cart'], peti: ['carton', 'box'],
};

const splitWords = (s: string) => s.toLowerCase().split(/[^a-z0-9%.-]+/).map(w => w.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean);

/** "phones" -> "phone", "tomatoes" -> "tomato": plurals meet their singular in the word index. */
const stemWord = (w: string): string => {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
};

const rateOf = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

// Abbreviations kept in capitals when an all-caps description is turned into a sentence
const KEEP_CAPS = new Set(['lpg', 'cng', 'lng', 'pvc', 'led', 'lcd', 'oled', 'tv', 'dvd', 'cd', 'usb', 'pcb', 'hdpe', 'ldpe', 'uht', 'dna',
  'rna', 'npk', 'dap', 'atf', 'sko', 'hsd', 'gi', 'crgo', 'crno', 'rcc', 'abs', 'sbr', 'epdm', 'pet', 'ups', 'ac', 'dc', 'ic', 'cpu', 'gsm', 'ii', 'iii', 'iv']);

/**
 * The official list writes most descriptions in capitals ("PORTLAND CEMENT, ALUMINOUS CEMENT"). This turns them into a
 * sentence ("Portland cement, aluminous cement") for the screen; descriptions already in mixed case stay as they are.
 */
export function readableDescription(raw: string): string {
  const s = (raw ?? '').replace(/_x000D_/g, ' ').replace(/~/g, ' - ').replace(/\s+/g, ' ').trim();
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = s.replace(/[^A-Z]/g, '');
  if (!letters || upper.length / letters.length < 0.8) return s;
  const lower = s.toLowerCase()
    .replace(/[a-z]+/g, w => (KEEP_CAPS.has(w) ? w.toUpperCase() : w))
    .replace(/\bis (\d)/g, 'IS $1');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "Other", "Of bamboo", "For tractors": a tariff-item text that only means something under its heading. */
const isBareText = (d: string) => /^(other|others|of |for |in |with |not |containing |put up|bleached|unbleached|dyed|printed|grey|fresh|frozen|dried)/i.test(d.trim()) || d.trim().length < 12;

export function toEntry(row: HsnRow): HsnEntry {
  const base = rateOf(row.gst_rate) ?? 0;
  const list = (row.gst_rates ?? []).map(rateOf).filter((n): n is number => n != null);
  const rates = list.length ? [...new Set(list)] : [base];
  const terms = [...new Set([...(row.keywords ?? []), ...(row.synonyms ?? [])].map(k => k.toLowerCase().trim()).filter(Boolean))];
  return {
    hsn_code: row.hsn_code,
    description: row.description,
    display: readableDescription(row.description),
    category: row.category ?? null,
    gst_rate: base,
    gst_rates: rates,
    rate_note: row.rate_note ?? null,
    is_hazmat: !!row.is_hazmat,
    is_perishable: !!row.is_perishable,
    eway_always: !!row.eway_always || !!row.is_hazmat,
    terms,
    descWords: splitWords(row.description),
    curated: terms.length > 0,
  };
}

/**
 * The index: every entry, the codes, and an inverted index from each word (of a description, a keyword or a
 * synonym, singular form) to the entries that use it, so a search touches only the entries that can match.
 */
export function buildHsnIndex(rows: HsnRow[]): HsnIndex {
  const entries = rows.filter(r => r.is_active !== false && r.hsn_code && r.description).map(toEntry);
  const byCode = new Map(entries.map(e => [e.hsn_code, e]));
  const postings = new Map<string, number[]>();
  const add = (w: string, i: number) => {
    const list = postings.get(w);
    if (!list) postings.set(w, [i]);
    else if (list[list.length - 1] !== i) list.push(i);
  };
  entries.forEach((e, i) => {
    // A bare tariff-item text ("Other") reads better with its heading in front: "Rice - other"
    if (e.hsn_code.length > 4 && isBareText(e.display)) {
      for (const len of [6, 4]) {
        const parent = len < e.hsn_code.length ? byCode.get(e.hsn_code.slice(0, len)) : undefined;
        if (parent && !isBareText(parent.display)) {
          e.display = `${parent.display.replace(/[\s:;,.-]+$/, '')} - ${e.display.charAt(0).toLowerCase()}${e.display.slice(1)}`;
          break;
        }
      }
    }
    const words = new Set<string>(e.descWords.map(stemWord));
    for (const t of e.terms) for (const w of splitWords(t)) words.add(stemWord(w));
    words.forEach(w => add(w, i));
  });
  return { entries, byCode, postings, vocabulary: [...postings.keys()], curated: entries.flatMap((e, i) => (e.curated ? [i] : [])) };
}

export const toHit = (e: HsnEntry): HsnHit => ({
  hsn_code: e.hsn_code, description: e.display, category: e.category, gst_rates: e.gst_rates,
  rate_note: e.rate_note, is_hazmat: e.is_hazmat, is_perishable: e.is_perishable,
});

/** Edits needed to turn a into b (typo tolerance). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: a.length + 1 }, (_, j) => j);
  for (let i = 1; i <= b.length; i++) {
    const cur = [i];
    for (let j = 1; j <= a.length; j++) {
      cur[j] = b[i - 1] === a[j - 1] ? prev[j - 1] : Math.min(prev[j - 1], cur[j - 1], prev[j]) + 1;
    }
    prev = cur;
  }
  return prev[a.length];
}

const bigrams = (s: string) => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** Overlap of character pairs, 0 to 1. */
export function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  A.forEach(g => { if (B.has(g)) hit++; });
  return (2 * hit) / (A.size + B.size);
}

function expandTerms(raw: string[]): string[] {
  const out = [...raw];
  for (const t of raw) if (SYNONYM_MAP[t]) out.push(...SYNONYM_MAP[t].flatMap(s => s.split(' ')), ...SYNONYM_MAP[t]);
  return [...new Set(out)];
}

/** A fuzzy-only hit this close to the best score is still worth showing. */
const FUZZY_KEEP_RATIO = 0.75;
const maxTypos = (term: string) => (term.length <= 4 ? 1 : 2);

/**
 * `strong` is true when something matched exactly: a code prefix, a keyword or synonym, or a word of the description.
 * Typo and bigram matches are weak, and are tried only for the words in `fuzzy` (those nothing matched exactly).
 */
function scoreEntry(e: HsnEntry, query: string, terms: string[], fuzzy: Set<string>, category?: string | null): { score: number; strong: boolean } {
  let score = 0;
  let strong = false;
  if (/^\d+$/.test(query)) {
    if (e.hsn_code.startsWith(query)) { score += 200 - (e.hsn_code.length - query.length) * 5; strong = true; }
    // A 6 or 8 digit code finds its known parent (4 or 6 digits), as the lookup does
    else if (/^\d{5,8}$/.test(query) && query.startsWith(e.hsn_code)) { score += 150 + e.hsn_code.length; strong = true; }
  }

  const desc = e.description.toLowerCase();
  for (const term of terms) {
    if (term.length < 2) continue;
    const stem = stemWord(term);
    if (e.terms.some(k => k === term || k === stem)) { score += 60; strong = true; continue; }
    if (e.terms.some(k => k.startsWith(term) || term.startsWith(k))) { score += 40; strong = true; continue; }
    if (e.terms.some(k => k.includes(term) || term.includes(k))) { score += 25; strong = true; continue; }
    const at = e.descWords.findIndex(w => w === term || stemWord(w) === stem);
    if (at >= 0) {
      // A word the description leads with, or repeats ("PORTLAND CEMENT, ALUMINOUS CEMENT, SLAG CEMENT"), is what the code is about
      const times = e.descWords.filter(w => stemWord(w) === stem).length;
      score += 20 + (at < 3 ? 6 : at < 8 ? 3 : 0) + 3 * (Math.min(times, 3) - 1);
      strong = true;
      continue;
    }
    if (term.length >= 3 && e.descWords.some(w => w.startsWith(term))) { score += 16; strong = true; continue; }
    if (term.length >= 3 && desc.includes(term)) { score += 12; strong = true; continue; }
    if (term.length >= 3 && fuzzy.has(term)) {
      const maxDist = maxTypos(term);
      if (e.terms.some(k => Math.abs(k.length - term.length) <= maxDist && levenshtein(k, term) <= maxDist)) { score += 15; continue; }
      if (e.descWords.some(w => w.length >= 3 && Math.abs(w.length - term.length) <= maxDist && levenshtein(w, term) <= maxDist)) { score += 8; continue; }
      let best = 0;
      for (const k of e.terms) best = Math.max(best, bigramSimilarity(k, term));
      if (best >= 0.5) score += Math.round(best * 20);
    }
  }
  if (score > 0) {
    if (category && e.category?.toLowerCase() === category.toLowerCase()) score += 25;
    // Among equal matches: a curated row (keywords, synonyms) first, then a heading over a long tariff-item text
    if (e.curated) score += 12;
    score += ({ 2: 4, 4: 12, 6: 5 } as Record<number, number>)[e.hsn_code.length] ?? 0;
    score += Math.max(0, 4 - Math.floor(e.descWords.length / 5));
  }
  return { score, strong };
}

/** The entries a search can possibly match, from the word index; the words with no exact match get typo candidates. */
function candidates(index: HsnIndex, query: string, terms: string[]): { ids: Set<number>; fuzzy: Set<string> } {
  const ids = new Set<number>();
  const fuzzy = new Set<string>();
  const addAll = (list: number[] | undefined) => list?.forEach(i => ids.add(i));
  if (/^\d+$/.test(query)) {
    index.entries.forEach((e, i) => {
      if (e.hsn_code.startsWith(query) || (query.length >= 5 && query.startsWith(e.hsn_code))) ids.add(i);
    });
    return { ids, fuzzy };
  }
  for (const term of terms) {
    if (term.length < 2) continue;
    const before = ids.size;
    const stem = stemWord(term);
    for (const w of new Set(splitWords(term).map(stemWord))) addAll(index.postings.get(w));
    addAll(index.postings.get(stem));
    if (term.length >= 3) {
      for (const w of index.vocabulary) if (w.startsWith(stem) || (w.length >= 3 && term.startsWith(w) && w.length >= term.length - 2)) addAll(index.postings.get(w));
      // A keyword or synonym that contains the word ("soft drink" for "drink")
      for (const i of index.curated) if (index.entries[i].terms.some(k => k.includes(term) || (k.length >= 3 && term.includes(k)))) ids.add(i);
    }
    if (ids.size === before && term.length >= 3) {
      fuzzy.add(term);
      const maxDist = maxTypos(term);
      for (const w of index.vocabulary) {
        if (Math.abs(w.length - term.length) <= maxDist && levenshtein(w, term) <= maxDist) addAll(index.postings.get(w));
      }
      for (const i of index.curated) if (index.entries[i].terms.some(k => bigramSimilarity(k, term) >= 0.5)) ids.add(i);
    }
  }
  return { ids, fuzzy };
}

/** The best matches for what the customer typed, at most 8, best first. Two characters are enough for a code prefix. */
export function searchHsn(index: HsnIndex, query: string, category?: string | null): HsnHit[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = expandTerms(q.split(/\s+/));
  const { ids, fuzzy } = candidates(index, q, terms);
  const scored: Array<{ e: HsnEntry; score: number; strong: boolean }> = [];
  ids.forEach(i => {
    const e = index.entries[i];
    const s = scoreEntry(e, q, terms, fuzzy, category);
    if (s.score > 0) scored.push({ e, ...s });
  });
  // Weak (typo or similar-spelling) hits never pad the list when something matched properly; they stay when nothing did
  let best = 0;
  for (const x of scored) if (x.strong && x.score > best) best = x.score;
  return scored
    .filter(x => x.strong || best === 0 || x.score >= best * FUZZY_KEEP_RATIO)
    .sort((a, b) => b.score - a.score || a.e.hsn_code.length - b.e.hsn_code.length || a.e.hsn_code.localeCompare(b.e.hsn_code))
    .slice(0, MAX_HSN_HITS)
    .map(x => toHit(x.e));
}

/** One code. Digits are compared as typed, so "2523" and "2523 " are the same. */
export function findHsn(index: HsnIndex, code: string): HsnEntry | null {
  return index.byCode.get((code ?? '').trim()) ?? null;
}

/** Longest known prefix of a 6 or 8 digit code (8, 6, then 4 digits); `matched_prefix` is the code whose rates apply. */
export function resolveHsn(index: HsnIndex, code: string): { entry: HsnEntry; matched_prefix: string } | null {
  const c = (code ?? '').trim();
  const exact = index.byCode.get(c);
  if (exact) return { entry: exact, matched_prefix: exact.hsn_code };
  for (const len of [8, 6, 4]) {
    if (len >= c.length) continue;
    const entry = index.byCode.get(c.slice(0, len));
    if (entry) return { entry, matched_prefix: entry.hsn_code };
  }
  return null;
}

const PAGE = 1000;

/** Every active HSN row; pages through PostgREST's row cap. */
async function fetchHsnRows(): Promise<HsnRow[]> {
  const rows: HsnRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('hsn_codes')
      .select('hsn_code, description, gst_rate, gst_rates, rate_note, category, keywords, synonyms, is_hazmat, is_perishable, eway_always, is_active')
      .eq('is_active', true)
      .order('hsn_code')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read hsn_codes: ${error.message}`);
    rows.push(...((data ?? []) as HsnRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** The HSN master, loaded once and kept for 10 minutes (about 22,000 rows, a few MB in memory). */
// 21,808 codes take a few seconds to read: serve the current index while a fresh one loads, never make a visitor wait
export const loadHsnIndex = memoize<HsnIndex>(HSN_CACHE_TTL_MS, async () => buildHsnIndex(await fetchHsnRows()), { staleWhileRevalidate: true });
