import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, setupOwner } from './helpers';

test('services: paid with no register open, it counts at the event; pins and keychains are Couple-of-Stickers add-ons, not services', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');

  // A simple illustration, ₱130.
  await page.goto('/#/print');
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New service order' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await d.getByLabel('Name', { exact: true }).fill('Leanna Rosales');
  await d.getByRole('button', { name: 'Illustration', exact: true }).click();
  await d.getByLabel('Tier').selectOption('simple');
  await d.getByLabel('Designs').fill('1');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  const design = 'Sticker illustration, small / simple: 1 design';
  await expect(d.locator('.list-item', { hasText: design })).toContainText('₱130');
  // No "Make it into": a pin or a keychain is an add-on sold with a Couple-of-Stickers pack.
  await expect(d.getByLabel(`Make ${design} into`)).toHaveCount(0);
  await expect(d.locator('.wf-row.total')).toContainText('₱130');
  await d.getByRole('button', { name: 'Save service order' }).click();

  // Paid in full by GCash with no register open: counted at the event, in no drawer.
  const card = page.getByRole('article', { name: /Service order P[A-Z]-001/ });
  await card.getByRole('button', { name: 'Payment' }).click();
  const pay = page.getByRole('dialog', { name: /Payment for P[A-Z]-001/ });
  await expect(pay.getByLabel('Count it at').locator('option:checked')).toHaveText('Hilway November 2026');
  await expect(pay.getByText(/a sale under Services at Hilway November 2026/)).toBeVisible();
  await pay.getByLabel('Amount').fill('130');
  await pay.getByLabel('Paid by').selectOption({ label: 'GCash' });
  await pay.getByLabel('Reference no.').fill('7781');
  await page.screenshot({ path: `${SHOTS}/services-pay-no-register.png` });
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(pay).toBeHidden();
  await expect(card).toContainText('Paid');

  // In the Sales log and the revenue; the booth sales stay ₱0.
  await page.goto('/#/sales');
  await expect(page.getByRole('row', { name: /Service/ })).toContainText('service order');
  await expect(page.getByRole('region', { name: 'Money in' })).toContainText(/Services\s*₱130/);
  await page.goto('/#/event');
  await expect(page.locator('.stat', { hasText: 'Gross sales' })).toContainText('₱0');
  await expect(page.locator('.stat', { hasText: 'Revenue' })).toContainText('₱130');

  // The rate card has no make-into add-ons any more.
  await page.goto('/#/print');
  await page.getByRole('button', { name: 'Rate card' }).click();
  await expect(page.getByLabel('Pin add-on')).toHaveCount(0);
  expect(errors).toEqual([]);
});
