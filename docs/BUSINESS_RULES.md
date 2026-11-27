# Business rules

Every rule from Sections 5–8 of the brief, with where it is implemented, how it is configured and which test covers it.
Configuration lives in master-data tables (Admin → Master data) or in `system_settings` (Admin → Business-rule
settings). The defaults below are seed values only.

## Settings keys (`system_settings`)
| Key | Default | Meaning |
|---|---|---|
| `booking.min_working_days` | 7 | Earliest check-in = request date + N working days (warning) |
| `booking.max_months` | 12 | Latest check-in = request date + N months (warning) |
| `booking.weekend_days` | `[6]` | Non-working weekdays (Mon = 0 … Sun = 6) |
| `reservation.max_reschedules` | 2 | Reschedules allowed without `reservation.override` |
| `entitlement.save_years` | 2 | Years unused nights can be carried forward |
| `entitlement.borrow_years` | 2 | Future years that can be borrowed from |
| `entitlement.consumption_order` | `["SAVED","CURRENT","BORROWED"]` | Order buckets are consumed in |
| `entitlement.deduction_rounding` | `UP` | Rounding of matrix-multiplied deductions to half nights |
| `asf.charge_unraised_saved_source` | `true` | Charge a never-raised source year's ASF when its saved nights are used |
| `asf.annual_cap_percent` | `5` | ASF revision above this % needs an override reason + permission |
| `asf.withdraw_unpaid_on_cancel` | `true` | Withdraw an unpaid ASF when its only booking is cancelled or declined (D-33); paid ASF is never touched |
| `finance.default_notice_days` | 14 | Default-notice payment window |
| `finance.emi_due_day` | 1 | Day of month EMIs fall due (when no instalment start date is given) |
| `member.require_signed_agreement` | `true` | Signed agreement upload required before approval |
| `member.min_kyc_ids_per_applicant` | 1 | KYC IDs required per applicant |
| `member.min_applicant_age` | 18 | Minimum applicant age |
| `documents.max_upload_mb` | 15 | Upload size limit |
| `documents.allowed_types` | PDF, JPEG, PNG | Allowed content types (checked by magic bytes) |
| `kyc.aadhaar_full_storage` | `false` | Store the full Aadhaar number (off until legal basis is confirmed) |
| `password.min_length` | 12 | Minimum password length (no composition rules) |
| `password.max_length` | 128 | Maximum password length |
| `password.history_count` | 5 | Previous passwords that cannot be reused (besides the current one) |
| `password.forbidden_words` | `["club8","k8"]` | Words a password may not contain (besides the username and name) |
| `password.breach_check` | `true` | Reject passwords found in breach data (HIBP range API, offline list fallback) |
| `password.temp_expiry_hours` | 24 | Lifetime of an unused system-generated temporary password |
| `password.admin_reset_approval_hours` | 24 | Window for a second admin to approve the reset of an ADMIN's password |
| `ui.week_start` | `"MONDAY"` | First day of the week in the calendar of every date field: `MONDAY` or `SUNDAY` (Admin shows a dropdown; other values are refused) |
| `security.require_2fa_roles` | `[]` | Roles that must use two-step verification (enrol at next sign-in). Recommended: `["ADMIN","MANAGEMENT","FINANCE"]` |

## Members (Section 5)
| Rule | Implementation | Config | Tests |
|---|---|---|---|
| Total = price + admin fees; balance = total − down payment (DB check constraints) | `members/domain.price_summary` | — | `test_tenure_and_price` |
| EMI fields required when balance > 0 and mode = EMI; mode NONE only when balance is NIL | `balance_mode_check` | — | `test_balance_mode` |
| Last year of use = first + tenure − 1, override with reason | `last_year_of_use` | — | `test_member_validation_rules` |
| Applicants 18+, ≥1 KYC each; PAN format; Aadhaar Verhoeff + masked; others encrypted | `members/service.py` | `member.*`, `kyc.*` | `test_aadhaar_stored_masked_only`, `test_kyc_masked_and_reveal_logged` |
| Duplicate checks (mobile, email, PAN, name + DOB); hard block on membership number | `members/duplicates.py` | — | `test_duplicate_detection`, `test_membership_number_hard_block`, `test_lead_duplicate_warning_and_override` |
| Statuses `PENDING_APPROVAL → ACTIVE → DEFAULT_NOTICE → TERMINATED`, plus `SUSPENDED`, `EXPIRED` | `core/state_machine.py` | `status_definitions` | `test_member_and_reservation_transitions` |
| Activation blocked unless mandatory fields, down payment and signed agreement are present | `approval_blockers` | `member.require_signed_agreement` | `test_approval_gate`, `test_activation_blockers` |
| Non-cancellable, non-refundable: no refund flow exists | — | — | — |
| Reservations only for `ACTIVE` members | `reservations/service._require_member_active` | — | `test_default_notice_cure_and_termination_rules` |
| Custom fields per product (typed, required, select options), JSONB, searchable, exported | `_validate_custom_fields` | `product_custom_fields` | `test_custom_fields` |
| Lead conversion in one transaction; lead retained and read-only | `convert_lead` | — | `test_conversion_only_from_attended_and_lead_retained`, `test_failed_conversion_rolls_back_everything` |

