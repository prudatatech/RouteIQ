#!/usr/bin/env node
/**
 * WCAG 2.x contrast check for the text tokens in design/tokens.json.
 *
 *   node design/check-contrast.mjs
 *
 * Prints every text/surface pair and exits 1 if any pair is below its minimum
 * (4.5:1 for body-size text, 3:1 for disabled text). CI runs it after the token check.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const tokens = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.json'), 'utf8'))
const c = tokens.color

const channel = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
function luminance(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const BODY = 4.5
const DISABLED = 3
// Surfaces text sits on. Inputs use the `surface` colour (Field.tsx and the mobile TextField).
const surfaces = ['bg', 'surface', 'surfaceSubtle']
const pairs = []
for (const fg of ['text', 'textMuted', 'textPlaceholder', 'accent', 'success', 'warning', 'danger', 'info', 'neutral']) {
  for (const bg of surfaces) pairs.push([fg, bg, BODY, fg === 'textPlaceholder' && bg === 'surface' ? 'input background' : ''])
}
for (const bg of surfaces) pairs.push(['textDisabled', bg, DISABLED, 'disabled text'])
// Pills, badges and soft banners: tone text on its tinted background.
for (const tone of ['accent', 'success', 'warning', 'danger', 'info', 'neutral']) pairs.push([tone, `${tone}Soft`, BODY, 'pill / badge'])
pairs.push(['accentHover', 'surface', BODY, ''], ['dangerHover', 'surface', BODY, ''])
pairs.push(['onAccentFill', 'accentFill', BODY, 'button'], ['onAccentFill', 'accentFillHover', BODY, 'button hover'])

let failed = 0
console.log('foreground'.padEnd(18) + 'background'.padEnd(18) + 'ratio'.padStart(7) + '  min  result')
for (const [fg, bg, min, note] of pairs) {
  if (!c[fg] || !c[bg]) { console.log(`${fg} on ${bg}: token missing`); failed++; continue }
  const ratio = contrast(c[fg], c[bg])
  const ok = ratio >= min
  if (!ok) failed++
  console.log(fg.padEnd(18) + bg.padEnd(18) + ratio.toFixed(2).padStart(7) + `  ${min}   ${ok ? 'pass' : 'FAIL'}${note ? `  (${note})` : ''}`)
}
if (failed) { console.error(`\n${failed} pair(s) below the minimum contrast.`); process.exit(1) }
console.log('\nAll pairs pass.')
