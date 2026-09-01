import { BreakdownSchema, ShotMetadataSchema } from "@/lib/validation";

/**
 * Segments that would let a dotted edit path walk onto Object.prototype.
 * Blocked defensively even though every path is also allowlisted below.
 */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

type ZodInternals = {
  _zod?: { def?: { type?: string; innerType?: unknown; element?: unknown } };
  shape?: Record<string, unknown>;
};

/** Enumerate every leaf path of a Zod object schema, e.g. "lighting.key". */
function collectPaths(schema: unknown, prefix = "", depth = 0): string[] {
  if (depth > 6 || !schema || typeof schema !== "object") return [];
  const node = schema as ZodInternals;
  const def = node._zod?.def;
  const type = def?.type;

  if (type === "optional" || type === "nullable" || type === "default") {
    return collectPaths(def?.innerType, prefix, depth + 1);
  }

  if (type === "object" && node.shape) {
    const out: string[] = [];
    for (const [key, child] of Object.entries(node.shape)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const nested = collectPaths(child, path, depth + 1);
      // An object leaf is editable at its children; scalars/arrays at themselves.
      out.push(...(nested.length > 0 ? nested : [path]));
    }
    return out;
  }

  return prefix ? [prefix] : [];
}

let cachedPaths: Set<string> | null = null;

/** Every field a user is allowed to correct. Derived from the schema, so it cannot drift. */
export function editableFieldPaths(): Set<string> {
  if (!cachedPaths) {
    cachedPaths = new Set([
      ...collectPaths(BreakdownSchema),
      ...collectPaths(ShotMetadataSchema),
    ]);
  }
  return cachedPaths;
}

export function isEditableFieldPath(key: string): boolean {
  if (!key || key.length > 200) return false;
  const parts = key.split(".");
  if (parts.some((p) => !p || FORBIDDEN_SEGMENTS.has(p))) return false;
  return editableFieldPaths().has(key);
}

/**
 * Merge stored user corrections onto a breakdown.
 * Unknown or unsafe keys are dropped rather than written — historical rows may
 * still carry keys saved before the allowlist existed.
 */
export function overlayBreakdown<T extends object>(
  base: T,
  edits: Record<string, unknown> | null | undefined
): T {
  if (!edits || Object.keys(edits).length === 0) return base;
  const clone = structuredClone(base) as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(edits)) {
    if (!isEditableFieldPath(key)) continue;
    const parts = key.split(".");
    let cur: Record<string, unknown> = clone;
    let ok = true;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!Object.prototype.hasOwnProperty.call(cur, part)) {
        cur[part] = {};
      }
      const next = cur[part];
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        cur[part] = {};
      }
      const child = cur[part];
      if (typeof child !== "object" || child === null) {
        ok = false;
        break;
      }
      cur = child as Record<string, unknown>;
    }

    if (ok) cur[parts[parts.length - 1]] = value;
  }

  return clone as unknown as T;
}

export function getPathValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (FORBIDDEN_SEGMENTS.has(key)) return undefined;
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
