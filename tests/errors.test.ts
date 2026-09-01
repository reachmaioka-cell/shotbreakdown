import { describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/errors";

describe("reportError", () => {
  it("logs and does not throw when SENTRY_DSN is unset", () => {
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reportError(new Error("pipeline boom"), { source: "processing_job" })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    if (prev !== undefined) process.env.SENTRY_DSN = prev;
  });
});
