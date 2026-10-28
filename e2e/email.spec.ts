import { expect, test } from '@playwright/test';
import { SHOTS, createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/** Emailed receipts and the automatic end-of-day summary, against a stand-in for the studio Gmail mailer. */
test('receipts email out (also after being offline) and closing the register sends the day summary', async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent: Record<string, any>[] = [];
  await context.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (!body.ping) sent.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, remaining: 97 }) });
  });

  await setupOwner(page, 'Joshua Ranin', '1111');
  await createEvent(page, 'Komiket Iloilo');
  await setEventPrice(page, 'Cat Meme (Solo)', 20);

  // Connect the mailer
  await page.goto('/#/settings?section=email');
  await page.getByLabel('Mailer link').fill('https://script.google.com/macros/s/TEST/exec');
  await page.getByLabel('Mailer key').fill('test-key');
  await page.getByLabel('Replies go to').fill('owner@jw.test');
  await page.getByLabel('Send it to').fill('owner@jw.test');
  await page.getByRole('button', { name: 'Check the connection' }).click();
  await expect(page.getByText(/The mailer answered\. Gmail can send 97 more emails today/)).toBeVisible();

  // A receipt, emailed right away
  await openRegister(page);
  await tapProduct(page, 'Cat Meme (Solo)', 3);
  await payCash(page);
  const receipt = page.getByRole('dialog', { name: /^Sale A-0001/ });
  await expect(receipt.getByRole('img', { name: 'JoshWorks' })).toBeVisible();
  await receipt.getByLabel('Email the receipt').fill('fan@jw.test');
  await receipt.getByRole('button', { name: 'Send' }).click();
  await expect(receipt.getByText('Emailed to fan@jw.test')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/email-receipt-dialog.png` });
  const first = sent.find((b) => b.to === 'fan@jw.test')!;
  expect(first.subject).toBe('Your receipt A-0001 · JoshWorks');
  expect(first.key).toBe('test-key');
  expect(first.html).toContain('brand/email-logo.png');
  expect(first.html).toContain('3 × Cat Meme (Solo)');
  await page.getByRole('button', { name: 'New sale' }).click();

  // Offline: it waits, then goes out by itself when the connection is back
  await context.setOffline(true);
  await tapProduct(page, 'Cat Meme (Solo)', 2);
  await payCash(page);
  const offline = page.getByRole('dialog', { name: /^Sale A-0002/ });
  await offline.getByLabel('Email the receipt').fill('fan2@jw.test');
  await offline.getByRole('button', { name: 'Send' }).click();
  await expect(offline.getByText(/Waiting to send to fan2@jw\.test/)).toBeVisible();
  await context.setOffline(false);
  await expect(offline.getByText('Emailed to fan2@jw.test')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New sale' }).click();

  // Closing the register sends the end-of-day summary with the PDF
  await page.getByRole('button', { name: 'Close register' }).click();
  const close = page.getByRole('dialog', { name: /Close register A/ });
  await close.getByLabel('Number of ₱1,000', { exact: true }).fill('2');
  await close.getByLabel('Number of ₱100', { exact: true }).fill('1');
  await expect(close.getByText('Balanced', { exact: true })).toBeVisible();
  await close.getByRole('button', { name: 'Close register' }).click();
  await page.getByRole('dialog', { name: 'Close the register?' }).getByRole('button', { name: 'Close register' }).click();
  await expect(page.getByText('The end-of-day summary is on its way to your email.')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sent.filter((b) => String(b.subject).startsWith('End of day')).length, { timeout: 20_000 }).toBe(1);
  const summary = sent.find((b) => String(b.subject).startsWith('End of day'))!;
  expect(summary.to).toBe('owner@jw.test');
  expect(summary.subject).toContain('Komiket Iloilo');
  expect(summary.text).toContain('Sales today: ₱100');
  expect(summary.text).toContain('INVENTORY');
  expect(summary.text).toContain('Cat Meme (Solo): sold 5 today');
  expect(summary.attachments).toHaveLength(1);
  expect(summary.attachments[0].name).toMatch(/end of day 20\d\d-\d\d-\d\d\.pdf$/);
  expect(summary.attachments[0].type).toBe('application/pdf');
  expect(summary.attachments[0].data.length).toBeGreaterThan(5000);

  // The sales log and Settings show what went out
  await page.goto('/#/sales');
  await expect(page.getByText('emailed').first()).toBeVisible();
  await page.goto('/#/settings?section=email');
  await expect(page.getByText('End of day · owner@jw.test')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/email-settings.png`, fullPage: true });
  expect(errors).toEqual([]);
});
