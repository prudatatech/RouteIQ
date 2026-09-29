/**
 * Checks Supabase query-builder calls in backend-ts/src and frontend/src against
 * the schema snapshot in backend-ts/test/support/db-schema.json (table -> column
 * list, generated from `information_schema` by scripts/dump-schema.sql).
 *
 * What it catches:
 *   - `.from('table')` naming a table/view that isn't in the snapshot.
 *   - `.select('col, other, rel(col2)')` naming an unknown column on the table,
 *     or an unknown embedded relation/table, including aliases (`alias:table`)
 *     and foreign-key hints (`table!fkey_name(...)`), recursively.
 *   - `.insert({...})` / `.update({...})` / `.upsert({...})` (object or array of
 *     objects) naming an unknown column as a literal object key.
 *   - `.eq/.neq/.in/.is/.gt/.lt/.gte/.lte/.order('col', ...)` naming an unknown
 *     column on the table currently in scope.
 *   - `.eq/.neq('col', 'value')` and `.in('col', ['a', 'b'])` on an enum column
 *     using a value the enum doesn't have (Postgres rejects it, a 500 at runtime).
 *     Allowed values come from backend-ts/test/support/db-enums.json
 *     (scripts/dump-enums.sql).
 *
 * How it works (deliberately simple, regex/string scanning, no real JS/TS parser):
 *   1. Find every `.from('table')` (or "..."/`...`) call.
 *   2. Take the "chain" following it as the text from that call up to the first
 *      top-level `;` (bracket/paren/brace depth back to the call's own baseline),
 *      or the next `.from(` call, or a hard 4000-char cap, whichever comes first.
 *      This covers the common `await supabase.from(x).select(y).eq(z, w);` shape
 *      used throughout this codebase.
 *   3. Within that chain, scan for `.select(`, `.insert(`/`.update(`/`.upsert(`,
 *      and the filter/order methods listed above, and validate what they name.
 *
 * Known limits (by design, to keep this simple):
 *   - Only literal strings/object keys are checked. Table or column names built
 *     from variables, template-literal interpolation, computed keys (`[x]: y`),
 *     or spread (`...obj`) are skipped silently — they can't be checked statically.
 *   - The "chain" heuristic can mis-scope filters in unusual code shapes (e.g. a
 *     `.from()` call whose chain never terminates in `;` before 4000 chars, or
 *     helper functions that build a query across several statements). This is a
 *     best-effort net, not a type checker.
 *   - `.select('*', { count: 'exact', head: true })` — the `*` is accepted as-is
 *     (no per-column check), and the second, non-string argument is ignored.
 *   - RPC calls (`.rpc('fn', {...})`) are not checked; they don't map to columns.
 *   - Views are treated the same as tables (the snapshot includes both).
 *   - `supabase.storage.from('bucket')` (Storage buckets, not database tables)
 *     is recognized and skipped entirely.
 *   - Only the first argument of `.insert()`/`.update()`/`.upsert()` is checked
 *     as column data; a second options argument (e.g. `{ onConflict: '...' }`)
 *     is intentionally ignored.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(ROOT, 'backend-ts', 'test', 'support', 'db-schema.json');
const ENUMS_PATH = path.join(ROOT, 'backend-ts', 'test', 'support', 'db-enums.json');

/** "table.column" -> allowed enum values. */
type Enums = Record<string, string[]>;

function loadEnums(): Enums {
  return fs.existsSync(ENUMS_PATH) ? (JSON.parse(fs.readFileSync(ENUMS_PATH, 'utf8')) as Enums) : {};
}

let ENUMS: Enums = {};

const AMBIGUOUS_PATH = path.join(ROOT, 'backend-ts', 'test', 'support', 'db-ambiguous-relations.json');

/** Table pairs ("a|b", sorted) joined by more than one foreign key: an embed between them must name the key. */
function loadAmbiguous(): Set<string> {
  return new Set(fs.existsSync(AMBIGUOUS_PATH) ? (JSON.parse(fs.readFileSync(AMBIGUOUS_PATH, 'utf8')) as string[]) : []);
}

let AMBIGUOUS: Set<string> = new Set();

function isAmbiguousPair(a: string, b: string): boolean {
  return AMBIGUOUS.has(a < b ? `${a}|${b}` : `${b}|${a}`);
}

type Schema = Record<string, string[]>;

interface Mismatch {
  file: string;
  line: number;
  message: string;
}

