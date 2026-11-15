import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, offScreen, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

async function sellAndOpenReceipt(page: Page) {
  await tapProduct(page, 'Couple Pack (live)', 2);
  await payCash(page);
  // The packs' Couple-of-Stickers details open after paying: not what this test is about.
  await page.getByRole('dialog', { name: /^Couple-of-Stickers for/ }).getByRole('button', { name: 'Later' }).click();
  return page.getByRole('dialog', { name: /^Sale [A-Z]-\d{4}/ });
}

test('the prize wheel: set it up, spin on a qualifying sale, see it land on the customer screen, then the daily limit', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await setEventPrice(page, 'Couple Pack (live)', 240);

  // Event → Wheel: on, from ₱250, one prize at 100% with a limit of one a day.
  await page.goto('/#/event/wheel');
  await expect(page.getByText('Get a DTI permit first')).toBeVisible();
  await page.locator('label[for="wh-on"]').click();
  await expect(page.getByLabel('On at this event')).toBeChecked();
  await page.getByRole('button', { name: 'Add a prize' }).click();
  const prize = page.locator('.wheel-prize').first();
  await prize.getByLabel('Prize', { exact: true }).fill('Free Couple Pack');
  await prize.getByLabel('Product').selectOption({ label: 'Couple Pack (live) (no stock count)' });
  await expect(prize.getByText(/has no stock count, so only this event’s sold count goes up/)).toBeVisible();
  await prize.getByLabel('Chance').fill('100');
  await prize.getByLabel('Most a day').fill('1');
  await expect(page.getByText(/Try again:\s*0%/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wheel-setup.png`, fullPage: true });
  // Same-size slices: easier to read, the chances unchanged.
  await page.getByRole('group', { name: 'Slices' }).getByRole('button', { name: 'All the same size' }).click();
  await expect(page.getByText(/The chances you set still decide where it stops/)).toBeVisible();
  await page.getByRole('button', { name: 'Save the wheel' }).click();
  // Kept for other events.
  const saved = page.getByRole('group', { name: 'Saved wheels' });
  await saved.getByLabel('Save it as').fill('Hilway wheel');
  await saved.getByRole('button', { name: 'Save for other events' }).click();
  await expect(saved.locator('.list-item', { hasText: 'Hilway wheel' })).toContainText('same-size slices');
  await expect(saved.getByRole('button', { name: 'Use here' })).toBeVisible();
  await expect(page.getByText('Prize wheel saved. Qualifying sales can spin now.')).toBeVisible();

  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // ₱480 qualifies. The customer screen is open, so the cashier lets the customer spin:
  // the wheel waits on their screen, turning slowly, until they tap it.
  // It turns even when Windows has animations off (the browser then asks for reduced motion).
  await screen.emulateMedia({ reducedMotion: 'reduce' });
  let receipt = await sellAndOpenReceipt(page);
  await receipt.getByRole('button', { name: 'Let them spin' }).click();
  await expect(receipt.getByText('Waiting for them to tap the wheel')).toBeVisible();
  const wheel = screen.getByRole('region', { name: 'Prize wheel' });
  await expect(wheel.getByRole('status')).toContainText('Tap the wheel to spin!');
  const turning = wheel.locator('svg > g').first();
  const idle = await turning.getAttribute('transform');
  await screen.waitForTimeout(400);
  expect(await turning.getAttribute('transform')).not.toBe(idle);
  await screen.screenshot({ path: `${SHOTS}/wheel-tap-to-spin.png` });
  await wheel.getByRole('button', { name: 'Spin the wheel' }).click();
  await expect(receipt.getByText('The wheel is spinning…')).toBeVisible();
  const first = await turning.getAttribute('transform');
  await screen.waitForTimeout(500);
  expect(await turning.getAttribute('transform')).not.toBe(first);
  await expect(wheel.getByRole('status')).toContainText('You won', { timeout: 12_000 });
  await expect(wheel.getByRole('status')).toContainText('Free Couple Pack');
  await screen.screenshot({ path: `${SHOTS}/wheel-customer-screen.png` });
  // On a portrait monitor the wheel sits above what it landed on, all of it on screen.
  await screen.setViewportSize({ width: 1080, height: 1920 });
  await screen.waitForTimeout(400);
  expect(await offScreen(screen)).toEqual([]);
  await screen.screenshot({ path: `${SHOTS}/wheel-portrait.png` });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await expect(receipt.getByText('They won: Free Couple Pack')).toBeVisible({ timeout: 5_000 });
  // A Couple-of-Stickers pack won is made like a bought one: its details open (the test closes them with Later).
  await expect(page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0002/ })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0002/ })).toContainText('Wheel prize (free)');
  await page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0002/ }).getByRole('button', { name: 'Later' }).click();
  await expect(receipt.getByRole('button', { name: 'Let them spin' })).toHaveCount(0);
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // The one free pack today is gone: the cashier spins this one for them, and it lands on "Try again".
  receipt = await sellAndOpenReceipt(page);
  await receipt.getByRole('button', { name: 'Spin for them' }).click();
  await expect(receipt.getByText('Try again: no prize this time')).toBeVisible({ timeout: 12_000 });
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // The prize went out as a ₱0 sale: the Sales log says so, and which sale won it.
  await page.goto('/#/sales');
  const prizeRow = page.getByRole('row', { name: /Wheel prize for [A-Z]-0001/ });
  await expect(prizeRow).toContainText('Couple Pack (live)');
  await expect(prizeRow).toContainText('₱0');
  await expect(page.getByRole('row', { name: /[A-Z]-0001/ }).filter({ hasText: 'Wheel: won Free Couple Pack' })).toBeVisible();
  await page.getByLabel('Status').selectOption('prizes');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/wheel-sales-log.png`, fullPage: true });
  expect(errors).toEqual([]);
});
