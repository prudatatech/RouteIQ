#!/usr/bin/env node
/**
 * Vocabulary check: keeps retired words out of user-visible text.
 * See docs/vocabulary.md for the word list, the allowlist and the escape comment.
 *
 * Usage: node scripts/check-vocabulary.mjs [--only frontend,backend,driver,customer]
 * Exits 1 with a file:line report when a banned word is found.
 *
 * It reads code with the TypeScript parser found in one of the packages'
 * node_modules (no dependency of its own), so code identifiers, imports,
 * object keys, paths and test files are never scanned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Banned word -> what to say instead (case-insensitive, whole words). */
const BANNED = [
  [/consignments?/i, 'shipment'],
  [/manifests?/i, 'shipment (or load for vendor goods)'],
  [/routes?/i, 'trip (keep route only for a road path on a map)'],
  [/exceptions?/i, 'problem'],
  [/backhauls?/i, 'return trip'],
  [/capacity windows?/i, 'return trip'],
  [/pooling/i, 'return trip'],
  [/pool loads?/i, 'return trip'],
  [/vendor requests?/i, 'request (staff) or load (vendor)'],
  [/shipment requests?/i, 'request'],
  [/incidents?/i, 'problem (traffic incident stays)'],
  [/transshipments?/i, 'transfer'],
  [/transship(?:s|ped|ping)?/i, 'transfer ("Plan a transfer")'],
  [/raise problem/i, 'Raise a problem'],
  [/(?:in|to|under) finance/i, 'Money (the Finance page is now Money)'],
  [/(?:in|to|under) cargo/i, 'Problems (the module is Problems, not Cargo)'],
];
const BANNED_RE = new RegExp(`\\b(?:${BANNED.map(([r]) => r.source).join('|')})\\b`, 'gi');

