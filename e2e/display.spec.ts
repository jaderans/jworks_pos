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

  // A poster for the customer screen's ads, kept on this laptop.
  await page.goto('/#/settings');
  const ads = page.locator('#s-display');
  await ads.getByLabel('Ad images or videos').setInputFiles('src/assets/brand/logo-256.png');
  await expect(ads.locator('.ad-row')).toContainText('logo-256');
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
  // Slides play beside the cart.
  await expect(screen.locator('.cd-side .sl-stage')).toBeVisible();
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
  // Full screen, the slides go round: the ad poster, then this event's prices.
  const stage = screen.locator('.cd-full .sl-stage');
  await expect(stage).toHaveAttribute('data-slide', 'media', { timeout: 20_000 });
  await expect(stage.locator('.sl-media img')).toBeVisible();
  await expect(stage).toHaveAttribute('data-slide', 'prices', { timeout: 20_000 });
  await expect(stage).toContainText('Cat Meme (Solo)');
  await expect(stage).toContainText('₱25');
  await screen.screenshot({ path: `${SHOTS}/display-idle-prices.png` });
  const wide = await screen.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(0);

  // A small window still fits, the order above the brand.
  await screen.setViewportSize({ width: 800, height: 1000 });
  expect(await screen.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('a ready order is called: "Now calling" on the customer screen', async ({ page }) => {
  test.setTimeout(90_000);
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  await screen.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('/#/orders');
  await page.getByRole('button', { name: 'New order' }).click();
  const d = page.getByRole('dialog', { name: 'New order' });
  await d.getByLabel('Name', { exact: true }).fill('Leanna Rosales');
  await d.getByRole('button', { name: 'Custom piece' }).click();
  await d.getByLabel('What it is').fill('Couple sticker');
  await d.getByLabel('Price each of Couple sticker').fill('240');
  await d.getByLabel('Take a deposit now').uncheck();
  await d.getByRole('button', { name: 'Save order' }).click();
  await page.getByRole('dialog', { name: 'Order saved' }).getByRole('button', { name: 'Done' }).click();

  const card = page.getByRole('article', { name: /Order Q[A-Z]-01/ });
  await card.getByRole('button', { name: 'Ready' }).click();
  const call = screen.getByRole('status').filter({ hasText: 'Now calling' });
  await expect(call).toContainText(/Q[A-Z]-01/);
  await expect(call).toContainText('Leanna, your order is ready!');
  // Behind it, the event's slides: the cashier isn't on Sell, so the screen uses the event picked on this laptop.
  await expect(screen.locator('.cd-full .sl-stage')).toBeVisible();
  await screen.waitForTimeout(700);
  await screen.screenshot({ path: `${SHOTS}/display-calling.png` });
  // Call again from the card.
  await expect(page.getByRole('article', { name: /Order Q[A-Z]-01/ }).getByRole('button', { name: 'Call' })).toBeVisible();
});
