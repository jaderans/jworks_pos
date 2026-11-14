import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, offScreen, openRegister, setEventPrice, setupOwner, tapProduct } from './helpers';

/** A tall monitor, turned on its side: every view of the customer screen fits, nothing cut off. */
test('the customer screen on a portrait (vertical) monitor: every view fits', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  for (const [p, n] of [['Cat Meme (Solo)', 25], ['Enamel Pins', 50], ['Couple Pack (live)', 240]] as const) await setEventPrice(page, p, n);
  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1080, height: 1920 });
  const fits = async (name: string, s: Page = screen) => {
    await s.waitForTimeout(500);
    expect(await offScreen(s), name).toEqual([]);
    await s.screenshot({ path: `${SHOTS}/portrait-${name}.png` });
  };

  await expect(screen.getByRole('heading', { name: 'Welcome!' })).toBeVisible();
  await fits('welcome');
  // (The Couple-of-Stickers view in portrait is checked in stick.spec.)
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await tapProduct(page, 'Enamel Pins', 2);
  await expect(screen.getByRole('region', { name: 'Your order' }).locator('.cd-total')).toContainText('₱175');
  await fits('cart');
  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  await expect(screen.getByRole('region', { name: 'Payment' })).toBeVisible();
  await fits('paying');
  const charge = page.getByRole('dialog', { name: /^Charge/ });
  await charge.getByRole('button', { name: /^Exact/ }).click();
  await charge.getByRole('button', { name: /Complete sale/ }).click();
  await expect(screen.getByRole('img', { name: 'Receipt QR code' })).toBeVisible();
  await fits('thanks');
  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(screen.locator('.cd')).toHaveAttribute('data-view', 'idle', { timeout: 40_000 });
  const stage = screen.locator('.cd-full .sl-stage');
  await expect(stage).toHaveAttribute('data-slide', 'prices', { timeout: 30_000 });
  await fits('idle-prices');
  expect(errors).toEqual([]);
});
