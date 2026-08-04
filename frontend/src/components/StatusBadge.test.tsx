import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the status text and a matching CSS class", () => {
    render(<StatusBadge status="ANCHORED" />);
    const badge = screen.getByText("ANCHORED");
    expect(badge).toHaveClass("status-badge", "ANCHORED");
  });
});
