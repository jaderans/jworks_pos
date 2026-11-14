import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/** Record money in or out of the open register. */
async function cashMove(page: Page, dir: 'In' | 'Out', money: 'Cash' | 'GCash', amount: string, reason: string) {
  await page.getByRole('button', { name: 'Cash in/out' }).click();
  const d = page.getByRole('dialog', { name: 'Cash in or out' });
  await d.getByRole('button', { name: dir, exact: true }).click();
  await d.getByLabel('Money').selectOption({ label: money });
  await d.getByLabel('Amount').fill(amount);
  await d.getByLabel('What for').fill(reason);
  await d.getByRole('button', { name: 'Record' }).click();
  await expect(d).toBeHidden();
}

test('money in: cash and GCash moves, a print order paid at the register, and the totals in the Sales log', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await setEventPrice(page, 'Cat Meme (Solo)', 25);
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 4);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();

  // Kaye's evening: ₱200 cash out of the drawer, ₱200 into GCash, then ₱100 cash back (recorded as out by mistake).
  await cashMove(page, 'Out', 'Cash', '200', 'GCash cash-out for a customer');
  await cashMove(page, 'In', 'GCash', '200', 'The customer’s GCash');
  await cashMove(page, 'Out', 'Cash', '100', 'Change back');

  // Sticker printing with illustration, paid by GCash at the open register.
  await page.goto('/#/print');
  await page.getByRole('button', { name: 'New service order' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await d.getByLabel('Name', { exact: true }).fill('Cenon Salazar');
  await d.getByLabel('A4 sheets').fill('3');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  await d.getByRole('button', { name: 'Illustration', exact: true }).click();
  await d.getByLabel('Tier').selectOption('detailed');
  await d.getByLabel('Designs').fill('2');
  await expect(d.getByText(/Rate card: ₱390, a set saving ₱50/)).toBeVisible();
  await d.getByRole('button', { name: 'Add to the order' }).click();
  await expect(d.locator('.list-item', { hasText: 'Sticker illustration, detailed: 2 designs' })).toContainText('₱390');
  await d.getByLabel('Who draws it').selectOption({ label: 'Joshua Ranin' });
  await d.getByLabel('Illustrator’s share').fill('50');
  await page.screenshot({ path: `${SHOTS}/money-print-illustration.png` });
  await d.getByRole('button', { name: 'Save service order' }).click();

  const card = page.getByRole('article', { name: /Service order P[A-Z]-001/ });
  await card.getByRole('button', { name: 'Payment' }).click();
  const pay = page.getByRole('dialog', { name: /Payment for P[A-Z]-001/ });
  await expect(pay.getByText(/It goes in register A as a sale under Services/)).toBeVisible();
  await pay.getByLabel('Amount').fill('300');
  await pay.getByLabel('Paid by').selectOption({ label: 'GCash' });
  await pay.getByLabel('Reference no.').fill('5012');
  await pay.getByRole('button', { name: 'Save payment' }).click();
  await expect(pay).toBeHidden();

  // The Sales log: the sale, the service, and every move, with the money by method.
  await page.goto('/#/sales');
  const money = page.getByRole('region', { name: 'Money in' });
  // Cash ₱100 − ₱200 − ₱100 = −₱200; GCash ₱300 + ₱200 = ₱500.
  await expect(money.locator('.money-method', { has: page.locator('.name', { hasText: /^Cash$/ }) })).toContainText('−₱200');
  await expect(money.locator('.money-method', { has: page.locator('.name', { hasText: /^GCash$/ }) })).toContainText('₱500');
  await expect(money.locator('.money-total')).toHaveText('₱300');
  await expect(money).toContainText(/Services\s*₱300/);
  await expect(money).toContainText(/should hold\s*₱1,800/);
  await expect(page.getByRole('row', { name: /Service/ })).toContainText('service order');
  await expect(page.locator('tr.cash-move')).toHaveCount(3);

  // Fix the ₱100: it went back in.
  await page.locator('tr.cash-move', { hasText: 'Change back' }).click();
  const fix = page.getByRole('dialog', { name: 'Cash move on register A' });
  await fix.getByRole('button', { name: 'In', exact: true }).click();
  await fix.getByRole('button', { name: 'Save' }).click();
  await expect(money.locator('.money-method', { has: page.locator('.name', { hasText: /^Cash$/ }) })).toContainText('₱0');
  await expect(money).toContainText(/should hold\s*₱2,000/);
  await page.screenshot({ path: `${SHOTS}/money-sales-log.png`, fullPage: true });

  // Only cash moves count in the drawer: ₱2,000 float + ₱100 sale − ₱200 + ₱100.
  await page.goto('/#/sell');
  await page.getByRole('button', { name: 'Close register' }).click();
  const close = page.getByRole('dialog', { name: /Close register A/ });
  await close.getByLabel('Number of ₱1,000', { exact: true }).fill('2');
  await expect(close.getByText('Balanced', { exact: true })).toBeVisible();
  await close.getByRole('button', { name: 'Cancel' }).first().click();

  // The release number.
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  expect(errors).toEqual([]);
});
