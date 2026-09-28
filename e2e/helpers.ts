import { expect, type Page } from '@playwright/test';

export const SHOTS = 'test-results/shots';

/** First-run setup on a fresh device, importing the old sheets' names. */
export async function setupOwner(page: Page, name = 'Test Owner', pin = '1234') {
  await page.goto('/');
  await page.getByRole('button', { name: /Set up JoshWorks POS/ }).click();
  await page.getByLabel('Your name (owner)').fill(name);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('PIN (4 to 8 digits)').fill(pin);
  await page.getByLabel('Type it again').fill(pin);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('dialog', { name: 'New event' })).toBeVisible();
}

export async function createEvent(page: Page, name: string) {
  await page.getByLabel('Event name').fill(name);
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

export async function setEventPrice(page: Page, product: string, pesos: number) {
  const input = page.getByLabel(`Event price of ${product}`);
  await input.fill(String(pesos));
  await input.press('Enter');
  await input.blur();
}

export async function openRegister(page: Page) {
  await page.goto('/#/sell');
  await page.getByRole('button', { name: 'Open register' }).click();
  await expect(page.getByText(/Register [A-Z]/).first()).toBeVisible();
}

export async function tapProduct(page: Page, product: string, times = 1) {
  const tile = page.locator('.tile', { hasText: product }).first();
  for (let i = 0; i < times; i++) await tile.click();
}

export async function payCash(page: Page) {
  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Charge/ });
  await dialog.getByRole('button', { name: /^Exact/ }).click();
  await dialog.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByRole('dialog', { name: /^Sale [A-Z]-\d{4}/ })).toBeVisible();
}
