import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';
import { STARTER_TASKS } from '../src/domain/plan';

test('plan an event with its checklist, then compare two events', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);

  // The starter checklist is already there
  const total = STARTER_TASKS.length;
  await page.goto('/#/event/plan');
  await expect(page.getByRole('heading', { name: 'Ready for Komiket Iloilo?' })).toBeVisible();
  await expect(page.getByText(`0 of ${total} done`)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Pay the booth fee and keep the receipt' }).check();
  await expect(page.getByText(`1 of ${total} done`)).toBeVisible();
  await page.getByLabel('Add to Pack').first().fill('Cricut and cutting mat');
  await page.getByLabel('Add to Pack').first().press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Cricut and cutting mat' })).toBeVisible();
  await expect(page.getByText(`1 of ${total + 1} done`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/plan-tab.png`, fullPage: true });
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: `Checklist: 1 of ${total + 1} done` })).toBeVisible();

  // Sell at the first event
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();

  // A second event with a smaller day
  await page.goto('/#/events');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await createEvent(page, 'Art Fair Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 25);
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 1);
  await payCash(page);
  await page.getByRole('button', { name: 'New sale' }).click();

  // Compare them
  await page.goto('/#/events');
  await page.getByRole('button', { name: 'Compare events' }).click();
  await expect(page.getByRole('heading', { name: 'Compare events', level: 1 })).toBeVisible();
  const table = page.locator('.compare-table');
  await expect(table.getByRole('columnheader', { name: 'Komiket Iloilo' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Art Fair Iloilo' })).toBeVisible();
  const salesRow = table.getByRole('row', { name: /^Sales ₱/ });
  await expect(salesRow).toContainText('₱60');
  await expect(salesRow).toContainText('₱25');
  await expect(salesRow.locator('td.best')).toHaveText('₱60');
  await page.screenshot({ path: `${SHOTS}/compare.png`, fullPage: true });
  expect(errors).toEqual([]);
});
