import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load .env.local for the integration tests. They talk to a real Supabase
 * instance on purpose — RLS can only be proven by asking the database.
 * Unit tests do not need any of this and skip cleanly when it is absent.
 */
try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No local env — integration suites will skip themselves.
}