## Finance (Section 6)
| Rule | Implementation | Config | Tests |
|---|---|---|---|
| EMI schedule from balance / EMI / count / start; final instalment adjusted (with warning) so it sums exactly | `finance/domain.generate_emi_schedule` | `finance.emi_due_day` | `test_emi_*` (incl. Hypothesis property test) |
| Instalment edits versioned with a mandatory reason; warning if the schedule no longer sums to the balance | `edit_instalment` | — | `test_instalment_edit_and_payment_meta_edit_need_reason` |
| Allocation oldest-first or to chosen instalments; partial payments; overpayment → credit | `allocate_payment` | — | `test_allocation_*`, `test_emi_payments_partial_overpay_and_reversal` |
| Instalment status PENDING / PART_PAID / PAID / OVERDUE; nightly overdue job | `instalment_status`, `mark_overdue` | — | `test_instalment_status` |
| **GST on ASF only** (5%, effective-dated tax rate) | `gst_for`; `payment_types.gst_applicable` | `tax_rates (GST_ASF)` | `test_gst_only_where_applicable`, demo |
| **ASF one flat fee per membership year, raised at the first booking that uses that year's nights** | `decide_asf`, `raise_asf_for_booking` | `asf_rates` | `test_asf_raised_once_per_year_at_first_booking`, demo |
| ASF rate = rate effective on the booking date (current, borrowed and saved years) | `decide_asf(rate_on=booking_date)` | `asf_rates.effective_from` | `test_asf_rate_is_rate_on_booking_date` |
| Borrowed year → full ASF of that year raised at booking at the current rate | same | — | `test_asf_borrowed_year_raised_at_current_rate`, `test_borrowing_raises_future_asf_at_current_rate` |
| Saved nights → no repeat charge; a never-raised source year is charged (configurable) | same | `asf.charge_unraised_saved_source` | `test_asf_saved_*` |
| One booking can raise several years; each is a separate line | same | — | `test_asf_multi_year_booking_separate_lines_dedup` |
| No later adjustment after a rate change; GST fixed on the charge | `asf_charges.gst_rate` | — | — |
| ASF revision > 5%/year warns; saving needs override reason + `admin.rates.override_cap` | `asf_rate_cap_check` | `asf.annual_cap_percent` | `test_asf_rate_cap_warning`, `test_asf_rate_cap_warning_and_override` |
| Default notice: overdue EMI → notice PDF (14 days) → `DEFAULT_NOTICE`; paid in full in time → `ACTIVE`; after the deadline → terminate (payments forfeited, liability stays visible) | `issue_default_notice`, `check_default_cure`, `terminate` | `finance.default_notice_days` | `test_default_notice_timeline`, `test_default_notice_cure_and_termination_rules`, `test_termination_after_deadline` |
| Booking-related charges link to a reservation (`requires_reservation`) | `record_payment` | `payment_types.requires_reservation` | — |
| Totals by payment type and currency; currencies never summed together | `totals_by_type_and_currency` | — | `test_totals_never_mix_currencies` |
| Receipt PDF per payment (legal name, brand, GST breakdown); gap-free numbering | `letters.generate("RECEIPT")`, `sequences.receipt_number` | `letter_templates`, `companies.receipt_prefix` | demo |
| Corrections only via reversal/adjustment or versioned metadata edit with reason (`payment.correct`) | `correct_payment`, `edit_payment_metadata` | — | `test_emi_payments_partial_overpay_and_reversal` |
| Cash disabled by default; card numbers never stored (last 4 only) | seed + `PaymentIn` validator + DB check | `payment_methods.is_active` | `test_cash_disabled_and_card_number_never_stored` |

