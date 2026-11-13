import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ids } from "@/test/server";
import { MemberForm, toPayload } from "./MemberForm";

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemberForm submitLabel="Save application" onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("MemberForm", () => {
  it("follows the paper form's section order", async () => {
    renderForm();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1. Purchaser (Member) Details", "2. Membership Details", "3. Payment Details", "4. Joining Offer",
      "5. Sales, Approval & Signatures",
    ]);
  });

  it("calculates total, balance (NIL) and last year live, and shows the ASF rate read-only", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Purchase Price"), "250000");
    await user.clear(screen.getByLabelText("Admin Fees"));
    await user.type(screen.getByLabelText("Admin Fees"), "5000");
    expect(screen.getByLabelText("Total Purchase Price")).toHaveValue("₹2,55,000.00");
    await user.type(screen.getByLabelText("Down Payment"), "255000");
    expect(screen.getByLabelText("Balance")).toHaveValue("NIL");
    const year = new Date().getFullYear();
    expect(screen.getByLabelText("Last Year of Use")).toHaveValue(String(year + 9));
    await waitFor(() => expect(screen.getByRole("option", { name: /T0 = Studio/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Unit Type"), ids.unit);
    await waitFor(() => expect(screen.getByLabelText("Annual Subscription Fee (current rate)")).toHaveValue("₹12,000.00 + GST"));
  });

  it("blocks submit with Indian validation errors and never calls the API", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText("1st Applicant Name"), "Asha Demo");
    await user.type(screen.getByLabelText("D.O.B"), "2015-01-01");
    await user.type(screen.getByLabelText("Mobile (+91)"), "12345");
    await user.type(screen.getByLabelText("ID number"), "BADPAN");
    await user.click(screen.getByRole("button", { name: "Save application" }));
    expect(await screen.findByText("Applicant must be 18 or older")).toBeInTheDocument();
    expect(screen.getByText(/10-digit Indian mobile/)).toBeInTheDocument();
    expect(screen.getByText("PAN must look like AAAAA9999A")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a complete single-applicant application", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText("1st Applicant Name"), "Asha Demo");
    await user.type(screen.getByLabelText("D.O.B"), "1985-05-05");
    await user.type(screen.getByLabelText("Mobile (+91)"), "9845012345");
    await user.type(screen.getByLabelText("ID number"), "ABCDE1234F");
    await user.type(screen.getByLabelText("Address Line 1"), "1 Demo Road");
    await user.type(screen.getByLabelText("City"), "Bengaluru");
    await user.type(screen.getByLabelText("Post Code"), "560001");
    await user.selectOptions(screen.getByLabelText("State"), "Karnataka");
    await user.type(screen.getByLabelText("Email"), "asha@example.com");
    await waitFor(() => expect(screen.getByRole("option", { name: /CLUB8 Holidays/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Company / brand"), ids.company);
    await user.selectOptions(screen.getByLabelText("Category (Membership Type)"), ids.cat);
    await user.selectOptions(screen.getByLabelText("Season"), ids.season);
    await user.selectOptions(screen.getByLabelText("Unit Type"), ids.unit);
    await user.type(screen.getByLabelText("Purchase Price"), "100000");
    await user.type(screen.getByLabelText("Down Payment"), "100000");
    await user.selectOptions(screen.getByLabelText("By (payment method)"), ids.card);
    await user.click(screen.getByRole("button", { name: "Save application" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  }, 20_000); // types a whole application: slower than the 5 s default when the suite runs in parallel

  it("builds the API payload with EMI month/year and the down payment entry", () => {
    const p = toPayload({
      applicant1: { full_name: "A", dob: "1980-01-01", mobile: "9845012345", email: "", kyc: [{ id_type: "PAN", value: "ABCDE1234F" }] },
      has_applicant2: false, address: { line1: "x", city: "y", postcode: "560001", state: "Karnataka", country: "India" },
      email: "a@example.com", company_id: ids.company, membership_number: "", purchase_date: "2026-10-15", tenure_years: 10,
      first_year_of_use: 2026, resort_category_id: ids.cat, season_id: ids.season, unit_type_id: ids.unit, nights_per_year: "7",
      purchase_price: "250000", admin_fees: "5000", down_payment_amount: "55000", down_payment_method_id: ids.card,
      record_down_payment: true, down_payment_ref: "REF1", down_payment_card_last4: "4242", balance_mode: "EMI",
      emi_amount: "20000", emi_count: 10, emi_start: "2026-11", joining_offers: [], agreement_signed_applicant1: true,
      agreement_signed_applicant2: false, agreement_signed_company: true,
    }, "lead-1");
    expect(p.emi_start_year).toBe(2026);
    expect(p.emi_start_month).toBe(11);
    expect(p.down_payment).toEqual({ payment_date: "2026-10-15", transaction_ref: "REF1", card_last4: "4242" });
    expect(p.applicant2).toBeNull();
    expect(p.source_lead_id).toBe("lead-1");
    expect(p.membership_number).toBeNull();
  });
});
