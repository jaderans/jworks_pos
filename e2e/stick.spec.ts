import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, offScreen, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

test('Couple-of-Stickers: paid at the register, details and mini stickers, two stubs, checked on the customer screen, made, shown off and handed over', async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The print dialog is replaced: the test reads what would have printed.
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(document.querySelector('.stub-print')?.textContent ?? '');
    };
  });
  // The studio's Google script: the finished design CS01-Leanna.png in Drive → Custom stickers.
  const png = fs.readFileSync('src/assets/brand/logo-256.png').toString('base64');
  // Empty until the illustrator saves the finished design, after the order is made.
  let designs: { id: string; name: string; type: string; size: number; updated: number }[] = [];
  await context.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const reply = body.ping
      ? { ok: true, remaining: 90, drive: true }
      : body.action === 'drive.list'
        ? { ok: true, files: designs }
        : body.action === 'drive.get'
          ? { ok: true, type: 'image/png', data: png }
          : { ok: true, remaining: 90 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await setEventPrice(page, 'Couple Pack (live)', 240);
  await setEventPrice(page, 'Enamel Pins', 50);
  await page.goto('/#/settings?section=email');
  await page.getByLabel('Mailer link').fill('https://script.google.com/macros/s/TEST/exec');
  await page.getByLabel('Mailer key').fill('test-key');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.getByText(/The mailer answered/)).toBeVisible();
  // Settings → Couple-of-Stickers knows the pack by its name.
  await expect(page.locator('#s-stick').locator('.list-item', { hasText: 'Couple Pack (live)' })).toContainText('Couple Pack');

  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // A Couple Pack and pins, paid: the details open by themselves.
  await tapProduct(page, 'Couple Pack (live)', 1);
  await tapProduct(page, 'Enamel Pins', 1);
  await payCash(page);
  const d = page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0001/ });
  await expect(d).toBeVisible();
  await expect(d.getByRole('region', { name: /Pack 1: Couple Pack \(live\)/ })).toContainText('C');
  await expect(d.getByLabel('Design no.')).toHaveValue('CS01');
  const check = screen.getByRole('region', { name: 'Your Couple-of-Stickers order' });
  await expect(check).toContainText('Please check your order');

  await d.getByLabel('Name or nickname').fill('Leanna');
  await d.getByLabel('Email', { exact: true }).fill('leanna@jw.test');
  await d.getByText('They want a soft copy').click();
  await d.getByRole('group', { name: 'How pack 1 is made' }).getByRole('button', { name: 'Illustrating' }).click();
  await d.getByRole('button', { name: 'Pick 6 mini stickers' }).click();
  const picker = d.getByRole('group', { name: 'Mini stickers for pack 1' });
  for (const m of ['01 Digital Pencil', '02 Laptop', '11 Newspaper', '28 Basketball', '33 Sleeping Cat', '43 Money Stack']) await picker.getByRole('button', { name: m }).click();
  await expect(picker).toContainText('6 of 6');
  await expect(picker.getByRole('button', { name: '07 Book' })).toBeDisabled();
  await d.getByLabel('Note').fill('Holding hands, a cat between them');
  await expect(d.getByText(/Ready in 30–40 minutes/)).toBeVisible();
  await expect(d.getByText('Add-ons:')).toBeVisible();
  // The customer checks it on their screen as it's filled in.
  await expect(check).toContainText('Leanna');
  await expect(check.locator('.cd-order-minis img')).toHaveCount(6);
  await expect(check).toContainText('We draw it');
  await screen.screenshot({ path: `${SHOTS}/stick-check.png` });
  await screen.setViewportSize({ width: 1080, height: 1920 });
  await screen.waitForTimeout(400);
  expect(await offScreen(screen)).toEqual([]);
  await screen.screenshot({ path: `${SHOTS}/stick-check-portrait.png` });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: `${SHOTS}/stick-dialog.png` });

  // Saved and printed: one number for everything they bought, on both stubs.
  await d.getByRole('button', { name: 'Save and print stubs' }).click();
  await expect(d).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed.length)).toBe(1);
  const stubs = await page.evaluate(() => (window as unknown as { __printed: string[] }).__printed[0]);
  for (const t of ['Stick Together', 'Claim stub', 'Wait for your number to be called.', 'Enjoy the rest of the event while we make your stickers!', 'Leanna', 'C · Illustrating', 'CS01-Leanna.png', 'Minis: 01, 02, 11, 28, 33, 43', 'Add-ons: 1 × Enamel Pins', 'Soft copy: leanna@jw.test', 'Note: Holding hands']) expect(stubs).toContain(t);
  await expect(check).toContainText('Your number');
  await expect(check.locator('.cd-order-no')).toHaveText('01');
  await screen.screenshot({ path: `${SHOTS}/stick-number.png` });
  const receipt = page.getByRole('dialog', { name: /^Sale [A-Z]-0001/ });
  await expect(receipt.getByText(/Couple-of-Stickers Q[A-Z]-01 is on Orders/)).toBeVisible();
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // On Orders: the details, the design not in Drive yet, then in Drive.
  await page.goto('/#/orders');
  const card = page.getByRole('article', { name: /Order Q[A-Z]-01/ });
  await expect(card).toContainText('Claim stub 01');
  await expect(card).toContainText('C · Illustrating');
  await expect(card).toContainText('CS01-Leanna.png · not in Drive yet');
  await expect(card).toContainText('₱290 by Cash');
  await expect(card.getByRole('group', { name: 'Mini stickers for pack 1' }).or(card.getByLabel('Mini stickers for pack 1')).locator('img')).toHaveCount(6);
  await expect(card.getByRole('button', { name: 'Show on customer screen' })).toBeDisabled();
  designs = [{ id: 'f1', name: 'CS01-Leanna.png', type: 'image/png', size: 9000, updated: 1 }];
  await page.getByRole('button', { name: 'Check Drive for designs' }).click();
  await expect(card).toContainText('CS01-Leanna.png · in Drive');
  await page.screenshot({ path: `${SHOTS}/stick-orders.png`, fullPage: true });
  await card.getByRole('button', { name: 'Show on customer screen' }).click();
  const show = screen.getByRole('region', { name: 'Fresh from the booth' });
  await expect(show).toContainText('Order 01');
  await expect(show).toContainText('Leanna’s Couple-of-Stickers');
  await screen.waitForTimeout(800);
  await screen.screenshot({ path: `${SHOTS}/stick-showcase.png` });

  // Made, called by the number on their stub, and handed over with nothing more to pay.
  await card.getByRole('button', { name: 'Start' }).click();
  await card.getByRole('button', { name: 'Ready' }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Now calling' })).toContainText('01');
  await card.getByRole('button', { name: 'Hand over' }).click();
  await page.getByRole('dialog', { name: /Hand over Q[A-Z]-01/ }).getByRole('button', { name: 'Hand over' }).click();
  await expect(page.getByText(/Picked up and cancelled \(1\)/)).toBeVisible();
  // Still just the one sale.
  await page.goto('/#/sales');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(errors).toEqual([]);
});
