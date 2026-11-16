export type Me = {
  id: string;
  username: string;
  full_name: string;
  roles: string[];
  permissions: string[];
  totp_enabled: boolean;
  /** Forced steps: the API refuses everything else until they are done. */
  must_change_password: boolean;
  must_enroll_totp: boolean;
  password_is_temporary: boolean;
  temp_password_expires_at: string | null;
  password_changed_at: string | null;
};

export type MasterRow = { id: string; code: string; name: string; is_active?: boolean; [k: string]: unknown };

export type Lead = {
  id: string;
  lead_number: string;
  entry_date: string;
  prospect_name: string;
  mobile: string;
  whatsapp: string | null;
  whatsapp_same_as_mobile: boolean;
  email: string | null;
  city: string | null;
  venue_id: string | null;
  opc_name: string | null;
  salesperson_id: string | null;
  follow_up_date: string | null;
  status: string;
  presentation_at: string | null;
  member_id: string | null;
  version: number;
  notes: { id: string; note: string; created_at: string; created_by: string | null }[];
};

export type Kyc = { id: string; id_type: string; masked: string; expiry_date: string | null };
export type Applicant = {
  id: string;
  position: number;
  full_name: string;
  dob: string;
  mobile: string | null;
  email: string | null;
  kyc: Kyc[];
};

export type Member = {
  id: string;
  membership_number: string;
  status: string;
  company_id: string;
  email: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postcode: string | null;
  state: string | null;
  country: string;
  purchase_date: string;
  tenure_years: number;
  first_year_of_use: number;
  last_year_of_use: number;
  resort_category_id: string;
  season_id: string;
  unit_type_id: string;
  nights_per_year: string;
  currency: string;
  purchase_price: string;
  admin_fees: string;
  total_price: string;
  down_payment_amount: string;
  balance: string;
  balance_mode: string;
  emi_amount: string | null;
  emi_count: number | null;
  emi_start_month: number | null;
  emi_start_year: number | null;
  relationship_manager_id: string | null;
  team_manager_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  comments: string | null;
  source_lead_id: string | null;
  opc_name: string | null;
  custom_fields: Record<string, unknown>;
  credit_balance: string;
  version: number;
  applicants: Applicant[];
  joining_offers: { id: string; description: string; nights: string | null }[];
  agreement_signed_applicant1: boolean;
  agreement_signed_applicant2: boolean;
  agreement_signed_company: boolean;
  agreement_signed_date: string | null;
};

export type Payment = {
  id: string;
  payment_type_code: string;
  entry_kind: string;
  base_amount: string;
  gst_rate: string;
  gst_amount: string;
  total_amount: string;
  currency: string;
  payment_date: string;
  receipt_number: string;
  transaction_ref: string | null;
  card_last4: string | null;
  receipt_document_id: string | null;
  asf_year: number | null;
  is_forfeited: boolean;
  remarks: string | null;
  version: number;
};

export type Reservation = {
  id: string;
  reservation_number: string;
  member_id: string;
  status: string;
  check_in: string;
  check_out: string;
  nights: number;
  entitlement_nights: string;
  additional_paid_nights: string;
  deduction_explanation: string;
  confirmation_number: string | null;
  season_code: string;
  resort_category_code: string;
  reschedule_count: number;
  occupancy_type: string;
  adults: number;
  child_ages: number[];
  status_history: { from_status: string | null; to_status: string; changed_at: string; reason_text: string | null; override: boolean }[];
  date_versions: { version_no: number; check_in: string; check_out: string; entitlement_nights: string; reason: string | null }[];
  cancellation: ReservationCancellation | null;
};

/** Facts of a confirmed reservation's cancellation (D-31..D-34). */
export type ReservationCancellation = {
  summary: string;
  cancel_date: string;
  date_source: "REQUEST" | "CONFIRMATION" | "STAFF";
  date_reason: string | null;
  request: { kind: "email" | "document"; label: string; received_on: string } | null;
  reason: string;
  reason_text: string | null;
  credited: string;
  forfeited: string;
  asf_withdrawn: number[];
  letter_document_id: string;
};

export type Quote = {
  stay_nights: number;
  season_code: string | null;
  explanation: string;
  plan: { year: number; kind: string; nights: string }[];
  entitlement_nights: string;
  additional_paid_nights: string;
  asf: { membership_year: number; total: string; currency: string; new: boolean; status?: string; reason?: string }[];
  window_warnings: string[];
  occupancy_problems: string[];
  gift_rent_problems: string[];
  blocking: string[];
};

export type YearView = {
  year: number;
  allocated: string;
  bonus: string;
  saved_in: string;
  used: string;
  used_later: string;
  borrowed_out: string;
  on_hold: string;
  credited_back: string;
  expired: string;
  remaining: string;
};
