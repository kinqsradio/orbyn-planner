import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SyncLine, type SyncStatus } from "./SyncLine";

const cases: [SyncStatus, string][] = [
  [{ kind: "synced", devices: 2 }, "Synced · 2 devices"],
  [{ kind: "syncing" }, "Syncing"],
  [{ kind: "offline", waiting: 3 }, "Offline · 3 changes waiting"],
  [{ kind: "error" }, "Couldn’t sync ·"],
];

describe("SyncLine", () => {
  it.each(cases)("renders %j", (status, text) => {
    render(<SyncLine status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    const retry = screen.queryByRole("button", { name: "Retry" });
    if (status.kind === "error") expect(retry).toBeInTheDocument();
    else expect(retry).not.toBeInTheDocument();
  });

  it("calls onRetry", async () => {
    const onRetry = vi.fn();
    render(<SyncLine status={{ kind: "error" }} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
