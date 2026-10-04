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
    // Unmount the form before seeding a resumed draft so its autosave cannot overwrite this fixture.
    await page.goto(`${web}/login`);
    await page.getByRole('link', { name: 'Start your load without signing in' }).waitFor();

    await page.evaluate(() => localStorage.setItem('margix:guest-draft:load', JSON.stringify({
      savedAt: Date.now(), data: { v: 2, step: 2, pickup_city: 'Pune', delivery_city: 'Mumbai', pickup_lat: 18.52, pickup_lng: 73.85,
        delivery_lat: 19.07, delivery_lng: 72.87, vehicle_class: 'truck_14ft', vehicle_mode: 'manual', load_type: 'ftl', capacity_t: '4',
        items: [{ key: 'price-test', product_name: 'Rice', hsn_code: '1006', gst_rate: 0, weight_kg: '1000', declared_value: '40000',
          quantity: '20', unit: 'bags', handling: [], rate_options: [0] }] },
    })));
    await page.goto(`${web}/vendor/request`);
    try {
      await page.getByRole('button', { name: 'View price recommendation' }).click({ timeout: 30000 });
    } catch (error) {
      console.log('Price scenario visible state:', await page.locator('body').innerText());
      console.log('Price scenario draft:', await page.evaluate(() => localStorage.getItem('margix:guest-draft:load')));
      await page.screenshot({ path: `e2e/shots/vendor-price-error-${width}.png`, fullPage: true });
      throw error;
    }
    const modal = page.getByRole('dialog', { name: 'Price recommendation' });
    await modal.waitFor();
    assert.equal(await modal.getByRole('table', { name: 'Reference truck rates' }).locator('tbody tr').count(), 5);
    assert.match(await modal.innerText(), /Light Commercial \(LCV\).*used/s);
    assert.match(await modal.innerText(), /Midpoint:.*km × ₹20/s);
    await page.screenshot({ path: `e2e/shots/vendor-price-modal-${width}.png`, fullPage: true, animations: 'disabled' });
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);

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
