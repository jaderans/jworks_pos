import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

test('set up, price, sell, and see it in the summary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await setupOwner(page);
  await page.screenshot({ path: `${SHOTS}/01-new-event.png` });
  await createEvent(page, 'Test Fair 2026');

  // Edit prices opens after creating the event
  await expect(page.getByRole('link', { name: 'Edit prices' })).toHaveClass(/active/);
  await setEventPrice(page, 'Cat Meme (Solo)', 20);
  await setEventPrice(page, 'Couple Pack (live)', 200);
  await setEventPrice(page, 'Enamel Pins', 30);
  await page.screenshot({ path: `${SHOTS}/02-prices.png`, fullPage: true });

  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 4);
  await tapProduct(page, 'Couple Pack (live)', 2);
  await tapProduct(page, 'Enamel Pins', 1);
  await expect(page.locator('.reg-cart .total-row')).toContainText('₱510');
  await page.screenshot({ path: `${SHOTS}/03-register-cart.png` });

  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  await page.screenshot({ path: `${SHOTS}/04-payment.png` });
  await page.getByRole('dialog', { name: /^Charge/ }).getByRole('button', { name: /^Exact/ }).click();
  await page.getByRole('dialog', { name: /^Charge/ }).getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByRole('dialog', { name: /^Sale A-0001/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-receipt.png` });
  await page.getByRole('button', { name: 'New sale' }).click();

  await tapProduct(page, 'Enamel Pins', 2);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();

  await page.goto('/#/event');
  await expect(page.locator('.stat.hero .value')).toHaveText('₱570');
  await page.screenshot({ path: `${SHOTS}/06-summary.png`, fullPage: true });

  await page.goto('/#/sales');
  await expect(page.getByText('A-0002')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-sales-log.png` });

  // Dark mode
  await page.evaluate(() => localStorage.setItem('jwpos-theme', 'dark'));
  await page.goto('/#/sell');
  await page.reload();
  await tapProduct(page, 'Couple Pack (live)', 1);
  await page.screenshot({ path: `${SHOTS}/08-register-dark.png` });

  // Phone size
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/09-register-phone.png` });

  expect(errors.filter((e) => !/favicon|DEPRECATED_ENDPOINT/.test(e))).toEqual([]);
});
