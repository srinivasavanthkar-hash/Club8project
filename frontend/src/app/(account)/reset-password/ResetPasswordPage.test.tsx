import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import ResetPasswordPage from "./page";

const policy = { min_length: 12, max_length: 128, history_count: 5, forbidden_words: ["club8", "k8"], breach_check: true };

describe("Reset password page", () => {
  it("removes the token from the address bar and shows the form for a valid link (with the 2FA field)", async () => {
    window.history.replaceState(null, "", "/reset-password?token=abc123-secret-token");
    let sent: string | undefined;
    server.use(http.post("*/api/v1/auth/reset-password/check", async ({ request }) => {
      sent = ((await request.json()) as { token: string }).token;
      return HttpResponse.json({ valid: true, requires_totp: true, username: "priya.sharma", full_name: "Priya Sharma", policy });
    }));
    render(<ResetPasswordPage />);
    expect(window.location.search).toBe(""); // gone at once, before the check completes
    expect(await screen.findByRole("heading", { name: "Set a new password" })).toBeInTheDocument();
    expect(sent).toBe("abc123-secret-token");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("6-digit code from your authenticator app")).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters")).toBeInTheDocument();
  });

  it("shows one generic message for an invalid or expired link", async () => {
    window.history.replaceState(null, "", "/reset-password?token=expired-token-value");
    server.use(http.post("*/api/v1/auth/reset-password/check", () => HttpResponse.json({ valid: false, requires_totp: false, username: null, full_name: null, policy: null })));
    render(<ResetPasswordPage />);
    expect(await screen.findByRole("heading", { name: "This reset link is invalid or has expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });
});
