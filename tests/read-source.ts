import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A route file with its comments removed.
 *
 * Several assertions in this suite are made against source text, because the
 * thing worth pinning is that a route *calls* a guard at all. Matching raw text
 * would let a commented-out call keep the test green — the exact mutation those
 * assertions exist to catch — so whole-line and block comments come out first.
 * Trailing comments are left alone: they cannot hide a statement.
 */
export function readCode(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
