import { render, screen } from "@testing-library/react";
import { checklist, type PasswordPolicy, PolicyChecklist, StrengthMeter } from "./PasswordStrength";

const policy: PasswordPolicy = { min_length: 12, max_length: 128, history_count: 5, forbidden_words: ["club8", "k8"], breach_check: true };

describe("password policy checklist", () => {
  const ok = (pw: string, confirm = pw) => Object.fromEntries(checklist(pw, confirm, policy, "priya.demo", "Priya Demo").map((c) => [c.id, c.ok]));

  it("mirrors the server rules: length, personal and company words, confirmation", () => {
    expect(ok("short")).toEqual({ length: false, personal: true, match: true });
    expect(ok("Quiet-Lantern-River-42")).toEqual({ length: true, personal: true, match: true });
    expect(ok("my priya garden 2026").personal).toBe(false);
    expect(ok("Holidays with CLUB8!!").personal).toBe(false);
    expect(ok("we love k8 trips").personal).toBe(false);
    expect(ok("Quiet-Lantern-River-42", "Quiet-Lantern-River-43").match).toBe(false);
  });

  it("states the configured values and the checks done on save", () => {
    render(<PolicyChecklist password="" confirm="" policy={{ ...policy, min_length: 14, history_count: 3 }} username="a.b" fullName="A B" />);
    expect(screen.getByText("At least 14 characters")).toBeInTheDocument();
    expect(screen.getByText(/Not one of your last 3 passwords/)).toBeInTheDocument();
    expect(screen.getByText(/known data breaches/)).toBeInTheDocument();
  });
});

describe("StrengthMeter", () => {
  it("rates a common password weak and a long passphrase strong", async () => {
    const { rerender } = render(<StrengthMeter password="password1" userInputs={[]} />);
    expect(await screen.findByText(/Very weak|Weak/, {}, { timeout: 5000 })).toBeInTheDocument();
    rerender(<StrengthMeter password="Copper-Violin-Meadow-Sunrise-58" userInputs={[]} />);
    expect(await screen.findByText(/Strong|Very strong/, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
