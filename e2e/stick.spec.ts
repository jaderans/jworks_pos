import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, offScreen, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

// Chrome's stand-in camera, for their photo at our booth.
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['camera'] });

test('Couple-of-Stickers: paid by GCash with a keychain add-on, checked on the customer screen, their photo at our booth, the stubs, made, shown off and handed over', async ({ page, context }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The print dialog is replaced: the test reads what would have printed.
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(document.querySelector('.stub-print')?.textContent ?? '');
    };
  });
  // The studio's Google script: Drive is empty until the illustrator saves the finished design.
  const png = fs.readFileSync('src/assets/brand/logo-256.png').toString('base64');
  let designs: { id: string; name: string; type: string; size: number; updated: number }[] = [];
  const saved: Record<string, any>[] = [];
  await context.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'drive.save') saved.push(body);
    const reply = body.ping
      ? { ok: true, remaining: 90, drive: true }
      : body.action === 'drive.list'
        ? { ok: true, files: designs }
        : body.action === 'drive.get'
          ? { ok: true, type: 'image/png', data: png }
          : body.action === 'drive.save'
            ? { ok: true, id: 'ph1', url: 'https://drive.google.com/file/d/ph1/view' }
            : { ok: true, remaining: 90 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await page.goto('/#/settings?section=email');
  await page.getByLabel('Mailer link').fill('https://script.google.com/macros/s/TEST/exec');
  await page.getByLabel('Mailer key').fill('test-key');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.getByText(/The mailer answered/)).toBeVisible();
  // Settings → Couple-of-Stickers: the packs by name, the stub numbers, and the Keychain and Pin add-ons.
  const st = page.locator('#s-stick');
  await expect(st.locator('.list-item', { hasText: 'Couple Pack (live)' })).toContainText('Couple Pack');
  await expect(st.getByRole('group', { name: 'Stub numbers' })).toContainText('the next stub is 01');
  await st.getByRole('button', { name: 'Add Keychain and Pin add-ons' }).click();
  // The starter catalog has Keychain conversion, turned off: it's turned on, and a Pin is added.
  await expect(st).toContainText('Keychain conversion, Pin (add-on)');
  await expect(st.getByRole('button', { name: 'Add Keychain and Pin add-ons' })).toHaveCount(0);
  // Samples for the order check, kept on this laptop: the file name says the pack.
  const shows = page.locator('#s-display').getByRole('group', { name: 'Sample stickers' });
  await shows.getByLabel('Sample sticker images').setInputFiles([
    { name: 'Couple - Eliza & Renz.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    { name: 'Solo - Wendy.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ]);
  await expect(shows.getByRole('status')).toHaveText('1 Solo · 1 Couple · 0 Barkada');
  await expect(shows.getByLabel('Pack for Couple - Eliza & Renz')).toHaveValue('couple');
  // Samples aren't ads.
  await expect(page.locator('#s-display').getByText('No ads yet.')).toBeVisible();
  await page.goto('/#/event/prices');
  await setEventPrice(page, 'Couple Pack (live)', 240);
  await setEventPrice(page, 'Keychain conversion', 60);
  await setEventPrice(page, 'Pin (add-on)', 50);

  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // A Couple Pack made into a keychain and a pin, paid by GCash: the details open by themselves, with the payment.
  await tapProduct(page, 'Couple Pack (live)', 1);
  await tapProduct(page, 'Keychain conversion', 1);
  await tapProduct(page, 'Pin (add-on)', 1);
  await page.locator('.reg-cart').getByRole('button', { name: /^Charge/ }).click();
  const charge = page.getByRole('dialog', { name: /^Charge/ });
  await charge.getByRole('button', { name: 'GCash' }).click();
  await charge.getByLabel('Reference number').fill('5012');
  await charge.getByRole('button', { name: /Complete sale/ }).click();
  const d = page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0001/ });
  await expect(d).toBeVisible();
  await expect(d.getByText(/Paid ₱350 by GCash \(ref 5012\)/)).toBeVisible();
  await expect(d.getByRole('region', { name: /Pack 1: Couple Pack \(live\)/ })).toContainText('+ Pin (add-on)');
  await expect(d.getByLabel('Design no.')).toHaveValue('CS01');
  const check = screen.getByRole('region', { name: 'Your Couple-of-Stickers order' });
  await expect(check).toContainText('Please check your order');
  await expect(check.locator('.cd-fact.good')).toContainText('₱350');
  await expect(check.locator('.cd-fact.good')).toContainText('GCash (ref 5012)');
  await expect(check).toContainText('+ Pin (add-on)');
  await expect(check).toContainText('2 illustrated stickers + 6 mini stickers');
  // A Couple Pack: the Couple sample only.
  const samples = check.getByLabel('Stickers we made');
  await expect(samples.locator('img')).toHaveCount(1);
  await expect(samples).toContainText('Couple stickers we made at past events');

  await d.getByLabel('Name or nickname').fill('Leanna');
  await d.getByLabel('Email', { exact: true }).fill('leanna@jw.test');
  await d.getByText('They want a soft copy').click();
  await d.getByRole('group', { name: 'How pack 1 is made' }).getByRole('button', { name: 'Illustrating' }).click();
  await d.getByRole('button', { name: 'Pick 6 mini stickers' }).click();
  const picker = d.getByRole('group', { name: 'Mini stickers for pack 1' });
  for (const m of ['01 Digital Pencil', '02 Laptop', '11 Newspaper', '28 Basketball', '33 Sleeping Cat', '43 Money Stack']) await picker.getByRole('button', { name: m }).click();
  await expect(picker).toContainText('6 of 6');
  await d.getByLabel('Note').fill('Holding hands, a cat between them');
  // Illustrating (30), the keychain and the pin (5 each): 40 to 50 minutes.
  await expect(d.getByText(/Ready in 40–50 minutes/)).toBeVisible();
  await expect(check).toContainText('Leanna');
  await expect(check.locator('.cd-order-minis img')).toHaveCount(6);
  await screen.screenshot({ path: `${SHOTS}/stick-check.png` });
  await screen.setViewportSize({ width: 1080, height: 1920 });
  await screen.waitForTimeout(400);
  expect(await offScreen(screen)).toEqual([]);
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // They want us to take their photo: the booth opens for this order, on both screens.
  await d.getByRole('group', { name: 'Their photo' }).getByRole('button', { name: 'Our photo booth' }).click();
  await page.screenshot({ path: `${SHOTS}/stick-dialog.png` });
  await d.getByRole('button', { name: 'Save and take their photo' }).click();
  await expect(page.getByText('Photo for Couple-of-Stickers 01 · Leanna')).toBeVisible();
  await expect(screen.getByRole('region', { name: 'Photo booth' })).toContainText('Strike a pose!');
  await page.getByLabel('Countdown').selectOption('0');
  await page.getByRole('button', { name: 'Take the photo' }).click();
  await expect(page.getByLabel('Their name')).toHaveValue('Leanna');
  await page.getByRole('button', { name: 'They said yes: keep it' }).click();
  await expect(page.getByText(/Their photo is on Couple-of-Stickers 01 as 01-Leanna/)).toBeVisible();
  await expect.poll(() => saved.length, { timeout: 15_000 }).toBe(1);
  expect(saved[0]).toMatchObject({ folder: 'photos', file: expect.objectContaining({ name: '01-Leanna.png' }) });
  await expect(screen.getByRole('region', { name: 'Photo booth' })).toContainText('Saved for your stickers!');
  // Back to the order: its details open again, and the customer screen shows their picks and their photo.
  await page.getByRole('button', { name: 'Back to the order' }).click();
  const again = page.getByRole('dialog', { name: 'Couple-of-Stickers 01' });
  await expect(again).toContainText('Their photo: 01-Leanna');
  await expect(again.getByRole('img', { name: /^Photo B[A-Z]-001/ })).toBeVisible();
  const back = screen.getByRole('region', { name: 'Your Couple-of-Stickers order' });
  await expect(back).toContainText('Your number');
  await expect(back.getByRole('img', { name: 'Your photo' })).toBeVisible();
  await expect(back.locator('.cd-order-minis img')).toHaveCount(6);
  await screen.screenshot({ path: `${SHOTS}/stick-check-photo.png` });
  await again.getByRole('button', { name: 'Close' }).last().click();
  await expect(back).toBeHidden();

  // On Orders: the details, the photo, the add-on; the design not in Drive yet, then in Drive.
  const card = page.getByRole('article', { name: /Order 01/ });
  await expect(card).toContainText('Claim stub 01');
  await expect(card).toContainText('C · Illustrating');
  await expect(card).toContainText('+ Pin (add-on)');
  await expect(card).toContainText('Their photo: 01-Leanna');
  await expect(card).toContainText('CS01-Leanna.png · not in Drive yet');
  await expect(card).toContainText('₱350 by GCash (ref 5012)');
  await expect(card.getByRole('button', { name: 'Show on customer screen' })).toBeDisabled();
  designs = [{ id: 'f1', name: 'CS01-Leanna.png', type: 'image/png', size: 9000, updated: 1 }];
  await page.getByRole('button', { name: 'Check Drive for designs' }).click();
  await expect(card).toContainText('CS01-Leanna.png · in Drive');
  await page.screenshot({ path: `${SHOTS}/stick-orders.png`, fullPage: true });

  // The stubs: seen first, printed only when asked.
  await card.getByRole('button', { name: 'Stubs for 01' }).click();
  const stubs = page.getByRole('dialog', { name: 'Stubs for 01' });
  await expect(stubs.getByRole('region', { name: 'Claim stub' })).toContainText('01');
  const info = stubs.getByRole('region', { name: 'Information stub' });
  await expect(info.getByRole('img', { name: 'Their photo' })).toBeVisible();
  await expect(info).toContainText('Reference: 01-Leanna');
  for (const t of ['Leanna', 'C · Illustrating', 'CS01-Leanna.png', 'Minis: 01, 02, 11, 28, 33, 43', '+ Keychain conversion', '+ Pin (add-on)', 'Paid: ₱350 · GCash (ref 5012) · A-0001', 'Soft copy: leanna@jw.test', 'our photo booth (01-Leanna)', 'Note: Holding hands']) await expect(info).toContainText(t);
  await stubs.locator('.stubs').screenshot({ path: `${SHOTS}/stick-stubs.png` });
  expect(await page.evaluate(() => (window as unknown as { __printed: string[] }).__printed.length)).toBe(0);
  await stubs.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed.length)).toBe(1);
  await stubs.getByRole('button', { name: 'Close' }).first().click();

  await card.getByRole('button', { name: 'Show on customer screen' }).click();
  const show = screen.getByRole('region', { name: 'Fresh from the booth' });
  await expect(show).toContainText('Order 01');
  await expect(show).toContainText('Leanna’s Couple-of-Stickers');

  // Made, called by the number on their stub, and handed over with nothing more to pay.
  await card.getByRole('button', { name: 'Start' }).click();
  await card.getByRole('button', { name: 'Ready' }).click();
  await expect(screen.getByRole('status').filter({ hasText: 'Now calling' })).toContainText('01');
  await card.getByRole('button', { name: 'Hand over' }).click();
  await page.getByRole('dialog', { name: /Hand over 01/ }).getByRole('button', { name: 'Hand over' }).click();
  await expect(page.getByText(/Picked up and cancelled \(1\)/)).toBeVisible();
  // Still just the one sale, and with the order handed over the next stub is 02.
  await page.goto('/#/sales');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.goto('/#/settings?section=stick');
  await expect(page.locator('#s-stick').getByRole('group', { name: 'Stub numbers' })).toContainText('the next stub is 02');

  // Voided in the Sales log: its Couple-of-Stickers order comes off Orders, and the stubs start at 01 again.
  await page.goto('/#/sales');
  await page.locator('tbody tr').first().click();
  const sale = page.getByRole('dialog', { name: /^Sale [A-Z]-0001/ });
  await sale.getByRole('button', { name: 'Void sale' }).click();
  await sale.getByLabel('Why is it voided?').fill('A test order');
  await sale.getByRole('button', { name: /^Void ₱/ }).click();
  await expect(page.getByText(/Couple-of-Stickers 01 is off Orders/)).toBeVisible();
  await page.goto('/#/orders');
  await expect(page.getByRole('article', { name: /Order 01/ })).toHaveCount(0);
  await page.goto('/#/settings?section=stick');
  await expect(page.locator('#s-stick').getByRole('group', { name: 'Stub numbers' })).toContainText('the next stub is 01');
  expect(errors).toEqual([]);
});

