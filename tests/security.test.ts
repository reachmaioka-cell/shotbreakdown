import { describe, expect, it } from "vitest";
import { overlayBreakdown, isEditableFieldPath, editableFieldPaths } from "@/lib/overlay";
import { isPrivateAddress, isAllowedOutboundHost, safeRedirectPath } from "@/lib/safe-url";
import { detectLinkSource } from "@/lib/source";

describe("overlayBreakdown — prototype pollution (regression for C-1)", () => {
  it("does not write onto Object.prototype via __proto__", () => {
    const base = { lighting: { key: "soft" } };
    overlayBreakdown(base, { "__proto__.polluted": "PWNED" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not write via constructor.prototype", () => {
    overlayBreakdown({ a: 1 }, { "constructor.prototype.polluted2": "PWNED" });
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
  });

  it("applies a legitimate correction", () => {
    const out = overlayBreakdown({ lighting: { key: "soft" } }, { "lighting.key": "hard" });
    expect((out as { lighting: { key: string } }).lighting.key).toBe("hard");
  });

  it("drops keys that are not in the schema allowlist", () => {
    const out = overlayBreakdown({ a: 1 }, { "bogus.field": "x" });
    expect((out as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("keeps unrelated fields intact", () => {
    const out = overlayBreakdown(
      { lighting: { key: "soft", fill: "bounce" } },
      { "lighting.key": "hard" }
    );
    expect((out as { lighting: { fill: string } }).lighting.fill).toBe("bounce");
  });

  it("returns the original object when there are no edits", () => {
    const base = { a: 1 };
    expect(overlayBreakdown(base, null)).toBe(base);
  });

  it("derives the allowlist from the schema", () => {
    const paths = editableFieldPaths();
    expect(paths.has("composition.shot_size")).toBe(true);
    expect(paths.has("lighting_facets.key_level")).toBe(true);
    expect(paths.has("__proto__")).toBe(false);
  });

  it.each([
    ["__proto__.x", false],
    ["constructor.prototype", false],
    ["composition.shot_size", true],
    ["", false],
    ["a".repeat(300), false],
  ])("isEditableFieldPath(%s) === %s", (path, expected) => {
    expect(isEditableFieldPath(path)).toBe(expected);
  });
});

describe("safeRedirectPath — open redirect (regression for H-5)", () => {
  it.each([
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["/%2fevil.example", "/"],
    [null, "/"],
    ["/library?q=night", "/library?q=night"],
    ["/shots/abc#top", "/shots/abc#top"],
  ])("%s -> %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("isPrivateAddress — SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"])(
    "allows %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    }
  );
});

describe("isAllowedOutboundHost", () => {
  it("matches exact hosts and subdomains", () => {
    expect(isAllowedOutboundHost("i.ytimg.com")).toBe(true);
    expect(isAllowedOutboundHost("youtube.com")).toBe(true);
  });

  it("does not match a lookalike suffix", () => {
    expect(isAllowedOutboundHost("evil-youtube.com")).toBe(false);
    expect(isAllowedOutboundHost("youtube.com.evil.example")).toBe(false);
  });
});

describe("detectLinkSource — hostname matching (regression for H-7)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", "youtube"],
    ["https://youtu.be/abc", "youtube"],
    ["https://m.youtube.com/watch?v=abc", "youtube"],
    ["https://www.tiktok.com/@a/video/1", "tiktok"],
    ["https://www.instagram.com/reel/abc/", "instagram"],
  ])("%s -> %s", (url, expected) => {
    expect(detectLinkSource(url)).toBe(expected);
  });

  it.each([
    "https://evil.example/?ref=youtube.com",
    "https://youtube.com.evil.example/x",
    "javascript:alert(1)//youtube.com",
    "not a url",
    "file:///etc/passwd",
  ])("rejects %s", (url) => {
    expect(detectLinkSource(url)).toBeNull();
  });
});
