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
