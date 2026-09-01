import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Resolve a user-supplied `next=` parameter to a same-origin path.
 *
 * `startsWith("/")` alone is not enough: "//evil.com" and "/\evil.com" are
 * protocol-relative and browsers resolve them off-site.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/%2f") || next.startsWith("/%5c")) {
    return fallback;
  }
  try {
    // A relative URL resolved against a placeholder origin must stay on it.
    const url = new URL(next, "https://shotbreakdown.invalid");
    if (url.origin !== "https://shotbreakdown.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Hosts the server is allowed to fetch media and metadata from. Exact host or subdomain. */
const OUTBOUND_HOST_ALLOWLIST = [
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "googleusercontent.com",
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
  "noembed.com",
  "wikipedia.org",
  "wikimedia.org",
  "google.serper.dev",
  "api.openai.com",
  "api.anthropic.com",
];

function hostMatches(hostname: string, suffix: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h === suffix || h.endsWith(`.${suffix}`);
}

export function isAllowedOutboundHost(hostname: string, extra: string[] = []): boolean {
  return [...OUTBOUND_HOST_ALLOWLIST, ...extra].some((s) => hostMatches(hostname, s));
}

/** RFC1918 / loopback / link-local / CGNAT / IPv6 ULA — anything not routable on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const p = address.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (kind === 6) {
    const v = address.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return false;
  }
  return true;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("blocked address");
    return;
  }
  // Local dev talks to the Supabase container on 127.0.0.1; the allowlist still applies.
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("unresolvable host");
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error("blocked address");
  }
}

export type SafeFetchOptions = {
  /** Extra hosts allowed for this call (e.g. the configured Supabase host). */
  allowHosts?: string[];
  /** Skip the allowlist but keep private-address and redirect protection. */
  anyPublicHost?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit;
};

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * fetch() with SSRF protection: host allowlist, private-address rejection,
 * per-hop redirect revalidation, a timeout and a response size ceiling.
 * Every server-side outbound request to a user-influenced URL goes through this.
 */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? 3;

  let current = input;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = new URL(current);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
      if (!options.anyPublicHost && !isAllowedOutboundHost(url.hostname, options.allowHosts)) {
        throw new Error(`host not allowed: ${url.hostname}`);
      }
      await assertPublicHost(url.hostname);

      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        current = new URL(location, current).toString();
        continue;
      }

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new Error("response too large");
      return res;
    }
    throw new Error("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

/** safeFetch + a hard cap on bytes actually read. */
export async function safeFetchBuffer(
  input: string,
  options: SafeFetchOptions = {}
): Promise<{ buffer: Buffer; contentType: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const res = await safeFetch(input, options);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const reader = res.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("response too large");
    return { buffer, contentType };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks), contentType };
}
