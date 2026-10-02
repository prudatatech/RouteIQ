/**
 * margixindia — Minimal CSV reading and writing for the bulk load template (RFC 4180: quoted fields, doubled quotes,
 * commas and line breaks inside quotes).
 */

/** Splits CSV text into rows of cells. Blank lines are skipped. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

/** One CSV line; a cell with a comma, quote or line break is quoted. A leading = @ (or a + or - that does not start a number) is defused against spreadsheet formulas. */
export function csvLine(cells: Array<string | number | null | undefined>): string {
  return cells.map(c => {
    let s = c == null ? '' : String(c);
    if (/^(?:[=@]|[+-](?!\d))/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}
