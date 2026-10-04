// Run on the GitHub UAT runner, or read-only against staging. Never against live.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const web = process.env.UAT_WEB || 'http://localhost:5174';
const api = process.env.UAT_API || 'http://localhost:8011/api/v1';
for (const address of [web, api]) {
  const host = new URL(address).hostname;
  assert(['localhost', '127.0.0.1', 'staging.margixindia.com', 'staging-api.margixindia.com'].includes(host), 'Only local UAT or staging is allowed');
}

const retired = await fetch(`${api}/public/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(retired.status, 404, 'The standalone lane-search quote endpoint is removed');
const space = await fetch(`${api}/public/spare-space`);
assert.equal(space.status, 200, 'Return-trip browsing remains available');
const spaceBody = await space.json();
assert(Array.isArray(spaceBody.items));
fs.mkdirSync('e2e/shots', { recursive: true });

const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => requests.push(new URL(req.url()).pathname));

    await page.goto(web);
    const post = page.getByRole('link', { name: 'Post a load', exact: true });
    await post.first().waitFor();
    assert.equal(await page.getByRole('link', { name: /find a truck/i }).count(), 0);
    assert.equal(await page.locator('a[href="/ship"]').count(), 0);
    await post.first().click();
    await page.getByRole('heading', { name: 'Post a load', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/vendor/request');
    assert.equal(await page.getByRole('navigation', { name: 'Steps' }).getByRole('button').count(), 4);
    assert.equal(await page.getByRole('link', { name: /find a truck/i }).count(), 0);

    // A saved load must survive the legacy bookmark and sign-in return address.
    await page.evaluate(() => localStorage.setItem('margix:guest-draft:load', JSON.stringify({
      savedAt: Date.now(), data: { step: 0, pickup_city: 'Pune', delivery_city: 'Mumbai' },
    })));
    await page.goto(`${web}/ship`);
    await page.waitForURL('**/vendor/request');
    await page.getByRole('heading', { name: 'Post a load', exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Steps' }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('margix:guest-draft:load')).data.pickup_city), 'Pune');
    await page.screenshot({ path: `e2e/shots/vendor-entry-${width}.png`, fullPage: true });

    await page.goto(`${web}/login`);
    const start = page.getByRole('link', { name: 'Start your load without signing in' });
    await start.waitFor();
    assert.equal(await start.getAttribute('href'), '/vendor/request');
    await page.goto(`${web}/vendor/return-trips`);
    await page.getByRole('heading', { name: 'Return trips', exact: true }).waitFor();
    assert(!requests.includes('/api/v1/public/quote'), 'Guest pages must not call the retired endpoint');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(`PASS vendor entry, legacy redirect, saved draft and return trips at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}
