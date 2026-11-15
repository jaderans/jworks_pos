import { expect, test, type Page } from '@playwright/test';
import { createEvent, openRegister, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/**
 * The live link to JoshWorks Studio, against the Firebase emulators (`npm run emulators`):
 * the owner's POS says where its data is (owners/{uid}) and keeps Studio's feed in the
 * cloud by itself — a Couple-of-Stickers order as soon as it's saved, the running event
 * a little after each sale.
 */

const PROJECT = 'demo-jwpos';
const FIREBASE = { apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: 'demo-app', emulator: { host: '127.0.0.1', authPort: 9099, firestorePort: 8080 } };
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
/** The emulator lets this header past the security rules, to look at what the app wrote. */
const ADMIN = { Authorization: 'Bearer owner' };

type Value = { stringValue?: string; integerValue?: string; mapValue?: { fields: Record<string, Value> }; arrayValue?: { values?: Value[] } };
type Doc = { name: string; fields: Record<string, Value> };

async function emulatorsUp() {
  try {
    return (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/config`)).ok;
  } catch {
    return false;
  }
}

async function list(path: string): Promise<Doc[]> {
  const r = await fetch(`${DOCS}/${path}`, { headers: ADMIN });
  return r.ok ? (((await r.json()) as { documents?: Doc[] }).documents ?? []) : [];
}

async function verifyEmail(email: string) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`);
    const { oobCodes } = (await res.json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] };
    const code = oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').pop();
    if (code) {
      await fetch(code.oobLink);
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No verification email for ${email}`);
}

async function connectOwner(page: Page, email: string) {
  await page.goto('/#/settings?section=sync');
  await page.getByLabel('Paste the firebaseConfig').fill(JSON.stringify(FIREBASE));
  await page.getByRole('button', { name: 'Connect this device' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await verifyEmail(email);
  await page.getByRole('button', { name: /I.ve verified/ }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });
}

const str = (d: Doc, ...path: string[]) => {
  let v: Value | undefined = { mapValue: { fields: d.fields } };
  for (const k of path) v = v?.mapValue?.fields[k];
  return v?.stringValue ?? '';
};

test('the POS keeps Studio’s live feed in the cloud: where its data is, a Couple-of-Stickers order once saved, the running event', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await emulatorsUp()), 'Firebase emulators are not running');
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await setupOwner(page, 'Test Owner', '1357');
  await createEvent(page, 'Live Fair');
  await setEventPrice(page, 'Couple Pack (live)', 240);
  await connectOwner(page, 'owner@jw.test');

  // Where this owner's POS data is, for Studio signed in with the same login.
  await expect.poll(async () => (await list('owners')).length, { timeout: 20_000 }).toBe(1);
  const [owner] = await list('owners');
  const ws = str(owner, 'pos', 'ws');
  expect(ws).not.toBe('');
  expect(str(owner, 'pos', 'email')).toBe('owner@jw.test');

  // A Couple-of-Stickers order: in the cloud feed as soon as it's saved, the work only.
  await openRegister(page);
  await tapProduct(page, 'Couple Pack (live)', 1);
  await payCash(page);
  const d = page.getByRole('dialog', { name: /^Couple-of-Stickers for/ });
  await d.getByLabel('Name or nickname').fill('Kaye');
  await d.getByLabel('Pack 1, person 1: name').fill('Kaye');
  await d.getByLabel('Pack 1, person 2: name').fill('Mark');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  const stickRow = async () => (await list(`ws/${ws}/t_studioFeed`)).find((x) => x.name.includes('/stick:'));
  await expect.poll(async () => (await stickRow()) ? str((await stickRow())!, 'feed', 'nickname') : '', { timeout: 30_000 }).toBe('Kaye');
  const row = (await stickRow())!;
  expect(str(row, 'feed', 'type')).toBe('stick');
  const pack = row.fields.feed.mapValue!.fields.packs.arrayValue!.values![0];
  expect(pack.mapValue!.fields.file.stringValue).toBe('CS01-Kaye-Mark');

  // The running event's summary follows a little after the sale.
  await expect.poll(async () => (await list(`ws/${ws}/t_studioFeed`)).some((x) => x.name.includes('/event:') && str(x, 'feed', 'name') === 'Live Fair'), { timeout: 60_000 }).toBe(true);
  expect(errors).toEqual([]);
});
