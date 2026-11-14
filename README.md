# JoshWorks POS

The event register for JoshWorks. It keeps selling with no internet, knows what every sticker, pin and shirt costs to make, splits the profit with the team, and turns each event into a PDF report.

It's an installable web app: open the link once, tap **Install**, and it runs from its own icon on phones, tablets and laptops, offline.

## What's in it

The menu is grouped: **Selling** (Sell, Sales log, Orders), **Events** (This event, All events), **Studio** (Products, Production, Pricing) and **People** (Team, Customers). Activity sits in the top bar; the profile menu at the top right holds light/dark mode, switching person, My page and Settings. On computers the menu can be collapsed to icons. It never scrolls: it tightens on shorter screens, and phones get a bottom bar. The app works on phones, iPads, laptops, monitors and TVs.

| Screen | What it does |
|---|---|
| **Dashboard** | The owner's start screen: greeting, live clock (digital and analog), a month calendar with every event on it, the event in progress (sales today, whole event, break-even), what needs attention (missing prices or costs, registers left open, unpaid payouts, events to report, materials to reorder), latest sales and recent activity. |
| **Sell** | Before the register opens, the event's price list for whoever sells to check: every product on sale with its event price (the regular price crossed out), anything still without a price, the bundle deals and the discounts they can give. Then product tiles, search, barcode scanning (camera or USB/Bluetooth scanner), automatic bundle deals ("4 for ₱75"), preset and typed discounts, free items, Cash / GCash / Maribank / bank transfer with reference numbers and split payments, held sales, digital receipts with a QR code, opening float, cash in/out (cash or GCash: only cash changes the drawer), and closing the register with a denomination count. Add the customer to a sale for stamps; type voucher codes. Email the receipt (JoshWorks-branded) from the receipt screen. **Customer screen**: a second monitor facing the customer shows each item and the total as you ring it up, deals and discounts as savings, a nudge when they are one item short of a bundle deal, the amount and your GCash QR when they pay, and a thank-you with the receipt QR and any coupon they earned. Slides play beside the cart while they buy, and full screen after 20 seconds with nothing rung up: this event's prices by category (the regular price crossed out when the event changes it), bundle deals, sticker printing and illustration rates, the booth coupon, today's best sellers, orders ready for pickup (order number and first name), the prize wheel and how to qualify, custom sticker designs from Google Drive (PNGs named like CS01-Couple.png in Drive → JoshWorks POS → Custom stickers, shown with their number, name and the matching order's status, kept on the laptop for offline), and your own posters and videos between them (Settings → Customer screen; they stay on that laptop). Chrome and Edge find the second monitor and open it there (allow window management once); it works with no internet. |
| **Sales** | Every sale with the price it sold at, with order deposits, services (sticker printing paid at the register) and cash in and out. **Money in** on top: the total and each payment method (Cash, GCash, bank) after cash in and out, booth sales, deposits and services apart, and what the open drawers should hold. Filter by register. Void with a reason (owner PIN), fix a wrong payment method, and fix or remove a cash move recorded wrong (owner PIN, on the register's phone or once it's closed). |
| **Orders** | Pre-orders and commissions: catalog items or custom pieces, who makes it, ready-by time, a queue number per register (QA-01). A deposit is money in (drawer, GCash) but becomes a sale only at pickup, when the real items come out of stock with their production cost; cancel to refund it (owner PIN) or keep it. "Ready" emails the customer or copies a message for Messenger. Event summary shows deposits held. The owner can send a commission to JoshWorks Studio as a job (customer, maker, price and every payment). Closed orders can still have their customer, notes and maker fixed; their items and price stay. The owner can delete an order with no money on it, and it leaves Studio too. Custom sticker orders (here and in Printing) can carry a **design no.**, the number on the design file in Drive (CS01 for CS01-Couple.png). **Find an order** (on Sell, Orders and Printing) recalls an order by its number, design no., the customer's name or part of their phone number, and shows what they ordered, its status and what's still due. Marking an order **Ready** calls it out loud: a chime, then the laptop's English voice says "Order Q A zero seven, for Leanna. Your order is ready. Please come to the counter." twice, while the customer screen shows **Now calling QA-07**. **Call** on a ready order calls it again; works offline in Chrome and Edge; on or off in Settings → Customer screen, with **Test the voice**. |
| **Printing** | The sticker printing service, priced from the JoshWorks rate card (per A4 sheet by material, die cut and peel-off add-ons, peel-off sheets shared per A4, packaging by size, food labels). Quote and proof, 50% down, print, then pickup or courier with the balance; the quote PDF is on the letterhead with your payment QR codes. Who prints gets a share; JoshWorks Studio books each job (client, payments, the printer's earnings, courier and materials). See [docs/PRINTING.md](docs/PRINTING.md). |
| **Event** | **Plan** (a checklist in four parts: before, pack, on the day, after; a JoshWorks starter list on every new event, copied from past events; stock to bring and what is still to buy; progress on the Dashboard), Summary (sales by hour, payments, top products, break-even, the three layers: Trading, Event result, Cash), **Edit prices** (base vs event prices, bulk +₱/+%/round to ₱5, booth-aware floor and suggested prices), **Stock** (brought, sold, left, sell-through), **Booth spend** (booth fee, used-up items, reusable assets spread over events (each later event in date order pays its share until the item is paid off, shown as "event 2 of 6 · ₱104 of ₱312 paid off"), materials to stock, receipts photos, reimbursements), **Team & payouts** (roster and shifts, 40/60 split by role weight × hours, minimum guarantee, partner deals fixed or tiered by sell-through, design royalties, mark paid), **Coupons** (service coupons for this event: single-use codes from a code generator, one shared code, or a code every booth sale over an amount earns on its receipt; pesos or percent off JoshWorks services of ₱2,500 or more (print orders, commissions, service quotes, Studio jobs), never booth merch; good from the event until an expiry; totals, who used each code on what and for how much, and reminders before codes run out. See [docs/COUPONS.md](docs/COUPONS.md)), **Wheel** (a prize wheel for this event: it spins after a sale of at least an amount, or of so many items from a category; prizes are a free product, handed over as a ₱0 sale so stock stays right, or a one-time discount code for the next purchase at the event; each prize has its own chance and an optional daily limit, and what is left is "Try again"; each slice is drawn as wide as its chance; the cashier taps Spin on the receipt and it spins on the customer screen; promos with a chance to win need a DTI permit), **Report** (full PDF, one-page summary, payout slips, end of day, CSV, and **Send to Studio**: the event's sales by payment method, everyone's payout and who's been paid, booth costs, production cost and partner shares, for JoshWorks Studio → Money → Booth events on this device, or as a file for Studio on another). |
| **Events** | Create, or start from a past event (prices, team, deals and the checklist carry over). **Compare events**: up to five side by side, with sales, sales per open hour, sales per peso of booth fee, profit before and after event costs, cash share, sell-through, discounts, service coupons used and the services they booked, and best sellers, with the best in each row highlighted. |
| **Products** | Catalog, categories, bundle deals, design credit and royalties, barcode labels for your A4 sticker paper. **Arrange**: drag products (or use the arrows) into the order they show at the register, all at once or one category at a time; the order syncs to every phone. |
| **Production** | Cost per piece by hand, from a recipe (materials, labor, packaging, spoilage, overhead, with a sticker-size helper), or from logged batches (weighted average). Materials with pack costs, stock and reorder points. **Restock plan**: for the next event, each product's sales per open hour at recent events (newest counting most, and only events it was on the table), times the hours you'll be open, plus extra to be safe, less what's in the studio. Change any amount, tap **Make it** to log the batch with its recipe filled in, set the targets as the event's stock to bring, and get the materials to buy (packs and cost) from the recipes. Prints as a PDF. |
| **Pricing** | Service quotes (logo, branding, shirts, tarp, layout…), sticker jobs priced by size, quick checks (client's price, markup ↔ margin, booth fee, bulk ladder), quote archive with win rate, quote PDFs on the JoshWorks letterhead (with a 50% down payment line and where to pay), and your rates. |
| **Team** | People, roles (Owner, Cashier, Designer, Partner), and invite links for their phones. Cashiers and designers add, edit, arrange and delete products and set prices from their own phones, and every change reaches every phone; costs and profit stay with the owner. Every phone updates itself to the newest version (never mid-sale), and the app tells the owner when Firebase needs the newer security rules. |
| **Customers** | Who buys from the booth: visits, spend and history, with consent to message them recorded (Data Privacy Act); delete on request wipes their details. **Vouchers**: codes like KOMIKET50 with pesos or percent off, minimum spend, dates, one event, total and per-customer limits. **Coupons**: every event's service coupons in one place (see the Event row). **Stamp card**: a stamp per ₱X spent and a reward after N stamps. Stamps and voucher uses are counted from sales, so merging phones never doubles them. |
| **My page** | What a designer sees: their shifts, payouts and how their designs sold. |
| **Activity** | Who changed a price, voided a sale, or edited a payout, and when. The top-bar button shows the latest, with a dot when someone else changed something. |
| **Settings** | Business, this device's register letter, owner PIN, payment methods and QR codes, **email**, backups and merging a second phone's sales, cloud sync, install help. |
| **Email** | Receipts and an automatic **end-of-day summary** (sales, payments, registers, inventory with what to restock, materials to reorder, and the End-of-day PDF attached) sent from the studio Gmail through the same Google Apps Script mailer JoshWorks Studio uses ("Use Studio's mailer" fills it in on a device that has both apps). The summary goes out when a register closes, or at a set time, and catches up on missed days. Offline, emails wait in an outbox and send by themselves. The mailer link and key stay on the device, never in backups. |

## Day to day

- [Event day checklist](docs/EVENT_DAY.md)
- [Sticker printing: the process and where the money goes](docs/PRINTING.md)
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
npm run e2e          # browser tests with the installed Chrome: smoke, two-phone offline dry run, tour, layout on 14 screen sizes, owner recovery, restore, customers, email, orders, plan and compare, restock plan, Studio link, documents on the letterhead, arranging products, sticker printing, money in (cash and GCash moves, services), the customer screen, the prize wheel
npm run emulators    # Firebase Auth + Firestore emulators (needs Java 11+)
npm run e2e:cloud    # owner, cashier and designer syncing through the emulators
```

**Versions**: the profile menu shows the release number from `package.json` (1.0.0 was the first). Raise it with every release: the middle number for new features (1.1.0), the last for fixes (1.0.1).

**How it works**

- React + TypeScript + Vite, installable PWA (vite-plugin-pwa / Workbox). Hash routing, so it runs from any sub-folder.
- The on-device database (IndexedDB via Dexie) is the source of truth. Money is stored as whole centavos.
- Every synced record has `id`, `updatedAt`, `_dev` and a `_sync` flag; deletes are tombstones. Merge files and cloud sync both keep the newer copy, so merging twice never doubles a sale.
- Cloud sync (optional) is the team's own Firebase project: Auth (email + password, verified) and Firestore under `ws/{team}/t_{table}`. Rules in `firebase/firestore.rules` enforce roles and reject older writes. Costs, materials, batches, booth spend and quotes never leave the owner's devices.
- PDFs are generated on the device with pdfmake using bundled Manrope and Sora fonts (Manrope has the ₱ sign). Quotes, event reports, the one-page summary, payout slips, the end of day and the restock plan print on the JoshWorks letterhead (Legal size, the brand-kit frame), laid out like JoshWorks Studio's documents: a teal title, a grid with who and when, teal section headings, and on quotes the payment QR codes from Settings → Payment methods (names only, never account numbers). Barcode label sheets stay plain A4 so they line up with the sticker paper.

```
src/
  app/          shell, routing, roles and permissions, PIN prompts
  db/           Dexie schema, types, write helpers, settings, seed data from the old sheets
  domain/       pure logic: cart and bundles, costs, profit share, summaries, sticker and service pricing
  services/     database operations: selling, events, production, spend, team, backups
  features/     screens
  reports/      PDF builders on the letterhead (event report, summary, slips, end of day, quotes, restock plan) and label sheets
  barcode/      scanner input and camera scanning
  sync/         Firebase sync engine, sign-in, invite links
tests/          Vitest
e2e/            Playwright
firebase/       Firestore rules
```
