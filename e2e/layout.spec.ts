import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/** The menu must never scroll or clip, and no screen may scroll sideways, on any device size. */

const SIZES = [
  { name: 'phone-small', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'ipad-mini', width: 744, height: 1133 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
  { name: 'laptop-short', width: 1280, height: 640 },
  { name: 'laptop-toolbars', width: 1366, height: 600 },
  { name: 'tablet-short', width: 1024, height: 560 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'laptop-tall', width: 1536, height: 864 },
  { name: 'monitor', width: 1920, height: 1080 },
  { name: 'monitor-qhd', width: 2560, height: 1440 },
  { name: 'tv-4k', width: 3840, height: 2160 },
];

const PAGES = ['/', '/sell', '/sales', '/orders', '/print', '/booth', '/event', '/event/plan', '/event/coupons', '/event/wheel', '/events', '/events/compare', '/products', '/production', '/production?tab=plan', '/calculator', '/team', '/customers', '/settings', '/activity'];

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
    };
    const side = document.querySelector('.sidebar');
    if (side && visible(side)) {
      if (side.scrollHeight > side.clientHeight + 1) out.push(`menu scrolls vertically (${side.scrollHeight} > ${side.clientHeight})`);
      if (side.scrollWidth > side.clientWidth + 1) out.push(`menu scrolls sideways (${side.scrollWidth} > ${side.clientWidth})`);
      const nav = side.querySelector('.side-nav')!;
      const last = [...nav.querySelectorAll('.nav-item')].pop();
      if (last && last.getBoundingClientRect().bottom > nav.getBoundingClientRect().bottom + 1) out.push('last menu item is cut off');
      for (const l of side.querySelectorAll('.nav-label')) {
        if (visible(l) && l.scrollWidth > l.clientWidth + 1) out.push(`menu label clipped: ${l.textContent}`);
      }
    }
    const bottom = document.querySelector('.bottomnav');
    if (bottom && visible(bottom)) {
      for (const l of bottom.querySelectorAll('span')) if (l.scrollWidth > l.clientWidth + 1) out.push(`bottom bar label clipped: ${l.textContent}`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    const main = document.querySelector('main');
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`content wider than the screen (${main.scrollWidth} > ${main.clientWidth})`);
    const top = document.querySelector('.topbar');
    if (top && top.scrollWidth > top.clientWidth + 1) out.push(`top bar overflows (${top.scrollWidth} > ${top.clientWidth})`);
    return out;
  });
}

test('menu fits and nothing scrolls sideways on every device size', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);
  await setEventPrice(page, 'Enamel Pins', 30);
  await openRegister(page);
  for (let i = 0; i < 3; i++) {
    await tapProduct(page, 'Cat Meme (Solo)', 2);
    await tapProduct(page, 'Enamel Pins', 1);
    await payCash(page);
    await page.getByRole('button', { name: 'New sale' }).click();
  }

  const problems: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const path of PAGES) {
      await page.goto(`/#${path}`);
      await page.locator('main .page, main .register').first().waitFor();
      await page.waitForTimeout(120);
      for (const p of await layoutProblems(page)) problems.push(`${size.name} ${path}: ${p}`);
    }
    await page.goto('/#/');
    await page.locator('.dash-hero').waitFor();
    await page.screenshot({ path: `${SHOTS}/layout-${size.name}.png` });
  }

  // Collapsed menu on a laptop, and the account menu
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Collapse the menu' }).click();
  for (const p of await layoutProblems(page)) problems.push(`collapsed: ${p}`);
  await page.screenshot({ path: `${SHOTS}/layout-collapsed.png` });
  await page.getByRole('button', { name: 'Expand the menu' }).click();

  await page.getByRole('button', { name: 'Account and settings' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/layout-account-menu.png` });
  await page.getByRole('region', { name: 'Account and settings' }).getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/layout-dark.png` });
  await page.getByRole('button', { name: 'Recent activity' }).click();
  await expect(page.getByRole('region', { name: 'Recent activity' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/layout-activity-menu.png` });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Account and settings' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/layout-phone-account.png` });
  await page.getByRole('region', { name: 'Account and settings' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('before the register opens, the price list scrolls to its last product on every device size', async ({ page }) => {
  test.setTimeout(240_000);
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 25);
  const problems: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/#/');
    await page.goto('/#/sell');
    const rows = page.getByRole('region', { name: 'Prices' }).locator('.price-row');
    await rows.first().waitFor();
    for (const p of await layoutProblems(page)) problems.push(`${size.name}: ${p}`);
    if (['phone', 'laptop', 'monitor'].includes(size.name)) await page.screenshot({ path: `${SHOTS}/layout-open-register-${size.name}.png` });
    // Scroll with the mouse wheel over the list, as a person would (/sell's main doesn't scroll).
    await rows.first().hover();
    for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 500);
    await expect(rows.last(), `${size.name}: the last product is reachable`).toBeInViewport();
    // On phones the search and categories stay on screen while the list scrolls.
    await expect(page.getByRole('searchbox', { name: 'Find a product' }), `${size.name}: the search stays on screen`).toBeInViewport();
  }
  expect(problems).toEqual([]);
});

test('the menu fits at every window height, wide and narrow', async ({ page }) => {
  test.setTimeout(180_000);
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await page.goto('/#/');
  const problems: string[] = [];
  // Every 20px, plus 1px above each height step in app.css (the tightest point of each band).
  const heights = [...new Set([...Array.from({ length: 25 }, (_, i) => 520 + i * 20), 561, 621, 701, 761, 781, 801])].sort((a, b) => a - b);
  const sweep = async (label: string, width: number) => {
    for (const height of heights) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(40);
      for (const p of await layoutProblems(page)) problems.push(`${label} ${width}×${height}: ${p}`);
    }
  };
  await sweep('full', 1366);
  await sweep('rail', 1100);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Collapse the menu' }).click();
  await sweep('collapsed', 1366);
  expect(problems).toEqual([]);
});
