import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import { DocLink, SLOW_AFTER_MS } from "./DocLink";

// jsdom has no <dialog> methods
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.restoreAllMocks());

const viewer = () => screen.getByTestId("doc-viewer");

describe("DocLink viewer", () => {
  it("shows a loading state, then the document once it has loaded", async () => {
    let resolve!: (v: { url: string; content_type: string }) => void;
    vi.spyOn(api, "get").mockReturnValue(new Promise((r) => { resolve = r as typeof resolve; }) as never);
    render(<DocLink id="d1" label="Notice PDF" />);
    fireEvent.click(screen.getByRole("button", { name: "Notice PDF" }));
    expect(viewer()).toHaveAttribute("data-state", "fetching");
    expect(screen.getByRole("status")).toHaveTextContent("Opening notice pdf…");

    await act(async () => resolve({ url: "https://blob.example.test/notice.pdf?sig=x", content_type: "application/pdf" }));
    expect(viewer()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status")).toBeInTheDocument(); // still covered until the document reports it loaded
    fireEvent.load(screen.getByTestId("doc-preview"));
    expect(viewer()).toHaveAttribute("data-state", "ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a clear error with Try again when the link cannot be issued", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError({ type: "x", title: "PDF engine unavailable", status: 503, detail: "PDF engine unavailable: the document could not be created.", code: "PdfEngineUnavailable" }),
    );
    render(<DocLink id="d1" label="Receipt" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Receipt" })));
    expect(screen.getByRole("alert")).toHaveTextContent("PDF engine unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByTestId("doc-preview")).not.toBeInTheDocument();
  });

  it("offers Download when the document takes too long to appear", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, "get").mockResolvedValue({ url: "https://blob.example.test/r.pdf?sig=x", content_type: "application/pdf" } as never);
      render(<DocLink id="d1" label="Receipt" />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Receipt" })));
      expect(viewer()).toHaveAttribute("data-state", "loading");
      await act(async () => vi.advanceTimersByTime(SLOW_AFTER_MS + 10));
      expect(viewer()).toHaveAttribute("data-state", "slow");
      expect(screen.getByText("This is taking longer than usual")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Download" }).length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