const TARGETS = {
  frontend: { dirs: ['frontend/src'], mode: 'ui' },
  backend: { dirs: ['backend-ts/src'], mode: 'backend' },
  driver: { dirs: ['driver-app/src/locales'], mode: 'locale' },
  customer: { dirs: ['customer-app/src/locales'], mode: 'locale' },
};

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const onlyArg = onlyIdx >= 0 ? args[onlyIdx + 1] : args.find((a) => a.startsWith('--only='))?.slice(7);
const ALIASES = { 'backend-ts': 'backend', 'driver-app': 'driver', 'customer-app': 'customer', locales: 'driver,customer' };
let selected = Object.keys(TARGETS);
if (onlyArg) {
  selected = onlyArg.split(',').flatMap((s) => (ALIASES[s.trim()] ?? s.trim()).split(',')).filter(Boolean);
  const bad = selected.filter((s) => !TARGETS[s]);
  if (bad.length) {
    console.error(`Unknown target: ${bad.join(', ')}. Use: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }
}

function loadTypescript() {
  for (const dir of ['frontend', 'backend-ts', 'driver-app', 'customer-app', '.']) {
    try {
      return createRequire(path.join(ROOT, dir, 'package.json'))('typescript');
    } catch { /* try the next package */ }
  }
  console.error('check-vocabulary: typescript not found. Run npm ci in frontend or backend-ts first.');
  process.exit(2);
}
const ts = loadTypescript();

const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/vocabulary-allowlist.json'), 'utf8')).entries;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const NON_TEXT_ATTRS = new Set(['className', 'to', 'href', 'path', 'key', 'id', 'type', 'name', 'htmlFor', 'role', 'variant', 'size', 'src', 'rel', 'target', 'autoComplete', 'inputMode', 'tone', 'kind', 'mode', 'as', 'fill', 'stroke', 'd', 'viewBox', 'xmlns', 'style', 'value', 'icon', 'color', 'status', 'align', 'layout', 'position', 'method', 'accept']);
const DEV_CALL = /^(select|from|rpc|eq|neq|in|or|not|is|order|filter|match|ilike|like|contains|on|query|prepare|log|warn|error|info|debug|require|import|get|post|put|patch|delete|use|header|setHeader|getHeader|on|once|emit|cache|incr|expire|setex|hget|hset|dbError)$/;

/** Database and GraphQL field lists, never shown to a person. */
const QUERY_TEXT = /\(\*|\*,|[{}]|_fkey/;

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

function inNewArgs(newExpr, node, minIdx) {
  return (newExpr.arguments ?? []).some((arg, i) => i >= minIdx && arg.pos <= node.pos && node.end <= arg.end);
}

/** True when this string is text a person may read (as opposed to code). */
function isUserText(node, mode, rel) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p)) return false;
  if (ts.isExternalModuleReference(p) || ts.isModuleDeclaration(p)) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return false;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return false;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return false;
  if (ts.isJsxAttribute(p) && NON_TEXT_ATTRS.has(p.name.text)) return false;
  // Console logs are for developers.
  for (let a = p; a; a = a.parent) {
    if (ts.isCallExpression(a) && /^(console|logger|log)\./.test(a.expression.getText())) return false;
  }

  if (mode === 'locale' || mode === 'ui') return true;
  if (QUERY_TEXT.test(node.text ?? node.rawText ?? '')) return false;

  // backend: anything a person can read. Developer-only text is skipped: errors that
  // become a generic 500, queries and table names, and logs.
  for (let a = p; a; a = a.parent) {
    if (ts.isNewExpression(a) && ts.isIdentifier(a.expression)) {
      if (a.expression.text === 'HttpError') return inNewArgs(a, node, 1);
      if (/^(Error|TypeError|RangeError)$/.test(a.expression.text)) return false;
    }
    if (ts.isCallExpression(a) && DEV_CALL.test(calleeName(a))) return false;
    if (ts.isTaggedTemplateExpression(a)) return false;
  }
  return true;
}

/** Skip code-looking values: one lowercase or path-like token. */
function looksLikeCode(text) {
  const t = text.trim();
  if (!t) return true;
  if (/^[/.#@]/.test(t) || /^https?:/.test(t)) return true;
  if (!/\s/.test(t) && /^[a-z0-9_:.\-/${}[\]]+$/.test(t)) return true;
  return false;
}

const findings = [];

function allowed(rel, text, matchStart, matchEnd) {
  const lower = text.toLowerCase();
  for (const entry of allowlist) {
    const fileOk = entry.file === rel || (entry.file.endsWith('/') && rel.startsWith(entry.file));
    if (!fileOk) continue;
    const phrase = entry.phrase.toLowerCase();
    if (entry.whole) {
      if (text.trim().toLowerCase() === phrase) return true;
      continue;
    }
    for (let i = lower.indexOf(phrase); i >= 0; i = lower.indexOf(phrase, i + 1)) {
      if (i <= matchStart && i + phrase.length >= matchEnd) return true;
    }
  }
  return false;
}

function checkText(sf, rel, lines, text, node, startPos, skip) {
  if (skip(text)) return;
  const nodeStart = node.getStart(sf);
  const nodeLine = sf.getLineAndCharacterOfPosition(nodeStart).line;
  BANNED_RE.lastIndex = 0;
  let m;
  while ((m = BANNED_RE.exec(text))) {
    // Line of the hit (multi-line JSX text and templates span lines).
    const before = text.slice(0, m.index);
    const line = nodeLine + (startPos > nodeStart ? 0 : 0) + (before.match(/\n/g)?.length ?? 0);
    const marked = [line, line - 1, nodeLine, nodeLine - 1].some((l) => /vocab-ok:\s*\S/.test(lines[l] ?? ''));
    if (marked) continue;
    if (allowed(rel, text, m.index, m.index + m[0].length)) continue;
    const bad = BANNED.find(([r]) => new RegExp(`^${r.source}$`, 'i').test(m[0]));
    findings.push({ rel, line: line + 1, word: m[0], hint: bad?.[1] ?? '', snippet: text.replace(/\s+/g, ' ').trim().slice(0, 90) });
  }
}

function scanFile(file, mode) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split('\n');
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isUserText(node, mode, rel)) checkText(sf, rel, lines, node.text, node, node.getStart(sf) + 1, looksLikeCode);
    } else if (ts.isTemplateExpression(node)) {
      if (isUserText(node, mode, rel) && !/^[/.]|^https?:/.test(node.head.text)) {
        for (const part of [node.head, ...node.templateSpans.map((s) => s.literal)]) {
          checkText(sf, rel, lines, part.text, part, part.getStart(sf) + 1, (t) => !t.trim() || /^[a-z0-9_:.\-/]+$/.test(t));
        }
      }
    } else if (ts.isJsxText(node)) {
      checkText(sf, rel, lines, node.text, node, node.getStart(sf), () => false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

let scanned = 0;
for (const name of selected) {
  const { dirs, mode } = TARGETS[name];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      scanFile(f, mode);
      scanned++;
    }
  }
}

findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
for (const f of findings) {
  console.log(`${f.rel}:${f.line}  "${f.word}" -> ${f.hint}   | ${f.snippet}`);
}
if (findings.length) {
  console.error(`\nvocabulary: ${findings.length} banned word(s) in ${scanned} files (${selected.join(', ')}). See docs/vocabulary.md. Add an allowlist entry or "// vocab-ok: reason" only for a real exception.`);
  process.exit(1);
}
console.log(`vocabulary: ok (${scanned} files, ${selected.join(', ')})`);
