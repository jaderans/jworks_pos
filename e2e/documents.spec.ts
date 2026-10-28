import fs from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

const DIR = 'test-results/docs';
const LEGAL = '/MediaBox [0 0 612 1008]';

async function save(page: Page, click: () => Promise<void>, name: string): Promise<string> {
  const [d] = (await Promise.all([page.waitForEvent('download'), click()])) as [Download, void];
  const path = `${DIR}/${name}.pdf`;
  await d.saveAs(path);
  return fs.readFileSync(path, 'latin1');
}

test('every document prints on the JoshWorks letterhead, like JoshWorks Studio', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');

  // An event's reports
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);
  await page.goto('/#/event/team');
  await page.getByRole('button', { name: 'Add to roster' }).click();
  for (const n of ['Kaye', 'Harvey', 'CJ']) await page.getByRole('dialog').locator('.list-item', { hasText: n }).getByRole('button', { name: 'Add' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();
  await page.goto('/#/event/report');
  for (const [card, name] of [['Full event report', 'event-report'], ['One-page summary', 'summary'], ['Payout slips', 'payout-slips'], ['End of day', 'end-of-day']] as const) {
    const pdf = await save(page, () => page.locator('.card', { hasText: card }).getByRole('button', { name: /Download PDF/ }).click(), name);
    expect(pdf.startsWith('%PDF-'), name).toBe(true);
    expect(pdf, name).toContain(LEGAL);
  }

  // A GCash QR, so the quote shows where to pay
  await page.goto('/#/settings');
  await page.locator('.list-item', { hasText: 'GCash' }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#pm-qr').setInputFiles('public/icons/icon-192.png');
  await expect(page.getByRole('img', { name: 'QR code' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  // The quotation
  await page.goto('/#/calculator');
  await page.locator('#sq-project').fill('Environmental Workbook');
  await page.locator('#sq-client').fill('DepEd Iloilo');
  const quote = await save(page, () => page.getByRole('button', { name: 'Quote PDF' }).click(), 'quote');
  expect(quote).toContain(LEGAL);
  // The letterhead frame and the QR are both images on the page
  expect((quote.match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