## Reservations (Section 7)
| Rule | Implementation | Config | Tests |
|---|---|---|---|
| Status machine with full history (from, to, user, time, reason, override flag) | `reservation_sm`, `reservation_status_history` | `status_definitions` | `test_member_and_reservation_transitions` |
| `CONFIRMED` needs a confirmation number **and** every linked ASF paid; `reservation.override` + reason bypasses the ASF gate | `confirmation_blockers` | — | demo, `test_confirmation_override_by_permission` |
| `DECLINED`/`CANCELLED` need a reason from master data + free text | `change_status` | `reasons (kind DECLINE/CANCEL)` | `test_decline_releases_hold`, `test_cancellation_tiers_need_written_request` |
| Booking window 7 working days … 12 months → warning + override reason | `booking_window_warnings` | `booking.*`, `holiday_calendar` | `test_booking_window`, `test_booking_window_and_occupancy_overrides` |
| Occupancy per unit type (children ≥ age limit count as adults) → upgrade unit or `UPGRADE_CHARGE` | `check_occupancy` | `unit_types` | `test_occupancy` |
| Gift/Rent: lead guest + a linked member email/call required | `gift_rent_requirements` | — | `test_confirmation_gate_and_gift` |
| Reschedule keeps every date version; max 2 without override | `reschedule`, `check_reschedule_limit` | `reservation.max_reschedules` | `test_reschedule_adjusts_existing_deduction_and_limit` |
| Cancelling a confirmed booking needs a written request; credit tiers > 30 / 15–30 / < 15 days | `cancellation_credit` | `cancellation_tiers` | `test_cancellation_tiers_and_boundaries`, `test_cancellation_tiers_need_written_request` |
| Notice counts from the day the written request was received; a changed date needs a reason, never future or before confirmation (D-32) | `cancellation.terms` | — | `test_notice_counts_from_the_written_request`, `test_uploaded_letter_counts_from_its_upload_day`, `test_request_before_confirmation_counts_from_the_confirmation` |
| Unpaid ASF withdrawn on cancel/decline unless another live booking uses the year; paid ASF untouched; raised again by the next booking (D-33) | `withdraw_unpaid_asf`, `raise_asf_for_booking` | `asf.withdraw_unpaid_on_cancel` | `test_unpaid_asf_withdrawn_on_decline_and_raised_again`, `test_asf_kept_while_another_booking_uses_the_year`, `test_paid_asf_is_never_withdrawn`, `test_setting_off_keeps_unpaid_asf` |
| Confirmed cancellation: letter generated, voucher marked cancelled, nothing sent (D-34) | `cancellation.generate_letter`, `void_vouchers` | `letter_templates` | `test_notice_counts_from_the_written_request`, e2e `cancellation.spec.ts` |
| Nights beyond entitlement → paid `ADDITIONAL_NIGHTS` (not deducted) | `plan_consumption.shortfall` | — | `test_insufficient_entitlement_needs_paid_nights` |
| Season derived from the season calendar (overridable) | `derive_season` | `season_calendar`, `seasons.priority` | `test_stay_and_season` |

## Entitlement (Section 8)
| Rule | Implementation | Config | Tests |
|---|---|---|---|
| Ledger per member per membership year, seeded with nights/year at approval; joining-offer bonus nights as `BONUS` | `seed_member` | — | `test_joining_offer_bonus_nights` |
| Deduction matrix: booked category × season × unit vs purchased → multiplier; most specific rule wins; 1:1 default when the booking matches the purchase; the calculation is shown before submitting | `calculate_deduction`; `/reservations/quote` | `deduction_matrix` | `test_matrix_*` |
| Hold at `REQUESTED`, deduct at `APPROVED`, release on decline, tier credits on cancel | `hold`, `convert_hold_to_deduction`, `release`, `cancel_with_tiers` | — | demo, `test_decline_releases_hold` |
| **One active deduction per reservation**: idempotency keys (unique) + partial unique index + row locks (`FOR UPDATE` on the member's buckets) | `entitlement/service.py`, `uq_active_deduction` | — | demo (approve twice), `test_concurrent_bookings_cannot_double_spend` |
| Reschedule adjusts the existing deduction by the difference | `adjustment_entries`, `reschedule_adjust` | — | `test_reschedule_adjusts_existing_deduction_by_difference` |
| Save up to 2 years; nightly expiry job writes `EXPIRED` (idempotent) | `expiry_entries`, `expire_saved` | `entitlement.save_years` | `test_expiry_after_two_years_idempotent`, `test_saved_nights_expiry_job` |
| Borrow up to 2 future years, never past the last year of use | `eligible_buckets` | `entitlement.borrow_years` | `test_borrow_never_beyond_last_year_and_no_saved_before_first` |
| Consumption order: saved → current → borrowed | `eligible_buckets` | `entitlement.consumption_order` | `test_consumption_oldest_saved_first_then_current_then_borrowed` + property test |
| Member view per year: allocated, bonus, saved-in, used, on hold, credited back, expired, borrowed-out, remaining | `year_views` | — | `test_year_views` |

## Audit (Section 10)
| Rule | Implementation | Tests |
|---|---|---|
| Every create/update/soft-delete captured centrally with field-level old/new values (SQLAlchemy `after_flush`) + semantic events | `audit/service.py` | `test_correction_history_is_versioned`, demo step 8 |
| Append-only: trigger rejects UPDATE/DELETE/TRUNCATE; app role has INSERT/SELECT only | migration `0001` | `test_activity_log_is_append_only_and_verifiable` |
| Hash chain + "verify integrity" | `hashchain.py`, `POST /activity-log/verify` | `test_hash_chain_detects_tampering`, `test_tampering_is_detected` |
| Logins, failed logins, lockout, logout, KYC views, sensitive downloads, exports, permission and rate changes logged | auth, documents, exports, admin services | `test_login_lockout_and_audit`, `test_exports_are_logged`, `test_document_rules` |
