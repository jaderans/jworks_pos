import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, setupOwner } from './helpers';

test('a sticker printing job: quote, proof, 50% down, print, ship with the balance', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await page.keyboard.press('Escape');

  await page.goto('/#/print');
  await page.getByRole('button', { name: 'New service order' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await d.getByLabel('Name', { exact: true }).fill('Mira Bakeshop');
  await d.getByLabel('Mobile, email or @handle').fill('0917 555 0101');
  // 5 sheets of Premium matte or glossy, die cut: 5 × (₱80 + ₱10)
  await d.getByLabel('Material').selectOption('prem-matte-glossy');
  await d.getByLabel('Cut').selectOption('die');
  await d.getByLabel('A4 sheets').fill('5');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  await expect(d.getByText('5 × ₱90.00 · 5 A4 sheets')).toBeVisible();
  // 20 laminated full packs, small: 20 × ₱20
  await d.getByRole('button', { name: 'Packaging', exact: true }).click();
  await d.getByLabel('Packaging', { exact: true }).selectOption('full-lam');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  // Courier, ₱120
  await d.getByRole('button', { name: 'Courier', exact: true }).click();
  await d.getByLabel('Courier', { exact: true }).fill('J&T');
  await d.getByLabel('Delivery fee').fill('120');
  await d.getByLabel('Address').fill('12 Rizal St, Jaro, Iloilo City');
  await expect(d.locator('.wf-row.total')).toContainText('₱970');
  await expect(d.locator('.wf-row', { hasText: '50% down payment' })).toContainText('₱485');
  await page.screenshot({ path: `${SHOTS}/print-order.png`, fullPage: true });
  await d.getByRole('button', { name: 'Save service order' }).click();

  const card = page.getByRole('article', { name: /Service order P[A-Z]-001/ });
  await expect(card).toContainText('₱970 · no payment yet');
  await expect(page.getByRole('region', { name: 'Quote and proof' }).getByRole('article')).toHaveCount(1);

  // Proof, approval and the down payment
  await card.getByRole('button', { name: 'Proof sent' }).click();
  await expect(card.getByText('Proof sent')).toBeVisible();
  await card.getByRole('button', { name: 'Approved' }).click();
  await expect(card.getByText(/Ready by/)).toBeVisible();
  await card.getByRole('button', { name: 'Payment' }).click();
  const pay = page.getByRole('dialog', { name: /Payment for P[A-Z]-001/ });
  await expect(pay.getByLabel('Amount')).toHaveValue('485');
  await pay.getByLabel('Paid by').selectOption({ label: 'GCash' });
  await pay.getByLabel('Reference no.').fill('5012 778 9912');
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(card).toContainText('₱485 paid');

  // The quote PDF on the letterhead, with where to pay
  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: /PDF of P[A-Z]-001/ }).click()]);
  await dl.saveAs('test-results/print-quote.pdf');
  expect(fs.readFileSync('test-results/print-quote.pdf', 'latin1')).toContain('/MediaBox [0 0 612 1008]');

  // Print, ready, then ship: the balance first
  await card.getByRole('button', { name: 'Start making' }).click();
  await expect(page.getByRole('region', { name: 'Making' }).getByRole('article')).toHaveCount(1);
  await card.getByRole('button', { name: 'Ready' }).click();
  await expect(page.getByRole('region', { name: 'Ready' }).getByRole('article')).toHaveCount(1);
  await card.getByRole('button', { name: 'Shipped' }).click();
  const ship = page.getByRole('dialog', { name: /Ship P[A-Z]-001/ });
  await expect(ship.getByText('₱485 is still due on this order.')).toBeVisible();
  await ship.getByRole('button', { name: /Take the ₱485 first/ }).click();
  await pay.getByLabel('Paid by').selectOption({ label: 'GCash' });
  await pay.getByLabel('Reference no.').fill('5012 778 9950');
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(card).toContainText('Paid');
  await card.getByRole('button', { name: 'Shipped' }).click();
  await ship.getByLabel('Tracking number').fill('JT0012345678');
  await ship.getByRole('button', { name: 'Shipped', exact: true }).click();
  await expect(page.getByText(/Done and cancelled \(1\)/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/print-board.png`, fullPage: true });

  // The owner changes the rate card; new quotes use it
  await page.getByRole('button', { name: 'Rate card' }).click();
  await page.getByLabel('Price of Premium Matte or Glossy').fill('85');
  await page.getByRole('button', { name: 'Save rate card' }).click();
  await page.getByRole('button', { name: 'New service order' }).click();
  await d.getByLabel('Material').selectOption('prem-matte-glossy');
  await expect(d.getByLabel('Material').locator('option:checked')).toHaveText(/₱85\/sheet/);
  expect(errors).toEqual([]);
});

test('a customer’s own sticker size: how many fit inside the Cricut cut area, ordered by sticker count', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await page.keyboard.press('Escape');

  await page.goto('/#/print');
  await page.getByRole('button', { name: 'New service order' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await d.getByLabel('Name', { exact: true }).fill('Kaye Dela Cruz');
  // The size guide counts from the cut area.
  await expect(d.getByLabel('Sticker size (optional)').locator('option', { hasText: '2 × 2 in · 15 per sheet' })).toHaveCount(1);
  await expect(d.getByText(/Cricut cut area: 7\.2 × 10\.62 in, 3 mm apart/)).toBeVisible();
  // Their own 2.3 × 1.7 in: 16 a sheet, turned sideways.
  await d.getByLabel('Sticker size (optional)').selectOption({ label: 'Custom size…' });
  await d.getByLabel('Sticker width in inches').fill('2.3');
  await d.getByLabel('Sticker height in inches').fill('1.7');
  await expect(d.locator('.sheet-fit')).toContainText('16 stickers of 2.3 × 1.7 in on one A4');
  await expect(d.locator('.sheet-fit')).toContainText('4 across × 4 down, turned sideways');
  await expect(d.locator('.sheet-preview rect[rx]')).toHaveCount(17);
  // 50 stickers: 4 sheets make 64.
  await d.getByRole('button', { name: 'Sticker count' }).click();
  await d.getByLabel('How many stickers').fill('50');
  await expect(d.getByText('4 A4 sheets make 64, 14 spare.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/print-custom-size.png`, fullPage: true });
  await d.getByRole('button', { name: 'Add to the order' }).click();
  const line = d.locator('.list-item', { hasText: '2.3 × 1.7 in: 50 stickers, 64 fit on 4 sheets' });
  await expect(line).toContainText('4 × ₱80.00 · 4 A4 sheets');
  await expect(line).toContainText('₱320');
  await d.getByRole('button', { name: 'Save service order' }).click();
  await expect(page.getByRole('article', { name: /Service order P[A-Z]-001/ })).toContainText('2.3 × 1.7 in: 50 stickers');
  expect(errors).toEqual([]);
});
