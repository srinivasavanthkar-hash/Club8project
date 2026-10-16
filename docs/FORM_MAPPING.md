# Form mapping (living document)

Maps every field on the approved **Membership Application Form** and **Membership Agreement** to the CRM.
The screen (`frontend/src/components/MemberForm.tsx`) follows the same section order as the paper form.
API: `POST /api/v1/members` or `POST /api/v1/leads/{id}/convert` (schema `MemberIn`). Storage: tables `members`,
`member_applicants`, `applicant_kyc`, `joining_offers`.

| # | Form section | Form field | API field | DB column | Rules |
|---|---|---|---|---|---|
| 1 | Purchaser (Member) Details | 1st Applicant Name / Purchaser 1 | `applicant1.full_name` | `member_applicants.full_name` (position 1) | Required |
| 1 | | D.O.B (1st) | `applicant1.dob` | `member_applicants.dob` | Required; 18+ (`member.min_applicant_age`) |
| 1 | | 2nd Applicant Name / Purchaser 2 | `applicant2.full_name` | `member_applicants` (position 2) | Optional |
| 1 | | D.O.B (2nd) | `applicant2.dob` | `member_applicants.dob` | Required if applicant 2 present; 18+ |
| 1 | | Address Line 1 / 2 | `address.line1` / `address.line2` | `members.address_line1/2` | Line 1 required |
| 1 | | City | `address.city` | `members.city` | Required |
| 1 | | Post Code | `address.postcode` | `members.postcode` | 6-digit PIN when country = India |
| 1 | | State | `address.state` | `members.state` | Dropdown of states/UTs for India; free text otherwise |
| 1 | | Country | `address.country` | `members.country` | Default India |
| 1 | | Mobile 1st Applicant (+91) | `applicant1.mobile` | `member_applicants.mobile` | Required; stored normalised (10 digits or +CC…) |
| 1 | | Mobile 2nd Applicant (+91) | `applicant2.mobile` | `member_applicants.mobile` | Optional |
| 1 | | Email | `email` (+ optional `applicantN.email`) | `members.email` | Required, lower-cased |
| 1 | KYC Details | Aadhaar Card | `applicantN.kyc[] {id_type: AADHAAR}` | `applicant_kyc.masked` | Verhoeff-validated, then masked (`XXXX-XXXX-1234`); masked copy only |
| 1 | | Driver's Licence | `{id_type: DL}` | `applicant_kyc.value_encrypted` | Envelope-encrypted; masked in UI |
| 1 | | Passport (+ expiry) | `{id_type: PASSPORT, expiry_date}` | `value_encrypted`, `expiry_date` | Encrypted; expiry required |
| 1 | | Voter ID | `{id_type: VOTER_ID}` | `value_encrypted` | Encrypted |
| 1 | | PAN Card No | `{id_type: PAN}` | `value_encrypted`, `lookup_hash` | `AAAAA9999A`; encrypted; HMAC hash for duplicate checks |
| 1 | | (per applicant) | | | At least `member.min_kyc_ids_per_applicant` IDs (default 1). Each ID can link a document (`document_id`) |
| 2 | Membership Details | Membership Number (prefix + number) | `company_id` + `membership_number` (digits) | `members.membership_number`, `membership_seq` | Prefix from the company; unique; auto-assigned if blank |
| 2 | | Purchase Date | `purchase_date` | `members.purchase_date` | Required |
| 2 | | Tenure (Years) | `tenure_years` | `members.tenure_years` | Required |
| 2 | | Start Year / First Year of Use | `first_year_of_use` | `members.first_year_of_use` | Required |
| 2 | | Last Year / Last Year of Use | `last_year_of_use` (+ `last_year_override_reason`) | `members.last_year_of_use` | Calculated (D-05); override needs a reason |
| 2 | | Category: Classic / Premium / Supreme | `resort_category_id` | `members.resort_category_id` | Master data |
| 2 | | Season: Red / White (agreement) | `season_id` | `members.season_id` | Master data (Red/White/Blue) |
| 2 | | Unit Type: T0 / T1 = Studio / One-Bedroom | `unit_type_id` | `members.unit_type_id` | Master data with occupancy rule |
| 2 | | No. of Nights per Year | `nights_per_year` | `members.nights_per_year` | > 0; half nights allowed; seeds the entitlement ledger at approval |
| 2 | | Annual Subscription Fee + GST | (read-only) | `asf_rates` | Shows the current rate for the unit type; charged per year at first booking |
| 3 | Payment Details | Purchase Price | `purchase_price` | `members.purchase_price` | ≥ 0 |
| 3 | | Admin Fees | `admin_fees` | `members.admin_fees` | ≥ 0 |
| 3 | | Total Purchase Price | (calculated) | `members.total_price` | DB check: total = price + fees |
| 3 | | Down Payment / "By:" | `down_payment_amount`, `down_payment_method_id`, `down_payment{…}` | `members.down_payment_amount`, `payments` row | Creates a `DOWN_PAYMENT` Finance entry + receipt when `down_payment` is sent |
| 3 | | Balance | (calculated) | `members.balance` | DB check: balance = total − down; shown as "NIL" when 0 |
| 3 | | Balance Mode / Method | `balance_mode` | `members.balance_mode` | NONE / EMI / OTHER |
| 3 | | EMI Amount, No. of EMIs, Starting From (MM/YYYY), Instalment Start Date | `emi_amount`, `emi_count`, `emi_start_month/year`, `instalment_start_date` | `members.emi_*` | Required when balance > 0 and mode = EMI; used to generate the schedule |
| 4 | Joining Offer | Free-text offer lines | `joining_offers[] {offer_type_id, description, nights, value, valid_until, credit_year}` | `joining_offers` | Bonus nights are credited as `BONUS` ledger entries at approval |
| 5 | Sales | Relationship Manager | `relationship_manager_id` | `members.relationship_manager_id` | Staff user (pre-filled from the lead's salesperson) |
| 5 | | Team Manager | `team_manager_id` | `members.team_manager_id` | Staff user |
| 5 | Approval | Approved By / date | (approval action) | `members.approved_by`, `approved_at` | `POST /members/{id}/approve` (`member.approve`) |
| 5 | | Comments | `comments` | `members.comments` | |
| 5 | Signatures (agreement) | 1st / 2nd Applicant, on behalf of the Company, date | `agreement_signed_applicant1/2`, `agreement_signed_company`, `agreement_signed_date` | same | A signed agreement document is required before activation (`member.require_signed_agreement`) |
| — | Company | "Multiple Sales and Marketing LLP", promoter of "CLUB8 Holidays" | `company_id` | `companies.legal_name`, `brand`, `registered_address` | Printed on receipts and notices |
| — | From the lead | Lead, OPC, venue | (conversion) | `members.source_lead_id`, `opc_name`, `venue_id` | Read-only on the member |
| — | Future/K8 fields | any | `custom_fields{}` | `members.custom_fields` (JSONB, GIN index) | Defined per product in Admin → Custom fields; searchable (`?custom_field=key=value`) and exported (`cf_*` columns) |
