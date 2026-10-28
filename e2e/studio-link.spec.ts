import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';
import type { StudioEventFeed, StudioOrderFeed } from '../src/db/types';

test('send an event and an order to JoshWorks Studio, and download the Studio file', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();

  // Event → Report → Send to Studio
  await page.goto('/#/event/report');
  const card = page.locator('.card', { hasText: 'JoshWorks Studio' });
  await card.getByRole('button', { name: 'Send to Studio' }).click();
  await expect(page.getByText('Sent. In JoshWorks Studio on this device: Money → Booth events.')).toBeVisible();
  await expect(card.getByText('Sent', { exact: true })).toBeVisible();
  await expect(card).toContainText('by Joshua Ranin');
  await page.screenshot({ path: `${SHOTS}/studio-card.png`, fullPage: true });

  // Another sale: the card says to send it again
  await page.goto('/#/sell');
  await tapProduct(page, 'Cat Meme (Solo)', 1);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();
  await page.goto('/#/event/report');
  await expect(card.getByText('Changed since sent')).toBeVisible();

  // A commission order
  await page.goto('/#/orders');
  await page.getByRole('button', { name: 'New order' }).click();
  const dialog = page.getByRole('dialog', { name: 'New order' });
  await dialog.getByLabel('Name', { exact: true }).fill('Kaye Dela Cruz');
  await dialog.getByLabel('Mobile, email or @handle').fill('0917 123 4567');
  await dialog.getByRole('button', { name: 'Custom piece' }).click();
  await dialog.getByLabel('What it is').fill('Custom portrait');
  await dialog.getByLabel('Price each of Custom portrait').fill('500');
  await dialog.getByText('Take a deposit now').click();
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await page.getByRole('dialog', { name: 'Order saved' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Send Q[A-Z]-01 to Studio$/ }).click();
  await expect(page.getByText(/Q[A-Z]-01 sent to JoshWorks Studio/)).toBeVisible();

  // The file for Studio on another device has both, with the latest numbers
  await page.goto('/#/event/report');
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download Studio file' }).click()]);
  expect(download.suggestedFilename()).toMatch(/for JoshWorks Studio\.json$/);
  const path = 'test-results/studio-file.json';
  await download.saveAs(path);
  const file = JSON.parse(fs.readFileSync(path, 'utf8')) as { app: string; kind: string; v: number; feeds: (StudioEventFeed | StudioOrderFeed)[] };
  expect(file).toMatchObject({ app: 'jworks-pos', kind: 'studio-feed', v: 1 });
  const ev = file.feeds.find((f): f is StudioEventFeed => f.type === 'event')!;
  expect(ev).toMatchObject({ name: 'Komiket Iloilo', gross: 8000, transactions: 2, itemsSold: 4 });
  expect(ev.methods.reduce((a, m) => a + m.amount, 0)).toBe(ev.gross);
  const order = file.feeds.find((f): f is StudioOrderFeed => f.type === 'order')!;
  expect(order).toMatchObject({ total: 50000, customer: { name: 'Kaye Dela Cruz', phone: '0917 123 4567' }, lines: [{ name: 'Custom portrait', qty: 1, unitPrice: 50000 }] });
  await expect(card.getByText('Sent', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
