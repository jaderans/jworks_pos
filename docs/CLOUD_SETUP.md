# Cloud sync and team accounts

Optional. Without it, every device works on its own and moves sales by merge files. With it:

- the whole team keeps one catalog: products, prices and bundle deals edited on any phone show up on every phone,
- designers see their payouts and the event dashboard on their own phones,
- several phones can sell at once and their sales combine by themselves,
- everything is backed up in the cloud.

Selling never waits for the cloud. Each device saves first and uploads when there's any connection, even a minute of hotspot after the event.

It runs on **your own free Firebase project** (Google's Spark plan, no card needed). The steps below take about 10 minutes, once.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with the JoshWorks Google account.
2. **Add project** → name it (e.g. `joshworks-pos`) → you can turn off Google Analytics.
3. **Build → Authentication → Get started → Email/Password → Enable → Save.**
4. **Build → Firestore Database → Create database** → location **asia-southeast1 (Singapore)** → **Start in production mode**.
5. In Firestore → **Rules**: delete everything, paste the contents of [`firebase/firestore.rules`](../firebase/firestore.rules) (the app also has a *Copy the security rules* button in Settings), then **Publish**.
6. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app (no hosting needed) → copy the `firebaseConfig` block.
7. **Authentication → Settings → Authorized domains**: add the domain the app runs on (e.g. `youraccount.github.io`).

## 2. Connect your device (owner)

1. In the app: **Settings → Cloud sync and team accounts**.
2. Paste the `firebaseConfig`, keep the team name `joshworks`, tap **Connect this device**.
3. **Create account** with the email you want the team to know you by. Open the verification link in your email, then tap **I've verified**.
4. The app creates the team and uploads everything on this device.

## 3. Invite the team

1. **Team → Add person**: name, **email**, and app role:
   - **Cashier**: sells and counts the drawer; adds, edits, arranges and deletes products and sets prices; takes orders and print orders and applies service coupons to them (booth sales they ring up can earn coupons); no costs or payouts; voids and big discounts need your PIN.
   - **Designer**: adds, edits, arranges and deletes products, sets prices and counts stock; works print orders, service coupons included; sees event dashboards, their own shifts and payout, and how their designs sold.
   - **Partner**: sees their own payouts only.
2. Tap the **link** icon next to them to send an invite (Messenger, Viber…).
3. They open it on their phone, **Create account** with that same email, verify it, and they're in. Cashiers pick a register letter (B, C…).

To stop someone's access, mark them inactive or remove them in Team.

## When the app is updated

- **The app** updates itself on every phone: it checks every half hour and whenever it's opened, and installs the new version when no sale is in the cart. Otherwise a bar says *A new version is ready* until someone taps **Update now**. The version is shown in the profile menu (top right), so two phones can be compared.
- **The security rules** sometimes change with a new version (new features need new permissions). When Firebase still has the older rules, the app says so: a yellow bar on the owner's screens and *Sync problem* in the top bar. Changes made on any phone meanwhile wait on that phone; nothing is lost. To fix it, the owner opens **Settings → Cloud sync**, taps **Copy the new rules**, opens **Firestore → Rules** from the link there, replaces everything, and taps **Publish**. Every phone notices within a minute and sends what was waiting.

## JoshWorks Studio, live (one Firebase project for both apps)

The POS and JoshWorks Studio can share one Firebase project. Studio then shows the POS's booth events, commission orders, Couple-of-Stickers orders and print orders as they happen, on any device, with no Studio file.

1. **One project.** In Studio, open **Settings → Cloud sync** and paste the same firebaseConfig as here.
2. **One rules file.** `firebase/firestore.rules` is the same file in both apps. The POS's data lives under `ws/` and Studio's under `camp/`. Paste it once in **Firestore → Rules** and tap **Publish**. Don't paste an older rules file from either app: it would lock the other app out.
3. **One owner login.** Sign in to both apps with the same owner email: the one you verified here. When the owner connects here, the POS notes where its data is, so Studio finds it.
4. **The owner's laptop keeps it fresh.** Keep it on and synced during events. Orders reach Studio as soon as they're saved; a running event's summary follows a little after each sale.

In Studio, **Money → Booth events** shows them with a *Live* badge, and the menu counts what's new or changed. Nothing goes into Studio's books until the owner taps **Add to Studio** or **Update**. Couple-of-Stickers orders come in as work-only jobs: who's on each pack, the design files and the photos. They were paid at the booth, so the money stays in the event's job. Customers aren't shared between the apps.

## What stays private

Production costs, materials, batches, booth spend and quotes never leave the owner's devices. Each person only receives their own payouts. The rules in Firestore enforce this even if someone tried to read the database directly. Receipt photos stay on the phone that took them.
