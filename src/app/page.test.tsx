import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("identifies the J-AXON frontend foundation", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "J-AXON" }),
    ).toBeDefined();
  });
});
