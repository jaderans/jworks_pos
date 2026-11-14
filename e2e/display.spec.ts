import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, setEventPrice, setupOwner, tapProduct } from './helpers';

test('the customer screen follows the sale: items and total, paying, thank-you, then idle', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await setEventPrice(page, 'Cat Meme (Solo)', 25);
  await setEventPrice(page, 'Enamel Pins', 50);
  await openRegister(page);

  // The register opens the customer screen in its own window.
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await expect(screen.getByRole('heading', { name: 'Welcome!' })).toBeVisible();

  // Ringing up shows on the customer's side, newest last, with the total.
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await tapProduct(page, 'Enamel Pins', 1);
  const order = screen.getByRole('region', { name: 'Your order' });
  await expect(order.locator('.cd-lines li')).toHaveCount(2);
  await expect(order.locator('.cd-lines li').first()).toContainText('3 ×Cat Meme (Solo)₱75');
  await expect(order.locator('.cd-total')).toContainText('₱125');
  await expect(order.locator('.cd-total')).toContainText('4 items');
  await screen.screenshot({ path: `${SHOTS}/display-cart.png` });

  // Paying: the amount, big.
  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  const charge = page.getByRole('dialog', { name: /^Charge/ });
  await expect(screen.getByRole('region', { name: 'Payment' })).toContainText('₱125');
  await expect(screen.getByRole('region', { name: 'Payment' })).toContainText('Paying by Cash');
  await charge.getByRole('button', { name: /^Exact/ }).click();
  await charge.getByRole('button', { name: /Complete sale/ }).click();

  // Thank-you with the receipt QR, which stays up after the cashier starts a new sale.
  const thanks = screen.getByRole('region', { name: 'Thank you' });
  await expect(thanks).toContainText('Salamat!');
  await expect(thanks).toContainText('Paid ₱125');
  await expect(screen.getByRole('img', { name: 'Receipt QR code' })).toBeVisible();
  await screen.screenshot({ path: `${SHOTS}/display-thanks.png` });
  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(thanks).toBeVisible();

  // The next customer's first item replaces it straight away.
  await tapProduct(page, 'Enamel Pins', 1);
  await expect(screen.getByRole('region', { name: 'Your order' }).locator('.cd-total')).toContainText('₱50');
  await page.locator('.reg-cart').getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();

  // With nothing rung up for 20 seconds, it goes to the full-screen idle view.
  await expect(screen.locator('.cd')).toHaveAttribute('data-view', 'idle', { timeout: 30_000 });
  await expect(screen.getByRole('region', { name: 'Welcome' })).toBeVisible();
  const wide = await screen.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(0);

  // A small window still fits, the order above the brand.
  await screen.setViewportSize({ width: 800, height: 1000 });
  expect(await screen.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
