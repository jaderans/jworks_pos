# Service coupons

Coupons bring people you meet at a booth back for a JoshWorks service. Each set of coupons belongs to one event, so you can see what each booth brought in.

A coupon comes off a **service of ₱2,500 or more**: a print order, a commission order, a service quote or a Studio job. It never works on booth merch at the register. Register discounts are **vouchers** (Customers → Vouchers).

## Making coupons

Open **This event → Coupons → New coupons**. **Customers → Coupons** shows every event's coupons.

- **Single-use codes.** Make up to 500 at a time, and more later. Each code starts with the event's initials and year, like `KI26-7F3QX`. Codes never use 0/O or 1/I, which are easy to misread. **Copy codes** copies the unused ones, to print on cards or send.
- **One shared code.** One code for a post or a partner, like `KI26-STUDIO`. Set how many uses it allows, or leave it blank for no limit.
- **Booth sales earn one.** Turn this on and set an amount, like ₱500. Every booth sale of at least that much gets a new code. The code shows on the receipt, on the QR copy and on the emailed receipt. Each sale gets one code, from the biggest set it reaches. If the sale is voided, its code is turned off, unless it was already used.
- **What it takes off:** pesos, or a percent with an optional cap, like 10% up to ₱1,000.
- **Minimum:** the service has to cost at least ₱2,500. You can raise the minimum, but not lower it.
- **Dates:** good from the event's first day until the expiry. The expiry starts at 60 days after the event; change it if you like.

## Using a coupon

Type the code where the service is priced. The app checks four things before the discount goes on:

- the code exists and is turned on;
- today is within its dates;
- it hasn't been used up;
- the service costs at least the minimum.

If something fails, the app says why, for example "KI26-7F3QX was already used by Mira Bakeshop (Print order PA-001)." A service that already holds a code keeps it, even after the code expires.

Where codes go:

- **Services.** In the service order. The coupon comes off the print work, not the delivery fee. The 50% down payment is worked out on the price after the coupon.
- **Orders.** The coupon comes off the custom pieces (commissions), not catalog products. The pickup sale shows it as a discount.
- **Pricing → Service quote.** The coupon comes off the price before VAT. VAT, profit and the quote PDF all use the price after it. Marking a quote **Lost** frees the code; marking it **Won** again takes the code back.
- **JoshWorks Studio.** In **Job → Money → Service coupon**. Studio checks the code against the POS on the same device, and the discount goes on the job. The POS counts the job as a use the next time it opens.
- **Anywhere else.** For a booking on Messenger, or a Studio job on another device, use **Coupons → Record a use**.

## Who pays for the discount

Everyone, in proportion. The printer's share is worked out on the print work after the coupon. In Studio, the team split is worked out on the job's price after it.

## The Coupons tab

- **Totals:**
  - the codes made;
  - how many were used, and what share of the codes that is;
  - the services booked with them, at the price before the coupons;
  - the discounts given, and what came in.
- **Each set:**
  - its terms, and how many codes are used and open;
  - **Make codes**, **Copy codes**, **Edit** and **Turn off**;
  - delete a set while none of its codes have been used.
- **Who used them:** the customer, the code, the service, its price and the discount.
- **Codes:**
  - search, or filter by status: open, claimed, expired or turned off;
  - give a code to a customer, so they get a reminder;
  - turn a single code off;
  - download everything as a CSV.
- **Running out soon:** codes you gave to customers that end within two weeks and haven't been used. **Message** copies a reminder to paste in Messenger or SMS. **Email** sends it through the studio Gmail.
- **Used twice:** two phones offline at the same time can both use a single-use code. The tab flags it; remove the coupon from one of the two services.

## Results for each event

- **This event → Report** shows what the event's coupons brought in.
- The full event report PDF has a **Service coupons** section.
- **Events → Compare** has two rows: coupons used, and the services booked with them.

Service sales are paid through print orders, orders, quotes and Studio jobs. They never count as the event's booth sales or in its profit share.

## Cloud sync

Coupons, codes and uses sync like everything else:

- only the owner makes and edits coupon sets;
- booth sales on any phone can earn codes;
- anyone who takes a service can apply a code.

After this update, paste the Firestore rules again once (**Settings → Cloud sync**). The rules version is now 2026-11-04c.
