import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, setEventPrice, setupOwner } from './helpers';

test('arrange products by dragging or with the arrows; the register follows', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  for (const [p, v] of [['Enamel Pins', 30], ['58mm Pins', 25], ['AI IS NOT ART', 40]] as const) await setEventPrice(page, p, v);

  // Arrange only the pins
  await page.goto('/#/products');
  await page.getByLabel('Category').selectOption({ label: 'Pins' });
  await page.getByRole('button', { name: 'Arrange' }).click();
  const rows = page.locator('.arrange-row');
  await expect(rows.first()).toContainText('Enamel Pins');

  // Drag the last pin to the top
  const handle = page.getByRole('button', { name: 'Drag AI IS NOT ART', exact: true });
  const from = (await handle.boundingBox())!;
  const top = (await rows.first().boundingBox())!;
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  for (let y = from.y + from.height / 2; y > top.y + 6; y -= 10) await page.mouse.move(x, y);
  await page.mouse.up();
  await expect(rows.first()).toContainText('AI IS NOT ART');

  // And one with the arrows
  await page.getByRole('button', { name: 'Move 58mm Pins up', exact: true }).click();
  await expect(rows.nth(1)).toContainText('58mm Pins');
  await expect(rows.nth(2)).toContainText('Enamel Pins');
  await page.screenshot({ path: `${SHOTS}/arrange.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save order' }).click();
  await expect(page.getByText('Order saved. The register shows it too.')).toBeVisible();

  // Products and the register both follow the new order, after a reload too
  const pinOrder = async () => {
    const names = await page.locator('tbody tr td:first-child b').allInnerTexts();
    return names.filter((n) => ['AI IS NOT ART', '58mm Pins', 'Enamel Pins'].includes(n));
  };
  await expect.poll(pinOrder).toEqual(['AI IS NOT ART', '58mm Pins', 'Enamel Pins']);
  await page.reload();
  await page.getByLabel('Category').selectOption({ label: 'Pins' });
  await expect.poll(pinOrder).toEqual(['AI IS NOT ART', '58mm Pins', 'Enamel Pins']);

  await openRegister(page);
  const tiles = async () => (await page.locator('.reg-grid .tile').allInnerTexts()).map((t) => t.split('\n')[0].trim()).filter((t) => ['AI IS NOT ART', '58mm Pins', 'Enamel Pins'].includes(t));
  await expect.poll(tiles).toEqual(['AI IS NOT ART', '58mm Pins', 'Enamel Pins']);
  expect(errors).toEqual([]);
});
