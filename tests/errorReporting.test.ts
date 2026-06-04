import { describe, it, expect } from "vitest";
import { describeError, FRIENDLY_ERROR } from "../src/web/lib/errorReporting";

describe("describeError", () => {
  it("shows the real wording from a ConvexError (data.message)", () => {
    // Convex puts the intended user message at err.data.message.
    const convexErr = { data: { code: "ALREADY_RUNNING", message: "A scrape is already running." } };
    const r = describeError(convexErr);
    expect(r.expected).toBe(true);
    expect(r.message).toBe("A scrape is already running.");
  });

  it("falls back to the friendly line for a plain Error (redacted in prod)", () => {
    const r = describeError(new Error("Server Error"));
    expect(r.expected).toBe(false);
    expect(r.message).toBe(FRIENDLY_ERROR);
  });

  it("falls back to the friendly line for non-error values", () => {
    expect(describeError(null).message).toBe(FRIENDLY_ERROR);
    expect(describeError("boom").expected).toBe(false);
    expect(describeError(undefined).message).toBe(FRIENDLY_ERROR);
  });

  it("honors a custom fallback", () => {
    const r = describeError(new Error("x"), "Could not load data.");
    expect(r.message).toBe("Could not load data.");
    expect(r.expected).toBe(false);
  });

  it("ignores an empty data.message", () => {
    const r = describeError({ data: { message: "" } });
    expect(r.expected).toBe(false);
    expect(r.message).toBe(FRIENDLY_ERROR);
  });
});
