import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/** Screenshots of every main screen with some data in it, for a design review. */

async function shot(page: Page, name: string, full = true) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/tour-${name}.png`, fullPage: full });
}

test('tour of the app', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Test Owner', '1111');
  await createEvent(page, 'Tour Fair');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);
  await setEventPrice(page, 'Couple Pack (live)', 200);
  await setEventPrice(page, 'Enamel Pins', 30);
  await setEventPrice(page, 'Solo Pack (live)', 120);
  await shot(page, 'event-prices');

  // Materials with costs, then a recipe and a batch
  await page.goto('/#/production');
  await page.getByRole('button', { name: 'Materials' }).click();
  for (const [name, cost] of [['Printable vinyl sticker, A4 matte', '280'], ['Laminating film, A4 gloss', '170'], ['Printer ink (per A4 print)', '8']]) {
    await page.getByRole('row', { name: new RegExp(name.replace(/[()]/g, '.')) }).getByRole('button', { name: /^Edit/ }).click();
    await page.getByLabel('Pack cost').fill(cost);
    await page.getByRole('button', { name: 'Save' }).click();
  }
  await shot(page, 'materials');
  await page.getByRole('button', { name: 'Product costs' }).click();
  await page.getByRole('row', { name: /Cat Meme \(Solo\)/ }).click();
  await page.getByRole('button', { name: 'From a recipe' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add a material' }).click();
  const selects = page.getByRole('dialog').getByLabel('Material', { exact: true });
  await selects.nth(0).selectOption({ label: 'Printable vinyl sticker, A4 matte' });
  await selects.nth(1).selectOption({ label: 'Laminating film, A4 gloss' });
  await selects.nth(2).selectOption({ label: 'Printer ink (per A4 print)' });
  await page.getByRole('button', { name: /Set sheet materials to 1\// }).click();
  await page.getByLabel('Labor per piece').fill('1');
  await shot(page, 'recipe', false);
  await page.getByRole('button', { name: 'Save cost' }).click();
  await shot(page, 'costs');

  // Booth spend
  await page.goto('/#/event/spend');
  await page.getByRole('button', { name: 'Add spend' }).click();
  await page.getByRole('dialog').getByLabel('Type', { exact: true }).selectOption({ label: 'Booth fee' });
  await page.getByRole('dialog').getByLabel('Item', { exact: true }).fill('Booth fee');
  await page.getByRole('dialog').getByLabel('Cost each', { exact: true }).fill('2000');
  await page.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption({ label: 'Bought' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Add spend' }).click();
  await page.getByRole('dialog').getByLabel('Type', { exact: true }).selectOption({ label: 'Reusable asset' });
  await page.getByRole('dialog').getByLabel('Item', { exact: true }).fill('Acrylic display');
  await page.getByRole('dialog').getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('dialog').getByLabel('Cost each', { exact: true }).fill('242');
  await page.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption({ label: 'Bought' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await shot(page, 'spend');

  // Roster
  await page.goto('/#/event/team');
  await page.getByRole('button', { name: 'Add to roster' }).click();
  for (const n of ['Joshua', 'Kaye', 'Harvey', 'CJ']) await page.getByRole('dialog').locator('.list-item', { hasText: n }).getByRole('button', { name: 'Add' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // Sales
  await openRegister(page);
  for (let i = 0; i < 6; i++) {
    await tapProduct(page, i % 2 ? 'Cat Meme (Solo)' : 'Couple Pack (live)', i % 2 ? 3 : 1);
    await tapProduct(page, 'Enamel Pins', 1);
    await payCash(page);
    await page.getByRole('button', { name: 'New sale' }).click();
  }
  await tapProduct(page, 'Solo Pack (live)', 1);
  await shot(page, 'register', false);

  await page.goto('/#/event');
  await shot(page, 'summary');
  await page.goto('/#/event/team');
  await shot(page, 'team-payouts');
  await page.goto('/#/event/stock');
  await shot(page, 'stock');
  await page.goto('/#/event/report');
  await shot(page, 'report');
  await page.goto('/#/event/settings');
  await shot(page, 'event-settings');
  await page.goto('/#/products');
  await shot(page, 'products');
  await page.goto('/#/calculator');
  await shot(page, 'calc-service');
  await page.getByRole('button', { name: 'Sticker job' }).click();
  await shot(page, 'calc-sticker');
  await page.getByRole('button', { name: 'Quick check' }).click();
  await shot(page, 'calc-quick');
  await page.goto('/#/settings');
  await shot(page, 'settings');
  await page.goto('/#/activity');
  await shot(page, 'activity');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/event');
  await shot(page, 'phone-summary', false);
  await page.goto('/#/calculator');
  await shot(page, 'phone-calc', false);
  expect(errors).toEqual([]);
});
