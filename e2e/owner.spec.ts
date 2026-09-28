import { expect, test, type Page } from '@playwright/test';
import { SHOTS } from './helpers';

/** The owner can't be locked out: editing your own entry into someone else is refused, and a device already stuck can recover. */

async function setupWithoutTeam(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Set up JoshWorks POS/ }).click();
  await page.getByLabel('Your name (owner)').fill('Owner');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByLabel(/Team names and role weights/).uncheck();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.keyboard.press('Escape');
}

const chip = (page: Page) => page.getByRole('button', { name: 'Account and settings' });

test('the owner can’t be edited away, and a stuck device can restore one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupWithoutTeam(page);

  // The mistake: open your own row in Team and turn it into the new designer.
  await page.goto('/#/team');
  await page.getByRole('row', { name: /Owner/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Owner' });
  await expect(dialog.getByText('This is you.')).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Ian Harvey Yap');
  await dialog.getByLabel('App role').selectOption('designer');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/JoshWorks needs at least one owner/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(chip(page)).toContainText('Owner');

  // A device already stuck from the old version: the only person is a designer.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('jworks-pos');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('members', 'readwrite');
          const store = tx.objectStore('members');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const m of all.result) store.put({ ...m, name: 'Ian Harvey Yap', appRole: 'designer', updatedAt: Date.now() });
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await page.goto('/#/me');
  await page.reload();
  await expect(chip(page)).toContainText('Designer');
  await chip(page).click();
  await page.getByRole('button', { name: 'Switch person' }).click();
  const picker = page.getByRole('dialog', { name: /Who.s using this device/ });
  await expect(picker.getByText('No one on this device is the owner')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/owner-restore.png` });
  await picker.getByLabel('Your name').fill('Joshua');
  await picker.getByRole('button', { name: 'Add me as the owner' }).click();
  await expect(chip(page)).toContainText('Joshua');
  await expect(chip(page)).toContainText('Owner');
  await page.goto('/#/team');
  await expect(page.getByRole('row', { name: /Ian Harvey Yap/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Joshua/ })).toBeVisible();
  expect(errors).toEqual([]);
});
