import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, setupOwner } from './helpers';

test('services: a design made into a pin and a keychain, paid with no register open, counts at the event', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');

  // The owner sets the add-ons: ₱30 on top of the design for a pin.
  await page.goto('/#/print');
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Rate card' }).click();
  await page.getByLabel('Pin add-on').fill('30');
  await page.getByRole('button', { name: 'Save rate card' }).click();

  // A simple illustration (₱100), made into a pin (₱100 + ₱30) and a keychain (₱100 + ₱0).
  await page.getByRole('button', { name: 'New service order' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await d.getByLabel('Name', { exact: true }).fill('Leanna Rosales');
  await d.getByRole('button', { name: 'Illustration', exact: true }).click();
  await d.getByLabel('Tier').selectOption('simple');
  await d.getByLabel('Designs').fill('1');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  const design = 'Sticker illustration, small / simple: 1 design';
  await expect(d.locator('.list-item', { hasText: design })).toContainText('₱100');
  await d.getByLabel(`Make ${design} into`).selectOption('pin');
  await d.getByLabel(`Make ${design} into`).selectOption('keychain');
  await expect(d.locator('.list-item', { hasText: `${design} as a pin` })).toContainText('₱130');
  await expect(d.locator('.list-item', { hasText: `${design} as a keychain` })).toContainText('₱100');
  await expect(d.locator('.wf-row.total')).toContainText('₱330');
  await page.screenshot({ path: `${SHOTS}/services-make-into.png` });
  await d.getByRole('button', { name: 'Save service order' }).click();

  // Paid in full by GCash with no register open: counted at the event, in no drawer.
  const card = page.getByRole('article', { name: /Service order P[A-Z]-001/ });
  await card.getByRole('button', { name: 'Payment' }).click();
  const pay = page.getByRole('dialog', { name: /Payment for P[A-Z]-001/ });
  await expect(pay.getByLabel('Count it at')).toHaveValue(/.+/);
  await expect(pay.getByLabel('Count it at').locator('option:checked')).toHaveText('Hilway November 2026');
  await expect(pay.getByText(/a sale under Services at Hilway November 2026/)).toBeVisible();
  await pay.getByLabel('Amount').fill('330');
  await pay.getByLabel('Paid by').selectOption({ label: 'GCash' });
  await pay.getByLabel('Reference no.').fill('7781');
  await page.screenshot({ path: `${SHOTS}/services-pay-no-register.png` });
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(pay).toBeHidden();
  await expect(card).toContainText('Paid');

  // In the Sales log and the revenue; the booth sales stay ₱0.
  await page.goto('/#/sales');
  await expect(page.getByRole('row', { name: /Service/ })).toContainText('service order');
  await expect(page.getByRole('region', { name: 'Money in' })).toContainText(/Services\s*₱330/);
  await page.goto('/#/event');
  await expect(page.locator('.stat', { hasText: 'Gross sales' })).toContainText('₱0');
  await expect(page.locator('.stat', { hasText: 'Revenue' })).toContainText('₱330');

  // A commission order: a custom piece made into a keychain.
  await page.goto('/#/orders');
  await page.getByRole('button', { name: 'New order' }).click();
  const o = page.getByRole('dialog', { name: 'New order' });
  await o.getByLabel('Name', { exact: true }).fill('Cenon Salazar');
  await o.getByRole('button', { name: 'Custom piece' }).click();
  await o.getByLabel('What it is').fill('Pet portrait');
  await o.getByLabel('Price each of Pet portrait').fill('240');
  await o.getByLabel('Make Pet portrait into').selectOption('pin');
  await expect(o.getByLabel('Price each of Pet portrait as a pin')).toHaveValue('270');
  await expect(o.getByText('Total ₱510')).toBeVisible();
  expect(errors).toEqual([]);
});
