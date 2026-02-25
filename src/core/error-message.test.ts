import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./error-message";

describe("toErrorMessage", () => {
  it("returns fallback for nullish payloads", () => {
    expect(toErrorMessage(null, "fallback")).toBe("fallback");
    expect(toErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("uses plain string payloads", () => {
    expect(toErrorMessage("  connection failed  ", "fallback")).toBe(
      "connection failed",
    );
  });

  it("uses Error.message when available", () => {
    expect(toErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("extracts message arrays from object payloads", () => {
    expect(
      toErrorMessage(
        { message: ["First issue", "Second issue", 123] },
        "fallback",
      ),
    ).toBe("First issue. Second issue");
  });

  it("falls back to error or cause string fields", () => {
    expect(toErrorMessage({ error: "driver failure" }, "fallback")).toBe(
      "driver failure",
    );
    expect(toErrorMessage({ cause: "connection reset" }, "fallback")).toBe(
      "connection reset",
    );
  });
});
