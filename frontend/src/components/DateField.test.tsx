import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { DateField } from "./DateField";
import { Field } from "./ui";

function Harness({ initial = "", onValue = vi.fn(), min, max, weekStart }: {
  initial?: string; onValue?: (v: string) => void; min?: string; max?: string; weekStart?: "MONDAY" | "SUNDAY";
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <Field label="Check-in" htmlFor="ci" hint="Day the stay starts">
        <DateField id="ci" value={v} min={min} max={max} weekStart={weekStart} onChange={(x) => { setV(x); onValue(x); }} />
      </Field>
      <output data-testid="value">{v}</output>
    </>
  );
}

describe("DateField", () => {
  it("shows an ISO value as DD-MM-YYYY and keeps Field's description", () => {
    render(<Harness initial="2027-03-05" />);
    const input = screen.getByLabelText("Check-in");
    expect(input).toHaveValue("05-03-2027");
    expect(input).toHaveAttribute("aria-describedby", "ci-hint");
    expect(input).toHaveAttribute("placeholder", "DD-MM-YYYY");
  });

  it("typed DD-MM-YYYY becomes an ISO value", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.type(screen.getByLabelText("Check-in"), "05032027");
    expect(screen.getByLabelText("Check-in")).toHaveValue("05-03-2027");
    expect(screen.getByTestId("value")).toHaveTextContent("2027-03-05");
  });

  it("an impossible date is reported and passed on as no date", async () => {
    render(<Harness initial="2027-03-05" />);
    const input = screen.getByLabelText("Check-in");
    await userEvent.clear(input);
    await userEvent.type(input, "31-02-2027");
    fireEvent.blur(input);
    expect(screen.getByText("Enter a date as DD-MM-YYYY, e.g. 05-03-2027.")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("ci-date-error");
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("refuses a typed date outside the allowed range", async () => {
    render(<Harness min="2027-03-10" />);
    await userEvent.type(screen.getByLabelText("Check-in"), "05-03-2027");
    expect(screen.getByText("Choose a date on or after 10-03-2027.")).toBeVisible();
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });

  it("picks a date from the calendar with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2027-03-05" />);
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    const grid = screen.getByRole("grid", { name: "March 2027" });
    expect(grid).toBeVisible();
    expect(screen.getByRole("button", { name: "Friday 5 March 2027" })).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(screen.getByRole("button", { name: "Saturday 13 March 2027" })).toHaveFocus();
    await user.keyboard("{PageDown}");
    expect(screen.getByRole("grid", { name: "April 2027" })).toBeVisible();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Check-in")).toHaveValue("13-04-2027");
    expect(screen.getByTestId("value")).toHaveTextContent("2027-04-13");
    expect(screen.getByRole("button", { name: "Choose date" })).toHaveFocus();
  });

  it("Escape closes the calendar without changing the date", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2027-03-05" />);
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    await user.keyboard("{ArrowRight}{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("value")).toHaveTextContent("2027-03-05");
  });

  it("dates outside the range cannot be picked", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2027-03-10" min="2027-03-10" />);
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    expect(screen.getByRole("button", { name: "Tuesday 9 March 2027" })).toBeDisabled();
  });

  it("the week starts on Monday or Sunday", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness initial="2027-03-05" weekStart="MONDAY" />);
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    expect(screen.getAllByRole("columnheader")[0]).toHaveAttribute("abbr", "Monday");
    unmount();
    render(<Harness initial="2027-03-05" weekStart="SUNDAY" />);
    await user.click(screen.getByRole("button", { name: "Choose date" }));
    expect(screen.getAllByRole("columnheader")[0]).toHaveAttribute("abbr", "Sunday");
  });

  it("follows a new value set from outside, but not while typing", async () => {
    function Outside() {
      const [v, setV] = useState("2027-03-05");
      return (
        <>
          <DateField id="d" aria-label="Date" value={v} onChange={setV} />
          <button type="button" onClick={() => setV("2027-12-25")}>Reset</button>
        </>
      );
    }
    render(<Outside />);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Date")).toHaveValue("25-12-2027");
    await act(async () => { await userEvent.clear(screen.getByLabelText("Date")); });
    await userEvent.type(screen.getByLabelText("Date"), "01-0");
    expect(screen.getByLabelText("Date")).toHaveValue("01-0");
  });
});
