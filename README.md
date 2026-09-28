# JoshWorks POS

The event register for JoshWorks. It keeps selling with no internet, knows what every sticker, pin and shirt costs to make, splits the profit with the team, and turns each event into a PDF report.

It's an installable web app: open the link once, tap **Install**, and it runs from its own icon on phones, tablets and laptops, offline.

## What's in it

The menu is grouped: **Selling** (Sell, Sales log), **Events** (This event, All events), **Studio** (Products, Production, Pricing) and **People** (Team). Activity sits in the top bar; the profile menu at the top right holds light/dark mode, switching person, My page and Settings. On computers the menu can be collapsed to icons. It never scrolls: it tightens on shorter screens, and phones get a bottom bar. The app works on phones, iPads, laptops, monitors and TVs.

| Screen | What it does |
|---|---|
| **Dashboard** | The owner's start screen: greeting, live clock (digital and analog), a month calendar with every event on it, the event in progress (sales today, whole event, break-even), what needs attention (missing prices or costs, registers left open, unpaid payouts, events to report, materials to reorder), latest sales and recent activity. |
| **Sell** | Product tiles, search, barcode scanning (camera or USB/Bluetooth scanner), automatic bundle deals ("4 for ₱75"), preset and typed discounts, free items, Cash / GCash / Maribank / bank transfer with reference numbers and split payments, held sales, digital receipts with a QR code, opening float, cash in/out, and closing the register with a denomination count. |
| **Sales** | Every sale with the price it sold at. Void with a reason (owner PIN), fix a wrong payment method. |
| **Event** | Summary (sales by hour, payments, top products, break-even, the three layers: Trading, Event result, Cash), **Edit prices** (base vs event prices, bulk +₱/+%/round to ₱5, booth-aware floor and suggested prices), **Stock** (brought, sold, left, sell-through), **Booth spend** (booth fee, used-up items, reusable assets spread over events, materials to stock, receipts photos, reimbursements), **Team & payouts** (roster and shifts, 40/60 split by role weight × hours, minimum guarantee, partner deals fixed or tiered by sell-through, design royalties, mark paid), **Report** (full PDF, one-page summary, payout slips, end of day, CSV). |
| **Events** | Create, or start from a past event (prices, team, deals carry over). |
| **Products** | Catalog, categories, bundle deals, design credit and royalties, barcode labels for your A4 sticker paper. |
| **Production** | Cost per piece by hand, from a recipe (materials, labor, packaging, spoilage, overhead, with a sticker-size helper), or from logged batches (weighted average). Materials with pack costs, stock and reorder points. |
| **Pricing** | Service quotes (logo, branding, shirts, tarp, layout…), sticker jobs priced by size, quick checks (client's price, markup ↔ margin, booth fee, bulk ladder), quote archive with win rate, quote PDFs, and your rates. |
| **Team** | People, roles (Owner, Cashier, Designer, Partner), and invite links for their phones. |
| **My page** | What a designer sees: their shifts, payouts and how their designs sold. |
| **Activity** | Who changed a price, voided a sale, or edited a payout, and when. The top-bar button shows the latest, with a dot when someone else changed something. |
| **Settings** | Business, this device's register letter, owner PIN, payment methods and QR codes, backups and merging a second phone's sales, cloud sync, install help. |

## Day to day

- [Event day checklist](docs/EVENT_DAY.md)
- [Turning on cloud sync and inviting the team](docs/CLOUD_SETUP.md)

## Putting it online (free)

The app is a set of static files, so any static host works. With GitHub Pages:

1. Create a GitHub repository and push this folder to its `main` branch. The old workbooks in `sheet files/` are excluded on purpose (they contain client details).
2. In the repository: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` builds, tests and publishes the app (see `.github/workflows/deploy.yml`). The link looks like `https://<account>.github.io/<repo>/`.

Open that link on each device once while online, install it, and it works offline from then on. Updates arrive the next time a device is online; the app asks before reloading, never mid-sale.

## For developers

Requires Node 22.12 or newer.

```bash
npm install
npm run dev          # local development server
npm run build        # type-check and production build into dist/
npm run preview      # serve the production build (offline caching works here)
npm test             # unit and service tests (Vitest)
npm run e2e          # browser tests with the installed Chrome: smoke, two-phone offline dry run, screenshot tour, layout on 14 screen sizes
npm run emulators    # Firebase Auth + Firestore emulators (needs Java 11+)
npm run e2e:cloud    # owner, cashier and designer syncing through the emulators
```

**How it works**

- React + TypeScript + Vite, installable PWA (vite-plugin-pwa / Workbox). Hash routing, so it runs from any sub-folder.
- The on-device database (IndexedDB via Dexie) is the source of truth. Money is stored as whole centavos.
- Every synced record has `id`, `updatedAt`, `_dev` and a `_sync` flag; deletes are tombstones. Merge files and cloud sync both keep the newer copy, so merging twice never doubles a sale.
- Cloud sync (optional) is the team's own Firebase project: Auth (email + password, verified) and Firestore under `ws/{team}/t_{table}`. Rules in `firebase/firestore.rules` enforce roles and reject older writes. Costs, materials, batches, booth spend and quotes never leave the owner's devices.
- PDFs are generated on the device with pdfmake using bundled Manrope and Sora fonts (Manrope has the ₱ sign).

```
src/
  app/          shell, routing, roles and permissions, PIN prompts
  db/           Dexie schema, types, write helpers, settings, seed data from the old sheets
  domain/       pure logic: cart and bundles, costs, profit share, summaries, sticker and service pricing
  services/     database operations: selling, events, production, spend, team, backups
  features/     screens
  reports/      PDF builders (event report, summary, slips, end of day, labels, quotes)
  barcode/      scanner input and camera scanning
  sync/         Firebase sync engine, sign-in, invite links
tests/          Vitest
e2e/            Playwright
firebase/       Firestore rules
```
