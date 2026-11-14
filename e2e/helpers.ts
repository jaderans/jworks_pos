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

/** Anything on the customer screen that pokes outside the window (for portrait and odd-sized monitors). */
export async function offScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const el of document.querySelectorAll('.cd *')) {
      if (el.closest('.cd-confetti, .sl-dots, .cd-fullbtn')) continue;
      // Shapes inside a turning SVG have rotated boxes; the SVG itself is what has to fit.
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className || '').split(' ')[0]} at ${Math.round(r.left)},${Math.round(r.top)} size ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out.slice(0, 8);
  });
}

/**
 * Selling a Couple-of-Stickers pack opens its details right after payment.
 * In tests about something else, close them with "Later" whenever they appear.
 */
export async function skipStickDetails(page: Page): Promise<void> {
  const d = page.getByRole('dialog', { name: /^Couple-of-Stickers for/ });
  await page.addLocatorHandler(d, async () => {
    await d.getByRole('button', { name: 'Later' }).click();
  });
}
