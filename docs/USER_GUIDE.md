# User guide (by role)

Sign in with your own username. Use the **search bar** at the top for any membership number (with or without
prefix, e.g. `9030`), lead ID, name, mobile (any format, e.g. `+91 98450 12345`) or email. You only see the
menus and actions your role allows; the server enforces the same rules.

Dates are shown as DD-MM-YYYY (India time) and amounts as ₹2,55,000.00. Every change you make is recorded with
your name, the time, and the old and new values.

## Your password and two-step verification (everyone)
* **Show / hide:** every password field has an eye button to check what you typed. It hides again when you submit
  or leave the page. A "Caps Lock is on" note appears under the field when Caps Lock is on.
* **Change password:** user menu (your initials, top right) → **Change password**. Enter your current password and
  a new one twice. Use a long passphrase: a few unrelated words. The rules are shown on the screen: at least 12
  characters; not your username or name, and not "club8" or "k8"; not one of your last 5 passwords; not a password
  known from data breaches. The strength meter is a guide only. **Sign out of all other devices** is ticked by
  default; leave it ticked if you think someone else may know your password.
* **Forgot your password, or locked out?** On the sign-in page click **Forgot password?**, enter your username or
  registered email and check your inbox. The link works once, for 30 minutes; a newer request replaces older links.
  Choose a new password (and enter your 2FA code if you use 2FA). You're signed out everywhere and then sign in with
  the new password. The page always says the same thing, whether or not the account exists. Don't recognise a
  "password changed" email? Contact your administrator immediately.
* **No registered email, or no access to it?** Ask an administrator. They can email you a reset link or give you a
  **temporary password** (in person or by phone). A temporary password works for 24 hours; when you sign in with it
  (and your 2FA code, if you use 2FA), you must choose your own password before you can do anything else.
* **Two-step verification (2FA):** when it's on, sign-in asks for the 6-digit code *before* anything else, including
  the change-password screen after a temporary password. To turn it on: user menu → **Set up two-step verification**. Scan the QR code with an
  authenticator app (Microsoft Authenticator, Google Authenticator), then enter the 6-digit code. From then on each
  sign-in asks for a code. New phone or lost phone? Ask an administrator to **Reset 2FA**; you will set it up again
  at your next sign-in.
* **"Your session ended"** on the sign-in page means your password or 2FA was changed (by you on another device or
  by an administrator). Sign in again.

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
  * **Roles** are ticked from the list of existing roles (**Edit roles…** on a user, or in **New user**). Changing a
    user's roles needs a reason, which goes in the activity log.
  * **Two-step verification policy:** tick the roles that must use 2FA and give a reason. People in those roles who
    don't have 2FA yet must set it up at their next sign-in. Off by default (Administrator, Management and Finance
    are marked "Recommended").
  * **New user:** enter username, name and roles. You never type a password: the system creates a temporary one and
    shows it **once** (Show and Copy buttons). Pass it on in person or by phone, never by WhatsApp, SMS or email.
  * **Reset password…** (permission `user.reset_password`, ADMIN only): choose **Email a reset link** (default when
    the user has a registered email; the link goes to that address) or **Give a temporary password** (shown once;
    the user must choose a new password at sign-in). Give a reason. Either way the user is signed out on every device
    and gets a notice by email if they have an address. 2FA is not changed. You cannot reset your own password here
    (use Change password or Forgot password).
  * **Resetting another administrator** creates a request that a **different** administrator must approve within
    24 hours (Admin → "Administrator resets waiting for approval" → Approve, with a reason). The approver receives the
    temporary password. If no second administrator exists, only the designated super-admin can reset directly.
  * **Reset 2FA…** (permission `user.reset_2fa`): for a lost authenticator phone. The user is signed out everywhere
    and must set up 2FA again at next sign-in. The password is not changed.
  * The **Sign-in** column shows 2FA status, "Must change password" and "Locked". Every action is in the activity
    log with your reason.
* **Admin → Master data & rates**: every table (companies, ASF and tax rates, the night-deduction matrix,
  cancellation tiers, the season calendar, properties, letter templates …) has its own form. Pick related records by
  **name** from a searchable list (never type an ID), choose dates with the date picker and tick yes/no boxes; the
  form explains any problem next to the field ("The last day must be on or after the first day."). Lists show names,
  dates as DD-MM-YYYY and amounts in ₹. **Edit** changes a row; **Disable** hides it from new choices while keeping
  it on old records.
  * Rates are **effective-dated**: add a new row from a later date; the previous row is closed automatically and
    the current row is highlighted. ASF amounts cannot be edited (add a new rate). ASF increases above 5% need an
    override reason and the special permission.
  * In the **night-deduction matrix**, "Any" matches every value and the most specific row wins (e.g. "Purchased
    Studio, booked One-Bedroom: 1.5 nights per night").
  * **Letter templates**: edit the wording in the large text box and press **Preview with sample data** to see the
    letter with its letterhead, filled with fictitious sample details. The logo, company name and address are added
    automatically.
  * Administrators also see **Advanced (JSON)** at the bottom of a form, folded away: a fallback for unusual cases.

## Finance
* *Member → Finance*: totals per payment type and currency (GST shown separately), the ASF status per membership
  year, the EMI schedule and the payment ledger.
* **Generate EMI schedule** uses the application's EMI details. If EMI × count ≠ balance, the last instalment is
  adjusted and a warning is shown. Editing an instalment requires a reason.
* **Record payment**: choose the type and method (Cash is disabled), enter the reference, and a PDF receipt is
  produced (with the brand's logo, the payment type by name, e.g. "Down payment", and ₹ amounts). EMI payments are
  applied to the oldest instalments first; any overpayment is kept as credit. For a **booking fee**, upgrade charge
  or additional nights, choose the stay from the **Reservation** list (type its number, resort or month to search).
* **Opening a document** (receipt, notice, voucher) shows "Opening…" until it appears. If it takes too long, use
  **Download**; if it cannot be produced, the message says why (e.g. "PDF engine unavailable": tell your
  administrator). The CRM never issues a plain-text receipt.
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
