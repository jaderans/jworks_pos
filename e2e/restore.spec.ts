import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/** Moving to a new phone or browser: back up on one device, restore on a fresh one, carry on as the owner. */
test('restore a backup onto a fresh device', async ({ browser }) => {
  test.setTimeout(180_000);
  const oldCtx = await browser.newContext();
  const old = await oldCtx.newPage();
  await setupOwner(old, 'Joshua David Ranin', '147369');
  await createEvent(old, 'Komiket Iloilo');
  await setEventPrice(old, 'Cat Meme (Solo)', 20);
  await openRegister(old);
  await tapProduct(old, 'Cat Meme (Solo)', 2);
  await payCash(old);
  await expect(old.getByRole('dialog', { name: /^Sale A-0001/ })).toBeVisible();
  await old.getByRole('button', { name: 'New sale' }).click();

  await old.goto('/#/settings');
  const [download] = await Promise.all([old.waitForEvent('download'), old.getByRole('button', { name: 'Download file' }).click()]);
  const file = test.info().outputPath('backup.json');
  await download.saveAs(file);
  await oldCtx.close();

  const freshCtx = await browser.newContext();
  const page = await freshCtx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /Restore from a backup file/ }).click();
  await page.getByLabel('Backup file').setInputFiles(file);
  await expect(page.getByText(/signed in as/)).toContainText('Joshua David Ranin');
  await page.screenshot({ path: `${SHOTS}/restore-setup.png` });
  await page.getByRole('button', { name: 'Restore', exact: true }).click();

  const chip = page.getByRole('button', { name: 'Account and settings' });
  await expect(chip).toContainText('Joshua David Ranin');
  await expect(chip).toContainText('Owner');
  await expect(page.locator('.dash-hero')).toBeVisible();

  // The event and its sale came over, and the next receipt doesn't repeat A-0001.
  await page.getByRole('button', { name: 'Change event' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Komiket Iloilo/ }).click();
  await page.goto('/#/sales');
  await expect(page.getByText('A-0001')).toBeVisible();
  await page.goto('/#/sell');
  const open = page.getByRole('button', { name: 'Open register' });
  if (await open.isVisible()) await open.click();
  await tapProduct(page, 'Cat Meme (Solo)', 1);
  await payCash(page);
  await expect(page.getByRole('dialog', { name: /^Sale A-0002/ })).toBeVisible();

  // The owner PIN came over too: switching to a designer and back asks for it.
  await page.getByRole('button', { name: 'New sale' }).click();
  await chip.click();
  await page.getByRole('button', { name: 'Switch person' }).click();
  await page.getByRole('dialog').locator('.list-item', { hasText: 'Kaye' }).click();
  await expect(chip).toContainText('Kaye');
  await chip.click();
  await page.getByRole('button', { name: 'Switch person' }).click();
  await page.getByRole('dialog').locator('.list-item', { hasText: 'Joshua David Ranin' }).click();
  await expect(page.getByRole('dialog', { name: /PIN/i })).toBeVisible();
  expect(errors).toEqual([]);
  await freshCtx.close();
});
