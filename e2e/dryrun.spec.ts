import fs from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, setEventPrice, setupOwner, tapProduct } from './helpers';

/**
 * Phase 1 "ready when": a dry-run event with 50 test sales on two phones in
 * airplane mode, a register close, a merge, and the PDF, balancing to the peso.
 */

type Pattern = { taps: [string, number][]; pay: 'cash' | 'gcash'; total: number };
const PATTERNS: Pattern[] = [
  { taps: [['Couple Pack (live)', 1]], pay: 'cash', total: 200 },
  { taps: [['Cat Meme (Solo)', 4]], pay: 'cash', total: 75 }, // bundle: 4 for ₱75
  { taps: [['Enamel Pins', 2]], pay: 'gcash', total: 60 },
  { taps: [['Cat Meme (Solo)', 5], ['Enamel Pins', 1]], pay: 'cash', total: 75 + 20 + 30 },
];

async function sellPattern(page: Page, p: Pattern, ref: string) {
  for (const [name, n] of p.taps) await tapProduct(page, name, n);
  await expect(page.locator('.reg-cart .total-row')).toContainText(`₱${p.total}`);
  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Charge/ });
  if (p.pay === 'cash') {
    await dialog.getByRole('button', { name: /^Exact/ }).click();
  } else {
    await dialog.getByRole('button', { name: 'GCash' }).click();
    await dialog.getByLabel('Reference number').fill(ref);
  }
  await dialog.getByRole('button', { name: /Complete sale/ }).click();
  await page.getByRole('button', { name: 'New sale' }).click();
}

function denominations(pesos: number): Record<string, number> {
  const out: Record<string, number> = {};
  let rest = pesos;
  for (const d of [1000, 500, 200, 100, 50, 20, 10, 5, 1]) {
    const n = Math.floor(rest / d);
    if (n) out[String(d)] = n;
    rest -= n * d;
  }
  return out;
}

async function exportFile(page: Page, path: string) {
  await page.goto('/#/settings?section=devices');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download file' }).click()]);
  await download.saveAs(path);
}

