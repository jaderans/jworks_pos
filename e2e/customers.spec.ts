import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

test('customers earn stamps, use a reward and a voucher at the register', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);

  // Stamp card: a stamp per ₱100, two stamps take ₱50 off.
  await page.goto('/#/customers');
  await page.getByRole('button', { name: 'Stamp card' }).click();
  await page.getByText('Give stamps at the register').click();
  await page.getByLabel('One stamp for every').fill('100');
  await page.getByLabel('Stamps for a reward').fill('2');
  await page.getByLabel('Pesos off').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/2 stamps take ₱50 off/)).toBeVisible();

  // A ₱20 voucher.
  await page.getByRole('button', { name: 'Vouchers' }).click();
  await page.getByRole('button', { name: 'New voucher' }).click();
  await page.getByLabel('Code').fill('fair20');
  await page.getByLabel('Pesos off').fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /FAIR20/ })).toBeVisible();

  // Sale 1: a new customer added at the register.
  await openRegister(page);
  const cart = page.locator('.reg-cart');
  await tapProduct(page, 'Cat Meme (Solo)', 5);
  await cart.getByRole('button', { name: 'Customer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kaye Dela Cruz');
  await page.getByLabel('Mobile number').fill('0917 123 4567');
  await page.getByRole('button', { name: 'Add and use' }).click();
  await expect(cart.locator('.cust-chip')).toContainText('Kaye Dela Cruz');
  await expect(cart.locator('.cust-chip')).toContainText('0 stamps');
  await payCash(page);
  await expect(page.getByRole('dialog', { name: /^Sale A-0001/ })).toContainText(/For Kaye Dela Cruz.*\+1 stamp, 1 on the card/);
  await page.getByRole('button', { name: 'New sale' }).click();

  // Sale 2: found by phone; the second stamp makes a reward ready.
  await tapProduct(page, 'Cat Meme (Solo)', 5);
  await cart.getByRole('button', { name: 'Customer' }).click();
  await page.getByRole('dialog').getByRole('searchbox').fill('4567');
  await page.getByRole('dialog').getByRole('button', { name: /Kaye Dela Cruz/ }).click();
  await payCash(page);
  await expect(page.getByRole('dialog', { name: /^Sale A-0002/ })).toContainText('₱50 off ready next time');
  await page.getByRole('button', { name: 'New sale' }).click();

  // Sale 3: a wrong code is explained; then the reward and the voucher both come off.
  await tapProduct(page, 'Cat Meme (Solo)', 5);
  await cart.getByRole('button', { name: 'Voucher' }).click();
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill('nope');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('dialog')).toContainText('There’s no voucher with the code NOPE');
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill('FAIR20');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await cart.getByRole('button', { name: 'Customer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Kaye Dela Cruz/ }).click();
  await cart.getByRole('button', { name: /Use reward/ }).click();
  await expect(cart.locator('.total-row')).toContainText('₱30');
  await page.screenshot({ path: `${SHOTS}/customers-cart.png` });
  await payCash(page);
  const receipt = page.getByRole('dialog', { name: /^Sale A-0003/ });
  await expect(receipt).toContainText('FAIR20');
  await expect(receipt).toContainText('Loyalty reward');
  await page.getByRole('button', { name: 'New sale' }).click();

  // The customer list adds it all up: 3 visits, ₱230 spent, the reward used.
  await page.goto('/#/customers');
  const row = page.getByRole('row', { name: /Kaye Dela Cruz/ });
  await expect(row).toContainText('3');
  await expect(row).toContainText('₱230');
  await page.screenshot({ path: `${SHOTS}/customers-list.png` });
  await page.getByRole('button', { name: 'Vouchers' }).click();
  await expect(page.getByRole('row', { name: /FAIR20/ })).toContainText('1');
  expect(errors).toEqual([]);
});
