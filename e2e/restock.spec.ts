import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

test('plan what to make from past sales, make it, and set the stock to bring', async ({ page }) => {
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

  // One kraft sleeve per sticker; a pack of 100 costs ₱150
  await page.goto('/#/production?tab=materials');
  await page.getByRole('row', { name: /Kraft paper sleeve, small/ }).getByRole('button', { name: /^Edit/ }).click();
  await page.getByLabel('Pack cost').fill('150');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Product costs' }).click();
  await page.getByRole('row', { name: /Cat Meme \(Solo\)/ }).click();
  await page.getByRole('button', { name: 'From a recipe' }).click();
  await page.getByRole('button', { name: 'Add a material' }).click();
  await page.getByRole('dialog').getByLabel('Material', { exact: true }).selectOption({ label: 'Kraft paper sleeve, small' });
  await page.getByLabel('Quantity per piece').fill('1');
  await page.getByRole('button', { name: 'Save cost' }).click();

  // The next event
  await page.goto('/#/events');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await createEvent(page, 'Art Fair Iloilo');

  // 3 sold in Komiket's 8 hours → 0.38 an hour → 3 expected in 8 hours → 4 with 20% extra
  await page.goto('/#/production?tab=plan');
  const target = page.getByLabel('Plan for');
  await target.selectOption((await target.locator('option', { hasText: 'Art Fair Iloilo' }).getAttribute('value'))!);
  await expect(page.getByText(/^From Komiket Iloilo \(8 h\)/)).toBeVisible();
  const row = page.getByRole('row', { name: /Cat Meme \(Solo\)/ });
  await expect(row.getByRole('cell')).toHaveText([/Cat Meme \(Solo\)/, '0.38', '3', '4', '0', '', /Make it/]);
  await expect(row.getByLabel('Make how many Cat Meme (Solo)')).toHaveValue('4');
  const buy = page.getByRole('row', { name: /Kraft paper sleeve, small/ });
  await expect(buy.getByRole('cell')).toHaveText(['Kraft paper sleeve, small', '4 pc', '0', '1 pack of 100', '₱150']);
  await page.screenshot({ path: `${SHOTS}/restock-plan.png`, fullPage: true });

  // The print sheet
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Print the plan' }).click()]);
  const pdfPath = 'test-results/restock-plan.pdf';
  await pdf.saveAs(pdfPath);
  expect(fs.readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

  // "Make it" opens the batch with the recipe filled in
  await row.getByRole('button', { name: 'Make it' }).click();
  const batch = page.getByRole('dialog', { name: 'Log a production batch' });
  await expect(batch.getByLabel('Product')).toHaveValue(/.+/);
  await expect(batch.getByLabel('Product').locator('option:checked')).toHaveText('Cat Meme (Solo)');
  await expect(batch.getByLabel('Pieces made')).toHaveValue('4');
  await expect(batch.getByLabel('Quantity used')).toHaveValue('4');
  await batch.getByRole('button', { name: 'Save batch' }).click();
  await expect(batch).toBeHidden();
  // The 3 sold at Komiket came out of studio stock no one had counted in, so 4 made leaves 1
  await expect(row.getByRole('cell').nth(4)).toHaveText('1');
  await expect(row.getByLabel('Make how many Cat Meme (Solo)')).toHaveValue('3');

  // Targets become Art Fair's stock to bring
  await page.getByRole('button', { name: 'Use as stock to bring' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Set stock to bring' }).click();
  await expect(page.getByText('Stock to bring set for Art Fair Iloilo')).toBeVisible();
  await page.goto('/#/event/stock');
  await expect(page.getByRole('heading', { name: 'Art Fair Iloilo', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Brought: Cat Meme (Solo)')).toHaveValue('4');
  expect(errors).toEqual([]);
});
