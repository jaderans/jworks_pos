import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

async function sellAndOpenReceipt(page: Page) {
  await tapProduct(page, 'Couple Pack (live)', 2);
  await payCash(page);
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
  await prize.getByLabel('Product').selectOption({ label: 'Couple Pack (live)' });
  await prize.getByLabel('Chance').fill('100');
  await prize.getByLabel('Most a day').fill('1');
  await expect(page.getByText(/Try again:\s*0%/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/wheel-setup.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save the wheel' }).click();
  await expect(page.getByText('Prize wheel saved. Qualifying sales can spin now.')).toBeVisible();

  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // ₱480 qualifies: the cashier spins, the customer screen shows the wheel landing on the prize.
  // It turns even when Windows has animations off (the browser then asks for reduced motion).
  await screen.emulateMedia({ reducedMotion: 'reduce' });
  let receipt = await sellAndOpenReceipt(page);
  await receipt.getByRole('button', { name: 'Spin the wheel' }).click();
  const turning = screen.getByRole('region', { name: 'Prize wheel' }).locator('svg > g').first();
  await expect(turning).toBeVisible();
  const first = await turning.getAttribute('transform');
  await screen.waitForTimeout(500);
  expect(await turning.getAttribute('transform')).not.toBe(first);
  await expect(receipt.getByText('They won: Free Couple Pack')).toBeVisible();
  const wheel = screen.getByRole('region', { name: 'Prize wheel' });
  await expect(wheel).toBeVisible();
  await expect(wheel.getByRole('status')).toContainText('You won', { timeout: 10_000 });
  await expect(wheel.getByRole('status')).toContainText('Free Couple Pack');
  await screen.screenshot({ path: `${SHOTS}/wheel-customer-screen.png` });
  await expect(receipt.getByRole('button', { name: 'Spin the wheel' })).toHaveCount(0);
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // The one free pack today is gone: the next qualifying sale lands on "Try again".
  receipt = await sellAndOpenReceipt(page);
  await receipt.getByRole('button', { name: 'Spin the wheel' }).click();
  await expect(receipt.getByText('Try again: no prize this time')).toBeVisible();
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // The prize went out as a ₱0 sale, so the stock and the report know.
  await page.goto('/#/sales');
  await expect(page.getByRole('row', { name: /Couple Pack \(live\)/ }).filter({ hasText: '₱0' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
