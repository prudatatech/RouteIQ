/**
 * margixindia — The HSN master in memory, and the layered fuzzy search over it.
 *
 * Ported from frontend/src/utils/hsnDatabase.ts. Exact matches (code, keyword, description word) win; typo and similar-spelling hits only show when none exist. Layers, in order of weight: HSN code prefix, exact keyword,
 * keyword starts-with, keyword contains, description word, description substring, Levenshtein typo tolerance and
 * bigram similarity. Hindi and everyday words ("clothes", "chawal") are expanded to the words the master uses
 * first. Nothing here needs pg_trgm. Up to 8 hits come back (PRD 3.2).
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
  description: string;
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

const splitWords = (s: string) => s.toLowerCase().split(/[\s,;()/]+/).filter(Boolean);

const rateOf = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

export function toEntry(row: HsnRow): HsnEntry {
  const base = rateOf(row.gst_rate) ?? 0;
  const list = (row.gst_rates ?? []).map(rateOf).filter((n): n is number => n != null);
  const rates = list.length ? [...new Set(list)] : [base];
  return {
    hsn_code: row.hsn_code,
    description: row.description,
    category: row.category ?? null,
    gst_rate: base,
    gst_rates: rates,
    rate_note: row.rate_note ?? null,
    is_hazmat: !!row.is_hazmat,
    is_perishable: !!row.is_perishable,
    eway_always: !!row.eway_always || !!row.is_hazmat,
    terms: [...new Set([...(row.keywords ?? []), ...(row.synonyms ?? [])].map(k => k.toLowerCase().trim()).filter(Boolean))],
    descWords: splitWords(row.description),
  };
}

export function buildHsnIndex(rows: HsnRow[]): HsnIndex {
  const entries = rows.filter(r => r.is_active !== false && r.hsn_code && r.description).map(toEntry);
  return { entries, byCode: new Map(entries.map(e => [e.hsn_code, e])) };
}

export const toHit = (e: HsnEntry): HsnHit => ({
  hsn_code: e.hsn_code, description: e.description, category: e.category, gst_rates: e.gst_rates,
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

/** `strong` is true when something matched exactly: a code prefix, a keyword or synonym, or a word of the description. Typo and bigram matches are weak. */
function scoreEntry(e: HsnEntry, query: string, terms: string[], category?: string | null): { score: number; strong: boolean } {
  let score = 0;
  let strong = false;
  if (e.hsn_code.startsWith(query)) { score += 200; strong = true; }

  for (const term of terms) {
    if (term.length < 2) continue;
    if (e.terms.some(k => k === term)) { score += 60; strong = true; continue; }
    if (e.terms.some(k => k.startsWith(term) || term.startsWith(k))) { score += 40; strong = true; continue; }
    if (e.terms.some(k => k.includes(term) || term.includes(k))) { score += 25; strong = true; continue; }
    if (e.descWords.some(w => w === term || w.startsWith(term))) { score += 20; strong = true; continue; }
    if (e.description.toLowerCase().includes(term)) { score += 12; strong = true; continue; }
    if (term.length >= 3) {
      const maxDist = term.length <= 4 ? 1 : 2;
      if (e.terms.some(k => Math.abs(k.length - term.length) <= maxDist && levenshtein(k, term) <= maxDist)) { score += 15; continue; }
      if (e.descWords.some(w => w.length >= 3 && Math.abs(w.length - term.length) <= maxDist && levenshtein(w, term) <= maxDist)) { score += 8; continue; }
      let best = 0;
      for (const k of e.terms) best = Math.max(best, bigramSimilarity(k, term));
      for (const w of e.descWords) if (w.length >= 3) best = Math.max(best, bigramSimilarity(w, term));
      if (best >= 0.5) score += Math.round(best * 20);
    }
  }
  if (score > 0 && category && e.category?.toLowerCase() === category.toLowerCase()) score += 25;
  return { score, strong };
}

/** The best matches for what the customer typed, at most 8, best first. Two characters are enough for a code prefix. */
export function searchHsn(index: HsnIndex, query: string, category?: string | null): HsnHit[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length < 2) return [];
  const terms = expandTerms(q.split(/\s+/));
  const scored = index.entries
    .map(e => ({ e, ...scoreEntry(e, q, terms, category) }))
    .filter(x => x.score > 0);
  // Weak (typo or similar-spelling) hits never pad the list when something matched properly; they stay when nothing did
  const best = Math.max(0, ...scored.filter(x => x.strong).map(x => x.score));
  return scored
    .filter(x => x.strong || best === 0 || x.score >= best * FUZZY_KEEP_RATIO)
    .sort((a, b) => b.score - a.score || a.e.hsn_code.localeCompare(b.e.hsn_code))
    .slice(0, MAX_HSN_HITS)
    .map(x => toHit(x.e));
}

/** One code. Digits are compared as typed, so "2523" and "2523 " are the same. */
export function findHsn(index: HsnIndex, code: string): HsnEntry | null {
  return index.byCode.get((code ?? '').trim()) ?? null;
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

/** The HSN master, loaded once and kept for 10 minutes (5,000 rows are trivial). */
export const loadHsnIndex = memoize<HsnIndex>(HSN_CACHE_TTL_MS, async () => buildHsnIndex(await fetchHsnRows()));