async function mergeFile(page: Page, path: string) {
  await page.goto('/#/settings?section=devices');
  await page.locator('input[type=file][accept*="json"]').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Merge this file?' });
  await dialog.getByRole('button', { name: 'Merge' }).click();
  await expect(dialog.getByText('Merged', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
}

test('dry run: two phones offline, 50 sales, close, merge, PDF', async ({ browser }) => {
  test.setTimeout(300_000);
  const a: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const b: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const pa = await a.newPage();
  const pb = await b.newPage();

  // ---- Phone A: owner sets everything up while online
  await setupOwner(pa, 'Test Owner', '2468');
  await pa.getByLabel('Event name').fill('Dry Run Fair');
  await pa.getByLabel('Booth fee (optional)').fill('1500');
  await pa.getByRole('button', { name: 'Create event' }).click();
  await expect(pa.getByRole('heading', { name: 'Dry Run Fair', level: 1 })).toBeVisible();
  await setEventPrice(pa, 'Cat Meme (Solo)', 20);
  await setEventPrice(pa, 'Couple Pack (live)', 200);
  await setEventPrice(pa, 'Enamel Pins', 30);

  await pa.goto('/#/products');
  await pa.getByRole('button', { name: 'Bundle deals' }).click();
  await pa.getByRole('button', { name: /Add bundle deal/ }).click();
  const bd = pa.getByRole('dialog', { name: 'New bundle deal' });
  await bd.getByLabel('Name on the receipt').fill('Cat Meme 4-pack');
  await bd.getByLabel('How many').fill('4');
  await bd.getByLabel('For', { exact: true }).fill('75');
  await bd.getByRole('button', { name: /^Cat Meme \(Solo\)/ }).click();
  await bd.getByRole('button', { name: 'Save deal' }).click();

  // Make sure the offline cache is in control before going offline
  await pa.evaluate(() => navigator.serviceWorker.ready);
  await pa.reload();
  await pa.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
  });

  // Hand phone B the setup by file
  const setupFile = 'test-results/setup-from-a.json';
  await exportFile(pa, setupFile);

  // ---- Phone B joins by merge file, as register B
  await pb.goto('/');
  await pb.getByRole('button', { name: /Add this device/ }).click();
  await pb.getByLabel('Register letter').fill('B');
  await pb.getByRole('button', { name: 'Continue' }).click();
  await mergeFile(pb, setupFile);
  await pb.getByRole('button', { name: 'Change event' }).click();
  await pb.getByRole('dialog', { name: 'Choose the event' }).getByRole('button', { name: /Dry Run Fair/ }).click();

  // ---- Airplane mode for both phones
  await a.setOffline(true);
  await b.setOffline(true);

  // Phone A reloads with no internet: the app must still open
  await pa.goto('/#/sell');
  await pa.reload();
  await expect(pa.getByRole('button', { name: 'Open register' })).toBeVisible();
  await pa.getByRole('button', { name: 'Open register' }).click();

  let totalA = 0;
  let cashA = 0;
  for (let i = 0; i < 30; i++) {
    const p = PATTERNS[i % PATTERNS.length];
    await sellPattern(pa, p, `A${1000 + i}`);
    totalA += p.total;
    if (p.pay === 'cash') cashA += p.total;
  }
  await pa.screenshot({ path: `${SHOTS}/10-dryrun-a-offline.png` });

  await openRegister(pb);
  let totalB = 0;
  for (let i = 0; i < 20; i++) {
    const p = PATTERNS[(i + 1) % PATTERNS.length];
    await sellPattern(pb, p, `B${2000 + i}`);
    totalB += p.total;
  }

  // Close register A: count exactly what should be there (₱2,000 float + cash sales)
  await pa.getByRole('button', { name: 'Close register' }).click();
  const close = pa.getByRole('dialog', { name: /Close register A/ });
  const expected = 2000 + cashA;
  await expect(close.getByText('Expected in the drawer')).toBeVisible();
  for (const [k, n] of Object.entries(denominations(expected))) await close.getByLabel(`Number of ₱${Number(k).toLocaleString('en-PH')}`, { exact: true }).fill(String(n));
  await expect(close.getByText('Balanced', { exact: true })).toBeVisible();
  await pa.screenshot({ path: `${SHOTS}/11-close-register.png` });
  await close.getByRole('button', { name: 'Close register' }).click();
  await pa.getByRole('dialog', { name: 'Close the register?' }).getByRole('button', { name: 'Close register' }).click();
  await expect(pa.getByText('Balanced to the peso')).toBeVisible();
  await pa.getByRole('button', { name: 'Done' }).click();

  // B sends its sales to A (still offline: a file, like Nearby Share)
  const fromB = 'test-results/sales-from-b.json';
  await exportFile(pb, fromB);
  await mergeFile(pa, fromB);

  // Everything adds up on A
  await pa.goto('/#/event');
  await expect(pa.locator('.stat.hero .value')).toHaveText(`₱${(totalA + totalB).toLocaleString('en-PH')}`);
  await expect(pa.locator('.stat', { hasText: 'Transactions' }).locator('.value')).toHaveText('50');
  await pa.screenshot({ path: `${SHOTS}/12-summary-merged.png`, fullPage: true });

  await pa.goto('/#/sales');
  await expect(pa.getByText('B-0020')).toBeVisible();
  await expect(pa.getByText('A-0030')).toBeVisible();

  // The full PDF report, made offline
  await pa.goto('/#/event/report');
  const [pdf] = await Promise.all([pa.waitForEvent('download'), pa.locator('.card', { hasText: 'Full event report' }).getByRole('button', { name: /Download PDF/ }).click()]);
  const pdfPath = 'test-results/dry-run-report.pdf';
  await pdf.saveAs(pdfPath);
  const head = fs.readFileSync(pdfPath).subarray(0, 5).toString();
  expect(head).toBe('%PDF-');
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(20_000);

  const [summaryPdf] = await Promise.all([pa.waitForEvent('download'), pa.locator('.card', { hasText: 'One-page summary' }).getByRole('button', { name: /Download PDF/ }).click()]);
  await summaryPdf.saveAs('test-results/dry-run-summary.pdf');

  console.log(`Dry run: A ₱${totalA} (cash ₱${cashA}) + B ₱${totalB} = ₱${totalA + totalB}, 50 sales, drawer balanced at ₱${expected}.`);
  await a.close();
  await b.close();
});
