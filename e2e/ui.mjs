#!/usr/bin/env node
/**
 * Opens pages of the LOCAL web app as a seeded account and reports what a tester would see.
 *
 *   node e2e/ui.mjs <who|anon> <path> [path ...] [--width 390] [--steps steps.json]
 *   node e2e/ui.mjs superadmin /today /dispatch
 *   node e2e/ui.mjs customer /track/<id> --width 390
 *
 * For each path it saves e2e/shots/<who>-<path>.png (full page) and prints the page's visible text
 * (trimmed), console errors, failed requests (status >= 400) and uncaught page errors.
 *
 * --steps runs simple interactions after each page loads, from a JSON list such as
 *   [{"click":"text=Assign"},{"fill":["input[name=price]","5000"]},{"press":"Enter"},{"wait":800},{"shot":"after-assign"}]
 *
 * Signs in through the real login form (password E2e-Local-Pass-1, seeded by run.mjs --reset).
 * SAFETY: only http://localhost / 127.0.0.1 (WEB, default http://localhost:5174).
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
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [];
const [who, ...paths] = argv;
if (!who || !paths.length) { console.error('usage: node e2e/ui.mjs <who|anon> <path> [path ...] [--width N] [--steps file.json]'); process.exit(1); }

const shots = path.join(HERE, 'shots');
fs.mkdirSync(shots, { recursive: true });
const slug = (s) => s.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'root';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } });
let log = [];
page.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => log.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('response', (r) => { if (r.status() >= 400) log.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(WEB, '')}`); });

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
    for (const [i, s] of steps.entries()) {
      try {
        if (s.click) await page.locator(s.click).first().click({ timeout: 5000 });
        else if (s.fill) await page.locator(s.fill[0]).first().fill(String(s.fill[1]), { timeout: 5000 });
        else if (s.select) await page.locator(s.select[0]).first().selectOption(String(s.select[1]), { timeout: 5000 });
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.wait) await page.waitForTimeout(Number(s.wait));
        else if (s.shot) await page.screenshot({ path: path.join(shots, `${who}-${slug(p)}-${slug(s.shot)}.png`), fullPage: true });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      } catch (e) { log.push(`step ${i} ${JSON.stringify(s)}: ${e.message.split('\n')[0]}`); }
    }
    const file = path.join(shots, `${who}-${slug(p)}${width < 768 ? '-m' : ''}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\n{2,}/g, '\n').trim();
    console.log(`\n=== ${p}  ->  ${new URL(page.url()).pathname}  (${path.relative(process.cwd(), file)})`);
    console.log(text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length} chars)` : text);
    console.log(log.length ? `--- problems (${log.length}):\n${[...new Set(log)].join('\n')}` : '--- no console errors or failed requests');
  }
} finally {
  await browser.close();
}
