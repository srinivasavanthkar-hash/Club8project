import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PasswordInput } from "./PasswordInput";
import { Field } from "./ui";

function Form({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Field label="Password" htmlFor="pw" hint="At least 12 characters">
        <PasswordInput id="pw" autoComplete="new-password" />
      </Field>
      <button type="submit">Save</button>
    </form>
  );
}

describe("PasswordInput", () => {
  it("toggles visibility with an accessible button and keeps the value", async () => {
    const submit = vi.fn();
    render(<Form onSubmit={submit} />);
    const input = screen.getByLabelText("Password");
    await userEvent.type(input, "Quiet-Lantern-River-42");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "pw");
    expect(toggle).toHaveAttribute("title", "Show password");
    await userEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("Quiet-Lantern-River-42");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    expect(submit).not.toHaveBeenCalled(); // the toggle never submits the form
  });

  it("returns to hidden after the form is submitted", async () => {
    render(<Form />);
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("returns to hidden when the page is restored from the back/forward cache", async () => {
    render(<Form />);
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    const ev = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(ev, "persisted", { value: true });
    fireEvent(window, ev);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("announces Caps Lock and links the hint to the field", () => {
    render(<Form />);
    const input = screen.getByLabelText("Password");
    fireEvent.keyDown(input, { key: "A", modifierCapsLock: true });
    expect(screen.getByRole("status")).toHaveTextContent("Caps Lock is on");
    expect(input.getAttribute("aria-describedby")).toContain("pw-caps");
    expect(input.getAttribute("aria-describedby")).toContain("pw-hint"); // Field's hint is kept
    fireEvent.blur(input);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
