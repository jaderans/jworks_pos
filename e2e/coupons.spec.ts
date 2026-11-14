import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

test('service coupons: made for an event, used on a print order, earned at the booth, reminded before they run out', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);

  // Three single-use codes to hand out, ₱300 off services of ₱2,500 or more.
  await page.goto('/#/event/coupons');
  await page.getByRole('button', { name: 'New coupons' }).click();
  let d = page.getByRole('dialog', { name: 'New service coupons' });
  await expect(d.getByLabel('Codes start with')).toHaveValue(/^KI\d\d$/);
  await d.getByLabel('Codes to make now').fill('3');
  await expect(d).toContainText('₱300 off any JoshWorks service of ₱2,500 or more');
  // Not under the ₱2,500 minimum.
  await d.getByLabel('For services of at least').fill('1000');
  await d.getByRole('button', { name: 'Make 3 codes' }).click();
  await expect(d.getByText('Coupons are for services of ₱2,500 or more.')).toBeVisible();
  await d.getByLabel('For services of at least').fill('2500');
  await d.getByRole('button', { name: 'Make 3 codes' }).click();
  await expect(page.getByRole('article', { name: 'Coupons Booth handout' })).toContainText('3 single-use codes');

  // A set booth sales earn: a sale of ₱100 or more.
  await page.getByRole('button', { name: 'New coupons' }).click();
  d = page.getByRole('dialog', { name: 'New service coupons' });
  await d.getByLabel('Name').fill('Spend ₱100 at the booth');
  await d.getByLabel('Codes to make now').fill('0');
  await d.getByText('Booth sales earn one').click();
  await d.getByLabel('A sale of at least').fill('100');
  await d.getByRole('button', { name: 'Make the coupons' }).click();
  await expect(page.getByRole('article', { name: 'Coupons Spend ₱100 at the booth' })).toContainText('Earned with a sale of ₱100+');

  const codes = page.getByRole('region', { name: 'Codes' });
  const code = (await codes.locator('tbody tr').first().locator('b.mono').textContent())!.trim();
  expect(code).toMatch(/^KI\d\d-[A-HJ-NP-Z2-9]{5}$/);

  // A ₱2,700 print order takes it: ₱300 off the print work.
  await page.goto('/#/print');
  await page.getByRole('button', { name: 'New service order' }).click();
  const po = page.getByRole('dialog', { name: 'New service order' });
  await po.getByLabel('Name', { exact: true }).fill('Mira Bakeshop');
  await po.getByLabel('Material').selectOption('prem-matte-glossy');
  await po.getByLabel('Cut').selectOption('die');
  await po.getByLabel('A4 sheets').fill('30');
  await po.getByRole('button', { name: 'Add to the order' }).click();
  await po.getByLabel('Service coupon').fill(code.toLowerCase());
  await po.getByRole('button', { name: 'Apply' }).click();
  await expect(po.locator('.coupon-on')).toContainText(`${code} ₱300 off`);
  await expect(po.locator('.wf-row', { hasText: 'Coupon' })).toContainText('−₱300');
  await expect(po.locator('.wf-row.total')).toContainText('₱2,400');
  await po.getByRole('button', { name: 'Save service order' }).click();
  await expect(page.getByRole('article', { name: /Service order P[A-Z]-001/ })).toContainText(`Coupon ${code}`);

  // The same code won't go on a second service.
  await page.getByRole('button', { name: 'New service order' }).click();
  await po.getByLabel('Name', { exact: true }).fill('Kaye');
  await po.getByLabel('A4 sheets').fill('40');
  await po.getByRole('button', { name: 'Add to the order' }).click();
  await po.getByLabel('Service coupon').fill(code);
  await po.getByRole('button', { name: 'Apply' }).click();
  await expect(po.locator('.coupon-on.bad')).toContainText('was already used by Mira Bakeshop');
  await po.getByRole('button', { name: 'Cancel' }).click();

  // A ₱100 booth sale earns a code; it's on the receipt.
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 5);
  await payCash(page);
  const receipt = page.getByRole('dialog', { name: /^Sale A-0001/ });
  await expect(receipt.locator('.coupon-earned')).toContainText('Service coupon earned');
  await expect(receipt.locator('.coupon-earned')).toContainText(/KI\d\d-[A-HJ-NP-Z2-9]{5}/);
  await page.screenshot({ path: `${SHOTS}/coupon-receipt.png` });
  await receipt.getByRole('button', { name: 'New sale' }).click();

  // The tab: totals, who used what and for how much.
  await page.goto('/#/event/coupons');
  await expect(page.locator('.stat', { hasText: 'Coupon codes' })).toContainText('4');
  await expect(page.locator('.stat', { hasText: 'Used' })).toContainText('1');
  await expect(page.locator('.stat', { hasText: 'Services booked with them' })).toContainText('₱2,700');
  const used = page.getByRole('region', { name: 'Who used them' });
  await expect(used.getByRole('row', { name: /Mira Bakeshop/ })).toContainText('₱300');
  await expect(codes).toContainText('Earned at the booth');

  // Give a code to a customer and bring the expiry close: it shows up to remind.
  const open = codes.locator('tbody tr', { hasText: 'Not used' }).filter({ hasText: 'Booth handout' }).first();
  const given = (await open.locator('b.mono').textContent())!.trim();
  await open.getByRole('button', { name: `Give ${given} to a customer` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kaye Dela Cruz');
  await page.getByLabel('Mobile number').fill('0917 123 4567');
  await page.getByRole('button', { name: 'Add and use' }).click();
  await expect(codes.locator('tbody tr', { hasText: given })).toContainText('Kaye Dela Cruz');
  await page.getByRole('article', { name: 'Coupons Booth handout' }).getByRole('button', { name: 'Edit' }).click();
  const soon = new Date(Date.now() + 7 * 86400000);
  const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Expires after').fill(iso);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const remind = page.getByRole('region', { name: 'Expiring soon' });
  await expect(remind).toContainText('Kaye Dela Cruz');
  await expect(remind).toContainText(/ends in 7 days/);
  await page.screenshot({ path: `${SHOTS}/coupons-tab.png`, fullPage: true });

  // The report counts them, and Customers → Coupons shows every event's.
  await page.goto('/#/event/report');
  await expect(page.getByRole('region', { name: 'Service coupons' })).toContainText('1 of 4');
  await page.goto('/#/customers');
  await page.getByRole('button', { name: 'Coupons', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Coupons Spend ₱100 at the booth' })).toContainText('Komiket Iloilo');
  expect(errors).toEqual([]);
});