function loadSchema(): Schema {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(raw) as Schema;
}

function listFiles(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, exts, out);
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** Index just past the matching close bracket for the open bracket at `openIndex`. */
function matchBracket(text: string, openIndex: number): number {
  const open = text[openIndex];
  const close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Index of the character right after the string literal starting at `quoteIndex`. */
function skipString(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex];
  let i = quoteIndex + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i;
    i++;
  }
  return text.length;
}

/** End index (exclusive) of the chain starting at a `.from(` call. */
function findChainEnd(text: string, fromIndex: number): number {
  const nextFrom = text.indexOf('.from(', fromIndex + 1);
  const cap = Math.min(text.length, fromIndex + 4000, nextFrom === -1 ? text.length : nextFrom);
  let depth = 0;
  for (let i = fromIndex; i < cap; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth <= 0) return i;
  }
  return cap;
}

const STRING_LITERAL = /^['"`]([^'"`]*)['"`]$/;

function extractStringLiteral(source: string, afterIndex: number): { value: string; index: number } | null {
  const m = /^\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(source.slice(afterIndex));
  if (!m) return null;
  return { value: m[2], index: afterIndex + m.index! };
}

/** Split a select-list string at top-level commas (respecting nested parens). */
function splitTopLevel(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of str) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Text of a call's second argument (after the first top-level comma), trimmed. */
function secondArgument(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(args, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return args.slice(i + 1).trim();
  }
  return '';
}

const EMBED_RE = /^(?:(\w+):)?(\w+)(?:!(\w+))?\(([\s\S]*)\)$/;
const COLUMN_RE = /^(?:(\w+):)?(\w+)(?:::\w+)?(?:\.(?:asc|desc)(?:\.nullsfirst|\.nullslast)?)?$/;

function checkSelect(
  selectStr: string,
  table: string,
  schema: Schema,
  file: string,
  line: number,
  mismatches: Mismatch[]
): void {
  for (const rawPart of splitTopLevel(selectStr)) {
    const part = rawPart.trim();
    if (!part || part === '*') continue;

    const embed = EMBED_RE.exec(part);
    if (embed) {
      const [, , embedTable, fkHint, inner] = embed;
      if (!fkHint && isAmbiguousPair(table, embedTable)) {
        mismatches.push({
          file, line,
          message: `embed '${embedTable}' in select on '${table}' is ambiguous (more than one foreign key joins them); name one, e.g. ${embedTable}!<constraint_name>(...)`,
        });
      }
      if (!(embedTable in schema)) {
        mismatches.push({ file, line, message: `unknown embedded table/relation '${embedTable}' in select on '${table}'` });
      } else {
        checkSelect(inner, embedTable, schema, file, line, mismatches);
      }
      continue;
    }

    const col = COLUMN_RE.exec(part);
    if (!col) continue; // aggregate/computed expression we can't statically check; skip
    const column = col[2];
    if (!column || column === '*') continue;
    const columns = schema[table];
    if (columns && !columns.includes(column)) {
      mismatches.push({ file, line, message: `unknown column '${column}' on table '${table}' (select)` });
    }
  }
}

/** Top-level object keys of a `{ ... }` or `[{ ... }, ...]` literal (best effort). */
function extractObjectKeys(objText: string): string[] {
  const keys = new Set<string>();
  const trimmed = objText.trim();
  const body = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
  for (const objLiteral of findObjectLiterals(body)) {
    const inner = objLiteral.slice(1, -1);
    for (const rawEntry of splitObjectEntries(inner)) {
      const entry = rawEntry.trim();
      if (!entry || entry.startsWith('...')) continue;
      const m = /^(?:['"`]?)([A-Za-z_$][\w$]*)['"`]?\s*(?::|,|$)/.exec(entry);
      if (m) keys.add(m[1]);
    }
  }
  return Array.from(keys);
}

