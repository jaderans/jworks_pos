import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, setEventPrice, setupOwner } from './helpers';

test('custom sticker designs from Google Drive flash on the customer screen with their number', async ({ page, context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The studio's Google script, with its Drive part: one design in the Custom stickers folder.
  const png = fs.readFileSync('src/assets/brand/logo-256.png').toString('base64');
  await context.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const reply = body.ping
      ? { ok: true, remaining: 90, drive: true }
      : body.action === 'drive.list'
        ? { ok: true, files: [{ id: 'f1', name: 'CS01-Couple.png', type: 'image/png', size: 9000, updated: 1 }] }
        : body.action === 'drive.get'
          ? { ok: true, type: 'image/png', data: png }
          : body.action === 'drive.folders'
            ? { ok: true, folders: { stickers: 'https://drive.google.com/drive/folders/STICKERS', photos: 'https://drive.google.com/drive/folders/PHOTOS', ads: 'https://drive.google.com/drive/folders/ADS' } }
            : { ok: true, remaining: 90 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await setEventPrice(page, 'Cat Meme (Solo)', 25);
  await page.goto('/#/settings?section=email');
  await page.getByLabel('Mailer link').fill('https://script.google.com/macros/s/TEST/exec');
  await page.getByLabel('Mailer key').fill('test-key');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.getByText(/The mailer answered/)).toBeVisible();

  // Settings → Customer screen: check Drive, quick slides for the test.
  await page.goto('/#/settings?section=display');
  const ds = page.locator('#s-display');
  await ds.getByLabel('Each slide shows for').fill('3');
  await ds.getByRole('button', { name: 'Check Drive now' }).click();
  await expect(page.getByText('1 design in Drive, 1 new')).toBeVisible();
  await expect(ds.getByRole('status')).toContainText('1 design on this device');
  await expect(ds.getByRole('link', { name: 'Open the folder' })).toHaveAttribute('href', 'https://drive.google.com/drive/folders/STICKERS');

  // On the customer screen's slides: the art, CS01 and Couple.
  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });
  const stage = screen.locator('.cd-side .sl-stage');
  await expect(stage).toHaveAttribute('data-slide', 'sticker', { timeout: 60_000 });
  await expect(stage.getByRole('img', { name: 'CS01 Couple' })).toBeVisible();
  await expect(stage.locator('.sl-code')).toHaveText('CS01');
  await expect(stage.getByRole('heading', { name: 'Couple' })).toBeVisible();
  await screen.screenshot({ path: `${SHOTS}/display-sticker.png` });
  expect(errors).toEqual([]);
});
