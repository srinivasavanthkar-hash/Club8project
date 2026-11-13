import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { server } from "@/test/server";
import { LoginForm } from "./LoginForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams("next=/members") }));

const renderLogin = () =>
  render(<QueryClientProvider client={new QueryClient()}><LoginForm /></QueryClientProvider>);

describe("LoginForm", () => {
  beforeEach(() => replace.mockReset());

  it("shows the server's error for bad credentials", async () => {
    server.use(http.post("*/api/v1/auth/login", () => HttpResponse.json(
      { title: "Unauthorized", status: 401, detail: "Invalid username or password", code: "InvalidCredentials" }, { status: 401 })));
    renderLogin();
    await userEvent.type(screen.getByLabelText("Username"), "demo.sales");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password");
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks for a 2FA code when required, then redirects to ?next", async () => {
    let calls = 0;
    server.use(http.post("*/api/v1/auth/login", async ({ request }) => {
      calls++;
      const body = (await request.json()) as { totp_code?: string };
      if (!body.totp_code) return HttpResponse.json({ title: "Unauthorized", status: 401, detail: "Two-factor code required", code: "TotpRequired" }, { status: 401 });
      return HttpResponse.json({ id: "u1" });
    }));
    renderLogin();
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.type(await screen.findByLabelText("Two-factor code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/members"));
    expect(calls).toBe(2);
  });

  it("goes to the forced change-password step after a temporary password (after the 2FA step)", async () => {
    server.use(http.post("*/api/v1/auth/login", () => HttpResponse.json({ id: "u1", must_change_password: true, must_enroll_totp: false })));
    renderLogin();
    await userEvent.type(screen.getByLabelText("Username"), "demo.team");
    await userEvent.type(screen.getByLabelText("Password"), "Temp-orary-pass-word");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("/change-password"));
  });

  it("uses the shared password field with a show/hide toggle", () => {
    renderLogin();
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
  });

  it("validates required fields client-side", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Username is required")).toBeInTheDocument();
  });
});
