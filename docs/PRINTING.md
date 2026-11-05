# Sticker printing service

Print jobs for customers (custom stickers, sticker sheets, peel-off packs and food labels) are taken and tracked in the POS under **Selling → Printing**. Their money is booked in JoshWorks Studio as a **Sticker Printing** job. They're separate from booth events: a print job never changes an event's sales, report or profit share.

## The process

The steps follow the rate sheet's *How to order* page.

1. **Message.** The customer says what they want (material, cut, quantity, packaging). Tap **New print order**, add the customer, then add lines from the rate card:
   - **Sticker sheets:** the material, the cut (kiss cut is included, die cut is +₱10 a sheet) and the number of A4 sheets. Optionally add the sticker size, so the line shows about how many stickers that is.
   - **Peel-off sheets:** the material, the peel-off size and how many. One A4 is shared by the sheets cut from it: (material + ₱17 peel-off cut) ÷ sheets per A4.
   - **Packaging:** the type, the size and the number of packs.
   - **Other:** layout or design work, a rush fee, anything else.

   Pick **Pickup** or **Courier**. For a courier, add the courier, the delivery fee and the address. The fee is added to the order and the studio pays the courier. The app warns about the minimums: 3 A4 sheets, and 20 packs per packaging design.
2. **Files.** Paste the Drive or Messenger link in **Files**. The **PDF** button gives the customer a quote on the JoshWorks letterhead. It shows the items, the total, the 50% down payment, the file checklist and your payment QR codes.
3. **Approve.** Send the proof and tap **Proof sent**. When they say yes, tap **Approved**: the ready-by date is set, the lead time's longest day counted in working days.
4. **Pay.** Take the **50% down payment** (GCash, bank or cash) with **Payment**. **Start printing** moves it to Printing; the app asks first if the down payment isn't in.
5. **Print, then hand over.**
   - When it's done, tap **Ready**.
   - Tap **Picked up**, or **Shipped** with the tracking number. If a balance is still due, the app offers to take it first.

Anyone on the team can work print orders: the owner, cashiers and designers. Only the owner edits the **rate card**, on the same page. Every price, cut and packaging rate can be changed there, plus the minimums, the lead time, the down payment and the printer's share. Add each material's **cost per sheet** (paper, laminate, ink) to see the real profit in Studio.

## Where the money goes

- **In the POS:**
  - Payments are recorded on the print order, not as booth sales.
  - Cash taken while a register is open on that phone is added to the drawer as a cash-in ("Print order PA-007"), so the drawer still counts out right.
  - GCash and bank payments go wherever your GCash or bank account is. The order keeps the reference number.
- **In JoshWorks Studio (Money → Booth events → Sticker printing):**
  - Each print order shows up by itself, on the same device or from the Studio file. **Add to Studio** books it as a Sticker Printing job:
    - The **customer** becomes a client, matched by email, then by name.
    - **Payments:** the down payment is a down payment, and the balance is the final payment. They count in Studio's income, reports and BIR.
    - **The printer's share:** whoever prints it gets their % of the print work (20% to start, not counting the delivery fee) as their earnings. It's released as the customer pays, so Payouts shows what's owed.
    - **Expenses:** the courier fee (Transport), and the materials (Printing) when the rate card has costs.
  - **The studio keeps the rest.** For a ₱970 order with a ₱120 courier fee and 20% for the printer: the printer earns ₱170 (20% of ₱850), the courier gets ₱120, and the studio keeps ₱680, less material costs.
  - When the order changes in the POS (a payment, shipped), Studio shows **Changed in the POS**. **Update** brings it in line.

## Fixing or deleting an order

- **Edit:** the pencil works on any order. Once it's done or cancelled, what was printed, the delivery and the price stay as they are, but the customer, who printed it, the files and the notes can still be fixed.
- **Delete (owner only):** the bin on the order. Any payments on it go too, so refund the customer first if you need to. Cash already in a drawer stays counted there. A commission order under **Orders** can't be deleted while it holds money: cancel and refund a deposit, or void a pickup sale in the Sales log, first.
- **In Studio:** a deleted order leaves **Money → Booth events**. If it was already added as a job, it shows under **Deleted in the POS**; **Delete from Studio** removes the job with what came from the POS. Payments entered by hand in Studio stop this, so nothing is lost by accident. On another device, open a new **Studio file** to see what was deleted.
