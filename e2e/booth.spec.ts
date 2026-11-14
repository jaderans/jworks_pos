import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, setupOwner } from './helpers';

// Chrome's stand-in camera: a moving test pattern, allowed without asking.
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['camera'] });

test('photo booth: a photo in the frame on both screens, kept with a yes, emailed, and made into an illustration order', async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The studio's Google script: emails, and Drive for the order's photo.
  const sent: Record<string, any>[] = [];
  await context.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (!body.ping) sent.push(body);
    const reply = body.ping
      ? { ok: true, remaining: 90, drive: true }
      : body.action === 'drive.save'
        ? { ok: true, id: 'p1', url: 'https://drive.google.com/file/d/p1/view' }
        : { ok: true, remaining: 90 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
  });

  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Hilway November 2026');
  await page.goto('/#/settings?section=email');
  await page.getByLabel('Mailer link').fill('https://script.google.com/macros/s/TEST/exec');
  await page.getByLabel('Mailer key').fill('test-key');
  await page.getByLabel('Replies go to').fill('owner@jw.test');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.getByText(/The mailer answered/)).toBeVisible();

  // Services → Photo booth, with the customer screen open beside it.
  await page.goto('/#/print');
  await page.getByRole('button', { name: 'Photo booth' }).click();
  await expect(page.getByRole('heading', { name: 'Photo booth', level: 1 })).toBeVisible();
  const [screen] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Customer screen' }).click()]);
  screen.on('pageerror', (e) => errors.push(e.message));
  await screen.setViewportSize({ width: 1920, height: 1080 });
  const booth = screen.getByRole('region', { name: 'Photo booth' });
  await expect(booth).toContainText('Strike a pose!');
  await expect(booth.getByRole('img', { name: 'You, in the JoshWorks frame' })).toBeVisible();

  // The countdown on both screens, then the photo as a sticker with the question.
  const shoot = page.getByRole('button', { name: 'Take the photo' });
  await expect(shoot).toBeEnabled({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/booth-live.png` });
  await shoot.click();
  await expect(booth).toContainText('Smile!');
  await expect(page.getByRole('heading', { name: 'May we keep this photo?' })).toBeVisible({ timeout: 10_000 });
  await expect(booth).toContainText('May we keep this photo?');
  await expect(booth.getByRole('img', { name: 'Your photo' })).toBeVisible();
  await screen.screenshot({ path: `${SHOTS}/booth-screen-preview.png` });

  // They said no: nothing is kept.
  await page.getByRole('button', { name: 'They said no: delete it' }).click();
  await expect(shoot).toBeVisible();
  await expect(page.getByText('No photos kept yet')).toBeVisible();

  // Again, and this time yes.
  await page.getByRole('group', { name: 'Frame' }).getByRole('button', { name: 'Instant photo' }).click();
  await page.getByLabel('Countdown').selectOption('0');
  await page.getByRole('button', { name: 'Take the photo' }).click();
  await page.getByLabel('Their name').fill('Leanna Rosales');
  await page.getByLabel('Mobile or email').fill('leanna@jw.test');
  await page.getByRole('button', { name: 'They said yes: keep it' }).click();
  await expect(page.getByRole('heading', { name: 'Photo BA-001' })).toBeVisible();
  await expect(booth).toContainText('Photo BA-001');
  await expect(booth).toContainText('Make it yours!');
  await expect(page.getByRole('region', { name: 'Kept photos' }).getByRole('button', { name: 'Photo BA-001, Leanna Rosales' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/booth-kept.png` });
  await screen.screenshot({ path: `${SHOTS}/booth-screen-kept.png` });

  // Email it to them, with the photo attached.
  await expect(page.getByLabel('Email the photo to')).toHaveValue('leanna@jw.test');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await expect.poll(() => sent.filter((b) => b.to === 'leanna@jw.test').length, { timeout: 15_000 }).toBe(1);
  const mail = sent.find((b) => b.to === 'leanna@jw.test')!;
  expect(mail.subject).toBe('Your photo from the JoshWorks booth');
  expect(mail.text).toContain('Photo number: BA-001');
  expect(mail.attachments[0]).toMatchObject({ name: 'BA-001 Leanna - JoshWorks photo.jpg', type: 'image/jpeg' });

  // An illustration drawn from it: a service order, filled in from the photo.
  await page.getByRole('button', { name: 'Illustration request' }).click();
  const d = page.getByRole('dialog', { name: 'New service order' });
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Leanna Rosales');
  await expect(d.locator('.po-photo')).toContainText('From booth photo BA-001.');
  await expect(d.getByLabel('Notes')).toHaveValue('Draw it from booth photo BA-001.');
  await expect(d.getByLabel('Tier')).toBeVisible();
  await d.getByLabel('Designs').fill('1');
  await d.getByRole('button', { name: 'Add to the order' }).click();
  await d.getByRole('button', { name: 'Save service order' }).click();
  const card = page.getByRole('article', { name: /Service order P[A-Z]-001/ });
  await expect(card.getByText('Booth photo BA-001')).toBeVisible();

  // It goes to Drive → Booth photos, and its link onto the order.
  await expect.poll(() => sent.filter((b) => b.action === 'drive.save').length, { timeout: 15_000 }).toBe(1);
  const save = sent.find((b) => b.action === 'drive.save')!;
  expect(save.folder).toBe('photos');
  expect(save.file.name).toBe('BA-001 Leanna - JoshWorks photo.jpg');
  await card.getByRole('button', { name: /Edit P[A-Z]-001/ }).click();
  await expect(page.getByRole('dialog', { name: /Edit P[A-Z]-001/ }).getByLabel('Files')).toHaveValue('https://drive.google.com/file/d/p1/view');
  await page.keyboard.press('Escape');

  // Back at the booth: it stays with the order.
  await page.goto('/#/booth');
  await page.getByRole('button', { name: 'Photo BA-001, Leanna Rosales' }).click();
  await expect(page.getByText(/Used for service order P[A-Z]-001/)).toBeVisible();
  await expect(page.getByText(/It’s in Google Drive/)).toBeVisible();
  expect(errors).toEqual([]);
});
