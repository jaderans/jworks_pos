import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, setEventPrice, setupOwner } from './helpers';

async function payExactCash(page: Page, amount: string) {
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Charge ${amount.replace('₱', '₱')}`) });
  await dialog.getByRole('button', { name: /^Exact/ }).click();
  await dialog.getByRole('button', { name: /Complete sale/ }).click();
}

test('a pre-order: deposit now (money in, not a sale), hand over later, drawer balances', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Enamel Pins', 30);
  await openRegister(page);

  // Take the order with a ₱55 deposit (half of ₱110)
  await page.goto('/#/orders');
  await page.getByRole('button', { name: 'New order' }).click();
  const dialog = page.getByRole('dialog', { name: 'New order' });
  await dialog.getByLabel('Name', { exact: true }).fill('Kaye Dela Cruz');
  await dialog.getByLabel('Mobile, email or @handle').fill('0917 123 4567');
  await dialog.getByLabel('Add a product').selectOption({ label: 'Enamel Pins · ₱30' });
  await dialog.getByRole('button', { name: 'Custom piece' }).click();
  await dialog.getByLabel('What it is').fill('Custom name sticker');
  await dialog.getByLabel('Price each of Custom name sticker').fill('80');
  await expect(dialog.getByText('Total ₱110')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save and take ₱55' }).click();
  await payExactCash(page, '₱55');
  await expect(page.getByRole('dialog', { name: /^Sale A-0001/ })).toContainText('Deposit · order Q');
  await page.getByRole('button', { name: 'Done' }).click();
  const ticket = page.getByRole('dialog', { name: 'Order saved' });
  await expect(ticket).toContainText(/Q[A-Z]-01/);
  await expect(ticket).toContainText('₱55 paid · ₱55 at pickup');
  await ticket.getByRole('button', { name: 'Done' }).click();

  const card = page.getByRole('article', { name: /Order Q[A-Z]-01/ });
  await expect(card).toContainText('₱55 due');

  // The deposit is money in, not a sale
  await page.goto('/#/event');
  await expect(page.locator('.stat', { hasText: 'Gross sales' })).toContainText('₱0');
  await expect(page.locator('.stat', { hasText: 'Deposits held' })).toContainText('₱55');

  // Make it, mark it ready, hand it over
  await page.goto('/#/orders');
  await card.getByRole('button', { name: 'Start' }).click();
  await card.getByRole('button', { name: 'Ready' }).click();
  await expect(page.getByText(/is ready\. A message for Kaye Dela Cruz is copied/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/orders-board.png` });
  await card.getByRole('button', { name: 'Hand over' }).click();
  await payExactCash(page, '₱55');
  const pickup = page.getByRole('dialog', { name: /^Sale A-0002/ });
  await expect(pickup).toContainText('1 × Enamel Pins');
  await expect(pickup).toContainText('1 × Custom name sticker');
  await expect(pickup).toContainText(/Order deposit \(Q[A-Z]-01\)/);
  await pickup.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/Picked up and cancelled \(1\)/)).toBeVisible();

  // Now it's a ₱110 sale; nothing held
  await page.goto('/#/event');
  await expect(page.locator('.stat', { hasText: 'Gross sales' })).toContainText('₱110');
  await expect(page.locator('.stat', { hasText: 'Deposits held' })).toContainText('₱0');
  await page.goto('/#/sales');
  await expect(page.getByText(/1 sale · ₱110 shown, plus ₱55 in order deposits/)).toBeVisible();

  // The drawer has both cash payments: ₱2,000 float + ₱55 + ₱55
  await page.goto('/#/sell');
  await page.getByRole('button', { name: 'Close register' }).click();
  const close = page.getByRole('dialog', { name: /Close register A/ });
  await close.getByLabel('Number of ₱1,000', { exact: true }).fill('2');
  await close.getByLabel('Number of ₱100', { exact: true }).fill('1');
  await close.getByLabel('Number of ₱10', { exact: true }).fill('1');
  await expect(close.getByText('Balanced', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
