import { expect, test, type Page } from '@playwright/test';
import { SHOTS, createEvent, payCash, setEventPrice, setupOwner, tapProduct } from './helpers';

/**
 * Cloud sync against the Firebase emulators (run `npx firebase-tools emulators:start --only auth,firestore`).
 * Owner, cashier and designer are three separate browser profiles, i.e. three phones.
 */

const PROJECT = 'demo-jwpos';
const FIREBASE = { apiKey: 'demo-key', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: 'demo-app', emulator: { host: '127.0.0.1', authPort: 9099, firestorePort: 8080 } };
const CFG = { firebase: FIREBASE, ws: 'joshworks' };
const PASSWORD = 'secret123';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const inviteHash = (email: string, name: string) => `/#/join?i=${b64url(JSON.stringify({ c: CFG, e: email, n: name }))}`;

async function emulatorsUp() {
  try {
    const r = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/config`);
    return r.ok;
  } catch {
    return false;
  }
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

async function signUpAndVerify(page: Page, email: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await verifyEmail(email);
  await page.getByRole('button', { name: /I.ve verified/ }).click();
}

async function countLocal(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (s) =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('jworks-pos');
        req.onsuccess = () => {
          const tx = req.result.transaction(s, 'readonly');
          const c = tx.objectStore(s).count();
          c.onsuccess = () => resolve(c.result);
          c.onerror = () => reject(c.error);
        };
        req.onerror = () => reject(req.error);
      }),
    store,
  );
}

test('owner, cashier and designer sync through the cloud', async ({ browser }) => {
  test.setTimeout(240_000);
  test.skip(!(await emulatorsUp()), 'Firebase emulators are not running');
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  const owner = await (await browser.newContext()).newPage();
  const cashier = await (await browser.newContext()).newPage();
  const designer = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  for (const p of [owner, cashier, designer]) p.on('pageerror', (e) => errors.push(e.message));

  // ---- Owner sets up, then connects to the cloud
  await setupOwner(owner, 'Test Owner', '1357');
  await createEvent(owner, 'Cloud Fair');
  await setEventPrice(owner, 'Enamel Pins', 30);
  await setEventPrice(owner, 'Couple Pack (live)', 200);

  // A production cost that must never reach the cashier's phone
  await owner.goto('/#/production');
  await owner.getByRole('row', { name: /Enamel Pins/ }).click();
  await owner.getByLabel('Cost to make one').fill('12');
  await owner.getByRole('button', { name: 'Save cost' }).click();

  await owner.goto('/#/settings?section=sync');
  await owner.getByLabel('Paste the firebaseConfig').fill(JSON.stringify(FIREBASE));
  await owner.getByRole('button', { name: 'Connect this device' }).click();
  await signUpAndVerify(owner, 'owner@jw.test');
  await expect(owner.getByText('Signed in as')).toBeVisible({ timeout: 20_000 });

  // Invite the team
  await owner.goto('/#/team');
  for (const [name, email, role] of [['Cara Cashier', 'cashier@jw.test', 'Cashier'], ['Dino Designer', 'designer@jw.test', 'Designer']]) {
    await owner.getByRole('button', { name: 'Add person' }).click();
    const d = owner.getByRole('dialog', { name: 'Add a person' });
    await d.getByLabel('Name').fill(name);
    await d.getByLabel('Email').fill(email);
    await d.getByLabel('App role').selectOption({ label: role });
    await d.getByRole('button', { name: 'Add' }).click();
    await expect(owner.getByRole('row', { name: new RegExp(name) }).getByText('Can sign in')).toBeVisible({ timeout: 15_000 });
  }
  await expect(owner.locator('.status-pill', { hasText: 'Synced' })).toBeVisible({ timeout: 30_000 });
  await owner.screenshot({ path: `${SHOTS}/20-team-invites.png` });

  // ---- Cashier joins with the invite link
  await cashier.goto(inviteHash('cashier@jw.test', 'Cara'));
  await signUpAndVerify(cashier, 'cashier@jw.test');
  await expect(cashier.getByText('You’re in as Cashier')).toBeVisible({ timeout: 20_000 });
  await cashier.getByLabel('Register letter for this phone').fill('B');
  await cashier.getByRole('button', { name: 'Open the app' }).click();
  await cashier.getByRole('button', { name: 'Change event' }).click();
  await cashier.getByRole('dialog', { name: 'Choose the event' }).getByRole('button', { name: /Cloud Fair/ }).click({ timeout: 20_000 });
  await cashier.goto('/#/sell');
  await cashier.getByRole('button', { name: 'Open register' }).click();
  await tapProduct(cashier, 'Enamel Pins', 2);
  await payCash(cashier);
  await cashier.getByRole('button', { name: 'New sale' }).click();

  // The cashier's phone has no costs and no owner screens
  expect(await countLocal(cashier, 'productCosts')).toBe(0);
  expect(await countLocal(cashier, 'costPoints')).toBe(0);
  await expect(cashier.getByRole('link', { name: 'Products' })).toHaveCount(0);

  // ---- The owner sees the cashier's sale arrive
  await owner.goto('/#/sales');
  await expect(owner.getByText('B-0001')).toBeVisible({ timeout: 30_000 });

  // ---- Cashier sells with no internet, then reconnects
  await cashier.context().setOffline(true);
  await tapProduct(cashier, 'Couple Pack (live)', 1);
  await payCash(cashier);
  await cashier.getByRole('button', { name: 'New sale' }).click();
  await expect(cashier.locator('.status-pill.offline')).toBeVisible();
  await cashier.screenshot({ path: `${SHOTS}/21-cashier-offline.png` });
  await cashier.context().setOffline(false);
  await expect(owner.getByText('B-0002')).toBeVisible({ timeout: 45_000 });

  // ---- Designer joins; the owner saves payouts; the designer sees only their own
  await designer.goto(inviteHash('designer@jw.test', 'Dino'));
  await signUpAndVerify(designer, 'designer@jw.test');
  await expect(designer.getByText('You’re in as Designer')).toBeVisible({ timeout: 20_000 });
  await designer.getByRole('button', { name: 'Open the app' }).click();
  await expect(designer.getByRole('heading', { name: /Hi, Dino Designer/ })).toBeVisible({ timeout: 20_000 });

  await owner.goto('/#/event/team');
  await owner.getByRole('button', { name: 'Add to roster' }).click();
  const roster = owner.getByRole('dialog', { name: 'Add to the roster' });
  await roster.getByRole('listitem').filter({ hasText: 'Dino Designer' });
  await roster.locator('.list-item', { hasText: 'Dino Designer' }).getByRole('button', { name: 'Add' }).click();
  await roster.locator('.list-item', { hasText: 'Cara Cashier' }).getByRole('button', { name: 'Add' }).click();
  await roster.getByRole('button', { name: 'Done' }).click();
  await owner.getByRole('button', { name: 'Save payouts' }).click();
  await expect(owner.getByRole('row', { name: /Dino Designer/ }).first()).toBeVisible();

  await expect(designer.getByText('Cloud Fair').first()).toBeVisible({ timeout: 45_000 });
  await expect(designer.getByText('Staff share').first()).toBeVisible({ timeout: 45_000 });
  expect(await countLocal(designer, 'payouts')).toBe(1);
  expect(await countLocal(designer, 'productCosts')).toBe(0);
  expect(await countLocal(designer, 'spend')).toBe(0);
  await designer.screenshot({ path: `${SHOTS}/22-designer-my-page.png`, fullPage: true });

  expect(errors).toEqual([]);
});
