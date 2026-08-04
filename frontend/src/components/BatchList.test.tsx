import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchList } from "./BatchList";
import type { Batch } from "../types";

function makeBatch(overrides: Partial<Batch>): Batch {
  return {
    id: "b1",
    batchNumber: "BATCH-001",
    product: "Amoxicillin",
    plannedQuantity: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("BatchList", () => {
  it("shows an empty state when there are no batches", () => {
    render(<BatchList batches={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no batches yet/i)).toBeInTheDocument();
  });

  it("pluralizes the record count correctly", () => {
    render(
      <BatchList
        batches={[
          makeBatch({ id: "b1", _count: { records: 1 } }),
          makeBatch({ id: "b2", batchNumber: "BATCH-002", _count: { records: 3 } }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText(/1 record$/)).toBeInTheDocument();
    expect(screen.getByText(/3 records$/)).toBeInTheDocument();
  });

  it("marks the selected batch as active and leaves others unmarked", () => {
    render(
      <BatchList
        batches={[makeBatch({ id: "b1" }), makeBatch({ id: "b2", batchNumber: "BATCH-002" })]}
        selectedId="b2"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("BATCH-002").closest("button")).toHaveClass("active");
    expect(screen.getByText("BATCH-001").closest("button")).not.toHaveClass("active");
  });

  it("calls onSelect with the batch id when clicked", async () => {
    const onSelect = vi.fn();
    render(<BatchList batches={[makeBatch({ id: "b1" })]} selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("BATCH-001"));
    expect(onSelect).toHaveBeenCalledWith("b1");
  });
});