function findObjectLiterals(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i) + 1;
      continue;
    }
    if (c === '{') {
      const end = matchBracket(text, i);
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function splitObjectEntries(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(str, i);
      current += str.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    if (c === '}' || c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
    i++;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function checkFile(file: string, schema: Schema, mismatches: Mismatch[]): void {
  const text = fs.readFileSync(file, 'utf8');
  const fromRe = /\.from\(\s*(['"`])([\w.]+)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = fromRe.exec(text))) {
    const fromIndex = match.index;
    // `supabase.storage.from('bucket')` names a Storage bucket, not a table
    // (the `.storage` may be on the line above a chained `.from(...)`).
    const precedingText = text.slice(Math.max(0, fromIndex - 40), fromIndex);
    if (/\.storage\s*$/.test(precedingText)) continue;
    const table = match[2];
    const line = lineOf(text, fromIndex);
    if (!(table in schema)) {
      mismatches.push({ file, line, message: `unknown table/view '${table}' in .from()` });
      continue;
    }
    const chainEnd = findChainEnd(text, fromIndex);
    const chain = text.slice(fromIndex, chainEnd);

    // .select('...')
    const selectRe = /\.select\(/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = selectRe.exec(chain))) {
      const lit = extractStringLiteral(chain, sMatch.index + '.select'.length);
      if (!lit) continue;
      checkSelect(lit.value, table, schema, file, lineOf(text, fromIndex + sMatch.index), mismatches);
    }

    // .insert({...}) / .update({...}) / .upsert({...})
    const writeRe = /\.(insert|update|upsert)\(/g;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = writeRe.exec(chain))) {
      const openParen = wMatch.index + wMatch[0].length - 1;
      const closeParen = matchBracket(chain, openParen);
      const argText = chain.slice(openParen + 1, closeParen - 1);
      // Only the first argument carries row data; a second argument (e.g.
      // `{ onConflict: 'col' }`) is upsert/insert options, not columns.
      const firstArg = splitObjectEntries(argText)[0] ?? '';
      const keys = extractObjectKeys(firstArg);
      const columns = schema[table];
      const wLine = lineOf(text, fromIndex + wMatch.index);
      for (const key of keys) {
        if (columns && !columns.includes(key)) {
          mismatches.push({ file, line: wLine, message: `unknown column '${key}' on table '${table}' (${wMatch[1]})` });
        }
      }
    }

    // .eq/.neq/.in/.is/.gt/.lt/.gte/.lte/.order('col', ...)
    const filterRe = /\.(eq|neq|in|is|gt|lt|gte|lte|order)\(/g;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = filterRe.exec(chain))) {
      const lit = extractStringLiteral(chain, fMatch.index + fMatch[0].length - 1);
      if (!lit) continue;
      const column = lit.value;
      const columns = schema[table];
      const fLine = lineOf(text, fromIndex + fMatch.index);
      if (columns && column && !columns.includes(column) && STRING_LITERAL.test(`'${column}'`)) {
        mismatches.push({ file, line: fLine, message: `unknown column '${column}' on table '${table}' (.${fMatch[1]})` });
      }
      const allowed = ENUMS[`${table}.${column}`];
      if (allowed && ['eq', 'neq', 'in'].includes(fMatch[1])) {
        const openParen = fMatch.index + fMatch[0].length - 1;
        const valueArg = secondArgument(chain.slice(openParen + 1, matchBracket(chain, openParen) - 1));
        // Only literal values: a bare string, or an array made only of strings.
        const literals = fMatch[1] === 'in'
          ? (/^\[\s*(['"][\w-]*['"]\s*,?\s*)*\]$/.test(valueArg) ? [...valueArg.matchAll(/['"]([\w-]*)['"]/g)].map(m => m[1]) : [])
          : (/^['"][\w-]*['"]$/.test(valueArg) ? [valueArg.slice(1, -1)] : []);
        for (const value of literals) {
          if (!allowed.includes(value)) {
            mismatches.push({ file, line: fLine, message: `'${value}' is not a value of ${table}.${column} (allowed: ${allowed.join(', ')})` });
          }
        }
      }
    }
  }
}

function main(): void {
  const schema = loadSchema();
  ENUMS = loadEnums();
  AMBIGUOUS = loadAmbiguous();
  const mismatches: Mismatch[] = [];

  const files = [
    ...listFiles(path.join(ROOT, 'backend-ts', 'src'), ['.ts']),
    ...listFiles(path.join(ROOT, 'frontend', 'src'), ['.ts', '.tsx']),
  ];

  for (const file of files) {
    checkFile(file, schema, mismatches);
  }

  if (mismatches.length === 0) {
    console.log(`check:queries — ${files.length} files scanned, no mismatches against db-schema.json`);
    process.exit(0);
  }

  console.error(`check:queries — ${mismatches.length} mismatch(es) found:\n`);
  for (const m of mismatches) {
    console.error(`${path.relative(ROOT, m.file)}:${m.line}: ${m.message}`);
  }
  process.exit(1);
}

main();
