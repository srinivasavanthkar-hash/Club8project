# User guide (by role)

Sign in with your own username. Use the **search bar** at the top for any membership number (with or without
prefix, e.g. `9030`), lead ID, name, mobile (any format, e.g. `+91 98450 12345`) or email. You only see the
menus and actions your role allows; the server enforces the same rules.

Dates are shown as DD-MM-YYYY (India time) and amounts as ₹2,55,000.00. Every change you make is recorded with
your name, the time, and the old and new values.

## Marketing (OPCs / street marketing)
1. **Leads → New lead.** Enter the prospect's name, mobile (tick "WhatsApp same as mobile" if it is), email,
   city, venue and your name as OPC. Add a first note.
2. If the system warns about a **possible duplicate**, open the matches. Only save anyway if you are sure, and
   give a reason (it is logged).
3. Move the lead through **Contacted → Presentation scheduled** (enter the date and time) **→ Attended**, or
   **Not interested**. Use **Notes** for each conversation; old notes are never overwritten.

## Sales
* **Dashboard → Lead follow-ups** lists your leads due today and overdue.
* **Convert to member** appears on a lead once it is **Attended**. The application form opens pre-filled and
  follows the **paper form, top to bottom**:
  1. Purchaser details (both applicants, address, mobiles, email) and KYC IDs. Aadhaar: type the number (it is
     checked and only the last 4 digits are kept) and upload only a **masked** copy.
  2. Membership details: company/brand, membership number (leave blank to auto-assign), purchase date, tenure,
     first year (last year is calculated), category, season, unit type, nights per year. The current ASF is shown
     for information.
  3. Payment details: price, admin fees, down payment and how it was paid (reference and card **last 4 digits
     only**), balance mode and EMI details.
  4. Joining offer lines (bonus nights are credited automatically on approval).
  5. Relationship manager, team manager, signatures and comments.
* After saving, upload the **signed agreement** under *Correspondence & Documents*. The member stays
  **Pending approval** until a manager approves.

## Management
* **Approve** members from *Profile*. The approval panel lists anything missing (down payment, signed agreement,
  KYC, mandatory fields).
* **Activity log**: filter by user, date, action, entity or member. **Verify integrity** checks the tamper-proof
  hash chain. Export to Excel. Every member's *History* tab shows that member's trail.
* **Exports**: leads, members, payments, reservations, entitlement balances and the activity log, with filters.
  Exports are logged.
* **Terminate** a membership only after an unpaid default notice has expired (*Finance* tab).
* **Admin → Users & roles**: create users, assign roles, tick permissions per role.
* **Admin → Master data & rates**: add rates as **new effective-dated rows** (the previous row is closed
  automatically). ASF increases above 5% need an override reason and the special permission.

## Finance
* *Member → Finance*: totals per payment type and currency (GST shown separately), the ASF status per membership
  year, the EMI schedule and the payment ledger.
* **Generate EMI schedule** uses the application's EMI details. If EMI × count ≠ balance, the last instalment is
  adjusted and a warning is shown. Editing an instalment requires a reason.
* **Record payment**: choose the type and method (Cash is disabled), enter the reference, and a PDF receipt is
  produced. EMI payments are applied to the oldest instalments first; any overpayment is kept as credit.
* **Pay ASF** appears on each raised ASF year. ASF is paid in full (base + 5% GST) in one payment.
* **Correct**: never edit a payment. Use *Correct* to post a reversal or a signed adjustment with a reason.
* **Issue default notice** (members with overdue EMIs): a PDF notice with a 14-day deadline is generated and filed.
  If the overdue amount is paid in time, the member returns to Active automatically.
* **Finance dashboard**: overdue EMIs, reservations waiting on ASF, and members in default with days remaining,
  filterable by company and managers.

## Reservations
* *Member → Reservations → New reservation*: choose destination, property, unit, dates and guests. Before you
  submit, the screen shows **how many entitlement nights will be used and from which years** (saved, current,
  borrowed), any paid additional nights, and the **ASF payable**. Warnings (booking window, occupancy, gift/rent
  rules) explain what is needed.
* On the reservation page: **Approve** (deducts nights), then **Confirm** with the property's confirmation number.
  Confirmation is blocked until the ASF for the years used is paid.
* **Reschedule** keeps the original dates in the history; the nights are adjusted, never deducted twice. A third
  reschedule needs a manager.
* **Decline / Cancel** need a reason. Cancelling a confirmed booking needs the member's written request (link
  their email or uploaded letter). Nights are credited back by notice period: more than 30 days 100%, 15–30 days
  50%, under 15 days none.
* **Generate voucher** for confirmed bookings.

## Member services
* *Correspondence & Documents*: add emails (or import `.eml`/`.msg` files; replies are threaded automatically),
  log calls with outcome and next action, upload PDF/JPEG/PNG documents and preview them. Deleting a document
  needs a reason.
* The **timeline** shows everything about the member in date order; filter by type.
