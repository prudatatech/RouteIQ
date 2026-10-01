#!/usr/bin/env node
/**
 * UX review driver (LOCAL web app only). Like ui.mjs, with extra steps for the second UX pass:
 * keyboard focus order, status pills, localStorage, overflow checks and printing a part of the page.
 *
 *   node e2e/ux.mjs <who|anon> <path> [--width 390] [--steps steps.json] [--tag name]
 *
 * Steps (a JSON list), run in order after the page loads:
 *   {"click":"sel"} {"fill":["sel","text"]} {"fillLabel":["Label text","value"]} {"select":["sel","value"]} {"press":"Key"} {"type":"text"} {"wait":ms}
 *   {"shot":"name"}            full-page screenshot  e2e/shots/<who>-<path>[-tag]-<name>[-m].png
 *   {"say":"sel"}              prints the visible text of the first match (or MISSING)
 *   {"goto":"/path"} {"reload":1}
 *   {"ls":["key","json"]}      sets localStorage[key] (call "reload" after)
 *   {"tabs":N}                 presses Tab N times and prints, for each stop, what has focus and whether a focus ring shows
 *   {"focus":"sel"}            focuses the first match
 *   {"pills":1}                prints every status pill: PILL <path> | <label> | <background> | <text colour>
 *   {"overflow":1}             prints page width against viewport width (a sideways scroll shows as OVERFLOW)
 *   {"active":1}               prints the focused element and whether it is inside a dialog
 * Prints the same problem list as ui.mjs (console errors, failed requests, page errors) at the end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = (process.env.WEB || 'http://localhost:5174').replace(/\/+$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(WEB).hostname)) { console.error(`REFUSING: ${WEB} is not local`); process.exit(2); }

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const width = Number(opt('--width') || 1440);
const stepsFile = opt('--steps');
const tag = opt('--tag');
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [];
const [who, ...paths] = argv;
if (!who || !paths.length) { console.error('usage: node e2e/ux.mjs <who|anon> <path> [--width N] [--steps file.json] [--tag name]'); process.exit(1); }

const shots = path.join(HERE, 'shots');
fs.mkdirSync(shots, { recursive: true });
const slug = (s) => s.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'root';
const sfx = width < 768 ? '-m' : '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } });
let log = [];
page.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => log.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(WEB, '')}`); });

/** Describes the element that has focus, in the browser. */
const describeFocus = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'BODY', label: '(nothing focused)', ring: false, inDialog: false, visible: true };
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const lab = el.labels && el.labels[0] ? el.labels[0].innerText.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName, type: el.getAttribute('type') || '', role: el.getAttribute('role') || '', label: lab || label,
    ring: outline || !!shadow, inDialog: !!el.closest('[role=dialog]'), visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
  };
});
const fmtFocus = (f) => `${f.tag}${f.type ? `[${f.type}]` : ''}${f.role ? `(${f.role})` : ''} "${f.label}" ring=${f.ring ? 'yes' : 'NO'} dialog=${f.inDialog ? 'yes' : 'no'} onscreen=${f.visible ? 'yes' : 'NO'}`;

try {
  if (who !== 'anon') {
    const accounts = JSON.parse(fs.readFileSync(path.join(HERE, 'accounts.json'), 'utf8'));
    const acct = accounts[who];
    if (!acct) throw new Error(`unknown account "${who}"; have ${Object.keys(accounts).join(', ')}`);
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type=email]', acct.email);
    await page.fill('input[type=password]', acct.password || 'E2e-Local-Pass-1');
    await page.locator('form button[type=submit]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => log.push('login: still on /login after 15s'));
    console.log(`signed in as ${who}; landed on ${new URL(page.url()).pathname}`);
  }

  for (const p of paths) {
    log = [];
    await page.goto(`${WEB}${p.startsWith('/') ? p : `/${p}`}`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => log.push(`goto: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(600);
    const name = (n) => path.join(shots, `${who}-${slug(p)}${tag ? `-${tag}` : ''}-${slug(n)}${sfx}.png`);
    for (const [i, s] of steps.entries()) {
      try {
        if (s.click) await page.locator(s.click).first().click({ timeout: 5000 });
        else if (s.fill) await page.locator(s.fill[0]).first().fill(String(s.fill[1]), { timeout: 5000 });
        else if (s.fillLabel) await page.getByLabel(s.fillLabel[0], { exact: true }).first().fill(String(s.fillLabel[1]), { timeout: 5000 });
        else if (s.select) await page.locator(s.select[0]).first().selectOption(String(s.select[1]), { timeout: 5000 });
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.type) await page.keyboard.type(String(s.type));
        else if (s.wait) await page.waitForTimeout(Number(s.wait));
        else if (s.goto) await page.goto(`${WEB}${s.goto}`, { waitUntil: 'networkidle', timeout: 30000 });
        else if (s.reload) await page.reload({ waitUntil: 'networkidle' });
        else if (s.ls) await page.evaluate(([k, v]) => localStorage.setItem(k, v), [s.ls[0], typeof s.ls[1] === 'string' ? s.ls[1] : JSON.stringify(s.ls[1])]);
        else if (s.focus) await page.locator(s.focus).first().focus({ timeout: 5000 });
        else if (s.shot) await page.screenshot({ path: name(s.shot), fullPage: true });
        else if (s.say) {
          const t = await page.locator(s.say).first().innerText({ timeout: 3000 }).catch(() => null);
          console.log(`SAY ${s.say}: ${t == null ? 'MISSING' : t.replace(/\s*\n\s*/g, ' / ').slice(0, 600)}`);
        } else if (s.active) console.log(`ACTIVE ${fmtFocus(await describeFocus())}`);
        else if (s.tabs) {
          for (let n = 1; n <= Number(s.tabs); n++) { await page.keyboard.press('Tab'); console.log(`TAB ${n}: ${fmtFocus(await describeFocus())}`); }
        } else if (s.pills) {
          const pills = await page.evaluate(() => [...document.querySelectorAll('span.rounded-full')]
            .filter((el) => el.className.includes('text-xs') && el.className.includes('font-medium') && el.className.includes('inline-flex'))
            .map((el) => { const cs = getComputedStyle(el); return { label: el.innerText.replace(/\s+/g, ' ').trim(), bg: cs.backgroundColor, fg: cs.color }; })
            .filter((x) => x.label));
          for (const x of pills) console.log(`PILL ${p} | ${x.label} | ${x.bg} | ${x.fg}`);
          if (!pills.length) console.log(`PILL ${p} | (none) | | `);
        } else if (s.overflow) {
          const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          console.log(`${o.sw > o.cw ? 'OVERFLOW' : 'fits'} ${p}: page ${o.sw}px in a ${o.cw}px viewport`);
        }
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      } catch (e) { log.push(`step ${i} ${JSON.stringify(s)}: ${e.message.split('\n')[0]}`); }
    }
    const file = name('end');
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, '\n').trim();
    console.log(`\n=== ${p}  ->  ${new URL(page.url()).pathname}  (${path.relative(process.cwd(), file)})`);
    console.log(text.length > 3000 ? `${text.slice(0, 3000)}\n… (${text.length} chars)` : text);
    console.log(log.length ? `--- problems (${log.length}):\n${[...new Set(log)].join('\n')}` : '--- no console errors or failed requests');
  }
} finally {
  await browser.close();
}