test('Couple-of-Stickers with three packs for different people: who’s on each, where they are in the photo, one pack’s own photo, all on one screen', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await page.goto('/#/event/prices');
  await setEventPrice(page, 'Solo Pack (live)', 150);
  await setEventPrice(page, 'Couple Pack (live)', 240);
  await setEventPrice(page, 'Barkada Pack (3)', 300);
  await openRegister(page);
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /^Customer screen/ }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });

  await tapProduct(page, 'Solo Pack (live)', 1);
  await tapProduct(page, 'Couple Pack (live)', 1);
  await tapProduct(page, 'Barkada Pack (3)', 1);
  await payCash(page);
  const d = page.getByRole('dialog', { name: /^Couple-of-Stickers for [A-Z]-0001/ });
  await d.getByLabel('Name or nickname').fill('Kaye');
  // Each pack: the names drawn on it, and where each one is in the photo.
  const person = (pack: number, k: number) => [d.getByLabel(`Pack ${pack}, person ${k}: name`), d.getByLabel(`Pack ${pack}, person ${k}: in the photo`)] as const;
  await expect(d.getByRole('group', { name: 'Who’s on pack 1' }).getByRole('textbox')).toHaveCount(2);
  await expect(d.getByRole('group', { name: 'Who’s on pack 3' }).getByRole('textbox')).toHaveCount(6);
  await person(1, 1)[0].fill('John');
  await person(1, 1)[1].fill('white shirt');
  for (const [k, name, who] of [[1, 'Kaye', 'left'], [2, 'Mark', 'right']] as const) {
    await person(2, k)[0].fill(name);
    await person(2, k)[1].fill(who);
  }
  for (const [k, name, who] of [[1, 'Thea', 'left, cap'], [2, 'Gretch', 'middle'], [3, 'Dana', 'right']] as const) {
    await person(3, k)[0].fill(name);
    await person(3, k)[1].fill(who);
  }
  await expect(d.getByText('Save the finished design in Drive → JoshWorks POS → Custom stickers as CS03-Thea-Gretch-Dana.png.')).toBeVisible();
  // Their mini stickers, pack by pack.
  const minis: [number, string[]][] = [
    [1, ['04 Gaming Headset', '05 Game Controller', '06 Ballpen']],
    [2, ['17 Rocket', '16 Chalkboard', '03 Headphones', '06 Ballpen', '08 Clipboard Checklist', '39 Safety Pin']],
    [3, ['01 Digital Pencil', '02 Laptop', '11 Newspaper', '28 Basketball', '33 Sleeping Cat', '43 Money Stack']],
  ];
  for (const [pack, picks] of minis) {
    await d.getByRole('region', { name: new RegExp(`^Pack ${pack}:`) }).getByRole('button', { name: /^Pick \d mini stickers$/ }).click();
    const picker = d.getByRole('group', { name: `Mini stickers for pack ${pack}` });
    for (const m of picks) await picker.getByRole('button', { name: m }).click();
    await d.getByRole('button', { name: 'Done picking' }).click();
  }

  // The customer screen: the three packs side by side, each with who's on it; everything fits.
  const check = screen.getByRole('region', { name: 'Your Couple-of-Stickers order' });
  await expect(check.getByRole('listitem', { name: /^Pack 1: Solo Pack/ })).toContainText('Johnwhite shirt');
  await expect(check.getByRole('listitem', { name: /^Pack 2: Couple Pack/ })).toContainText('Kayeleft');
  await expect(check.getByRole('listitem', { name: /^Pack 3: Barkada Pack/ })).toContainText('Gretchmiddle');
  await screen.waitForTimeout(600);
  expect(await offScreen(screen)).toEqual([]);
  await screen.screenshot({ path: `${SHOTS}/stick-check-three-packs.png` });
  await screen.setViewportSize({ width: 1080, height: 1920 });
  await screen.waitForTimeout(400);
  expect(await offScreen(screen)).toEqual([]);
  await screen.setViewportSize({ width: 1920, height: 1080 });

  // The barkada's own photo: the booth takes it for pack 3 only.
  await d.getByRole('group', { name: 'Their photo' }).getByRole('button', { name: 'Our photo booth' }).click();
  await expect(d.getByRole('button', { name: 'Save and take one photo of everyone' })).toBeVisible();
  await d.getByRole('button', { name: 'Save and take pack 3’s photo' }).click();
  await expect(page.getByText('Photo for Couple-of-Stickers 01 · pack 3: Thea, Gretch & Dana')).toBeVisible();
  await page.getByLabel('Countdown').selectOption('0');
  await page.getByRole('button', { name: 'Take the photo' }).click();
  await expect(page.getByLabel('Their name')).toHaveValue('Thea, Gretch & Dana');
  await page.getByRole('button', { name: 'They said yes: keep it' }).click();
  await expect(page.getByText(/Their photo is on Couple-of-Stickers 01 as CS03-Thea-Gretch-Dana/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to the order' }).click();
  const again = page.getByRole('dialog', { name: 'Couple-of-Stickers 01' });
  await expect(again).toContainText('Pack 3’s photo: CS03-Thea-Gretch-Dana');
  await expect(again.getByRole('button', { name: 'Save and take pack 1’s photo' })).toBeVisible();
  // On the customer screen, pack 3 shows their photo; the others a sample or nothing.
  const back = screen.getByRole('region', { name: 'Your Couple-of-Stickers order' });
  await expect(back.getByRole('listitem', { name: /^Pack 3/ })).toContainText('Your photo');
  await expect(back).toContainText('1 of 3 packs have their photo');
  await screen.waitForTimeout(600);
  expect(await offScreen(screen)).toEqual([]);
  await screen.screenshot({ path: `${SHOTS}/stick-check-pack-photo.png` });
  await again.getByRole('button', { name: 'Close' }).last().click();

  // On Orders and the information stub: each pack's people, and pack 3's photo.
  const card = page.getByRole('article', { name: /Order 01/ });
  await expect(card).toContainText('S · Printing · John');
  await expect(card).toContainText('C · Printing · Kaye & Mark');
  await expect(card).toContainText('Thea (left, cap), Gretch (middle), Dana (right)');
  await expect(card).toContainText('CS03-Thea-Gretch-Dana.png · not in Drive yet');
  await expect(card).toContainText('Their photo: CS03-Thea-Gretch-Dana');
  await card.getByRole('button', { name: 'Stubs for 01' }).click();
  const info = page.getByRole('dialog', { name: 'Stubs for 01' }).getByRole('region', { name: 'Information stub' });
  await expect(info).toContainText('1. Kaye (left)  2. Mark (right)');
  await expect(info).toContainText('CS01-John.png');
  await expect(info.getByRole('img', { name: 'Pack 3 photo' })).toBeVisible();
  await expect(info).toContainText('Reference: CS03-Thea-Gretch-Dana');
  expect(errors).toEqual([]);
});
