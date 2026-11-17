# Open questions for Club8 Holidays / K8

None of these block delivery. The current default is in brackets and is configurable unless noted.

## Inconsistencies in the sample form and agreement
1. **Membership number prefix.** The form shows `MSMC8-` and the agreement shows `MSMMBL-` for the same member. Which is correct? Does the prefix differ by brand (Club8 vs K8)? *[Prefix per brand in Companies master data; search ignores the prefix. D-02]*
2. **Unit type codes.** Please confirm T0 = Studio (2 adults + 2 children under 10) and T1 = One-Bedroom (4 adults). *[Seeded as stated]*
3. **Seasons.** The agreement offers Red/White tick-boxes but the T&C define Red, White and Blue. Can members buy Blue? *[All three configured]*
4. **Season on the application form.** The application form has no season field; the agreement does. Where should staff capture it? *[Captured in the Membership Details section]*
5. **Tenure arithmetic.** A 10-year tenure starting 2026 with last year 2036 is 11 years if counted inclusively. Is the last year inclusive? *[Last year = start + tenure − 1, editable with a reason. D-05]*
6. **EMI start date.** "Starting From" is pre-printed with 2022. Are the forms being reprinted? *[Month and year are captured freely]*
7. **ASF on saved nights from an unbooked year.** If nothing was booked in a year and its nights are carried forward, should that year's ASF be charged at the current rate when the saved nights are first used? *[Yes. Setting `asf.charge_unraised_saved_source`]*

## Rules that need client data
8. **Night-deduction matrix** (category × season × unit type) when a member books outside their purchased tier. *[Default 1:1 when the booking matches the purchase. Any other combination is blocked until a matrix rule exists. Demo rules are labelled DEMO]*
9. **Cancellation tier boundaries** (exactly 15 or 30 days) and **rounding** of 50% credits on odd nights. *[Exactly 15 or 30 days → 50%; round down to the half night. D-11, D-12]*
10. **Season calendar** (which dates are Red/White/Blue) and the **working-day/holiday calendar**. *[Demo calendar only]*
11. **Rates** for upgrade charges, additional nights and booking fees, and any **late-payment penalty**. *[Entered per payment; no automatic penalty]*
12. **K8 forms.** If the K8 application form or agreement differs from Club8's, extra fields can be added per product without code changes. *[Custom-fields mechanism ready]*

## Policy and setup
13. **Aadhaar and cash.** The CRM stores a masked Aadhaar number and masked copy only, unless the company confirms a legal basis and Aadhaar Data Vault compliance for full storage. The agreement prohibits cash, so Cash is disabled; please confirm. *[Masked only; Cash disabled]*
14. **Mailbox sync.** Is direct mailbox synchronisation required, and with which provider (Microsoft 365 or Google Workspace)? *[Manual capture plus .eml/.msg import; `EmailIngestionPort` extension point]*
15. **Final roles.** Who may approve members, correct payments, issue default notices, terminate memberships, override reservation rules, delete documents and view full KYC? *[Seed roles in `auth/permissions.py`; editable in Admin]*
16. **Hosting and numbering.** Does Club8 already have an Azure subscription / Microsoft 365 tenant? Please confirm the backup retention (35-day PITR + weekly dumps kept 7 years) and whether receipt numbers are per company or shared. *[Per company, per calendar year. D-23]*
17. **Microsoft sign-in.** Should staff sign in with Microsoft Entra ID single sign-on instead of CRM passwords? *[CRM username/password + optional TOTP. `users.external_subject` is reserved for Entra OIDC; roles stay in the CRM]*
18. **New: multi-room bookings.** Should each room consume entitlement nights? *[Yes. D-15]*
19. **New: cancelling an approved but unconfirmed booking.** Should it credit back 100%? *[Yes; tiers apply to confirmed bookings only. D-13]*
20. **New: ASF part-payments.** Should ASF be payable in instalments? *[No: one payment per membership year. D-14]*

## Brand (added 19-10-2026, docs/BRAND_PROMPT.md)
21. **Vector, reversed and re-trimmed logos.** Please supply SVG (or PDF/AI/EPS) versions of both logos, plus **white/reversed** versions for dark backgrounds. The supplied files work in the app and print at about 480–500 dpi at 45 mm, but they can't sit on dark surfaces. The K8 PNG also carries about 420px of empty transparent space below the artwork; a tightly trimmed file would help. *[PNG files used as supplied; K8 padding framed in CSS]*
22. **Official app icons.** Are the provisional icons acceptable (the orange "8" for Club8, the K8 monogram for K8), or do you have official icons? The K8 icon's small text is unreadable at favicon size. *[Provisional icons in use]*
23. **K8 legal entity.** Is Klub Eight Asia Ventures a separate legal entity from Multiple Sales and Marketing LLP? Please provide its registered name, address and GST details for receipts and notices. *[Shown as "Klub Eight Asia Ventures" with a "pending confirmation" flag. K8 receipts are blocked in production until it is confirmed]*
24. **Default brand for the CRM shell.** Club8 (current default), K8, or a neutral "Club8 & K8 CRM" identity showing both? *[Club8; switchable with `NEXT_PUBLIC_DEFAULT_BRAND`]*
25. **Brand fonts.** Do you have brand typefaces? The app keeps Inter for readability either way; brand fonts could be used on the login page and PDF headings only. *[Inter]*
26. **Brand approach.** One app theme (the default brand), each record showing its own brand as a small chip, and documents fully branded by the record's company: please confirm. *[As described; DESIGN_DECISIONS "Brand"]*

## Passwords and account access (added 13-11-2026, docs/PASSWORD_PROMPT.md)
27. **Who is the designated super-admin?** When fewer than two other active administrators exist, nobody can approve the reset of an administrator's password, so one named person may reset it directly (logged and flagged). Who should that be? It is set in configuration (`CRM_SUPER_ADMIN_USERNAME`), never in the app. *[Not set: no fallback until it is]*
28. **Staff email addresses.** Do all staff have a company email address? If many don't (e.g. field OPCs), should self-service reset also support a one-time code by SMS to the registered mobile? *[Email only (Phase 2); admin temporary password for everyone else]*
29. **Sending domain.** Which domain should system emails come from, and who can add the SPF/DKIM/DMARC DNS records for it? *[Needed for Phase 2]*
30. **Mandatory 2FA.** Should two-step verification be mandatory for ADMIN, MANAGEMENT and FINANCE (or other roles) rather than optional? The switch is built: Admin → Users & roles → "Two-step verification policy" (setting `security.require_2fa_roles`); users in the chosen roles set up 2FA at their next sign-in. *[Off by default; ADMIN, MANAGEMENT and FINANCE marked "Recommended". Club8 to decide]*

## Cancelling a confirmed reservation (added 16-11-2026)
31. **Unpaid ASF on cancellation.** When a booking is cancelled (or declined) and its ASF is still unpaid, is it correct to withdraw that ASF, provided no other booking uses that membership year? A paid ASF is never refunded. *[Withdrawn, logged with a reason; a later booking in that year raises it again. Setting `asf.withdraw_unpaid_on_cancel`, on. D-33]*
32. **Start of the notice period.** Should the notice period count from the date the member's written request was received (rather than the day staff process it)? *[Yes: the email's date or the letter's upload date, shown on screen; staff can change it with a reason, never to a future date or before the confirmation. D-32]*
33. **Booking fees on cancellation.** If a paid booking fee exists (e.g. for additional paid nights or an upgrade), is it refunded, kept, or kept as a credit for a later stay? *[Kept; there is no automatic refund]*
