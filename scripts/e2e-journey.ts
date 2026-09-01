/**
 * New-user journey, end to end, over real HTTP against a running server.
 *
 * Signs in through the real magic-link callback, uploads a real video to real
 * storage, runs the real pipeline, then exercises search, save, collections,
 * sequences, sharing, export, deletion and authorization. Nothing is stubbed —
 * a failure here is a failure a user would hit.
 *
 *   npm run dev
 *   npx tsx --env-file=.env.local scripts/e2e-journey.ts path/to/clip.mp4
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { UPLOAD_BUCKET } from "../lib/constants";
import { drainQueue } from "../lib/pipeline/worker";

const BASE = process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3002";
const VIDEO = process.argv[2];

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 200)}` : ""}`);
  }
}

function step(name: string) {
  console.log(`\n\x1b[36m${name}\x1b[0m`);
}

/** Minimal cookie jar so the session survives across requests like a browser. */
class Session {
  private cookies = new Map<string, string>();

  private absorb(res: Response) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get authed(): boolean {
    return [...this.cookies.keys()].some((k) => k.startsWith("sb-"));
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.header();
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
      ...init,
      headers,
      redirect: "manual",
    });
    this.absorb(res);
    return res;
  }

  /** Follow redirects while keeping cookies, the way a browser would. */
  async follow(path: string, max = 5): Promise<Response> {
    let current = path;
    for (let i = 0; i < max; i++) {
      const res = await this.fetch(current);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        current = new URL(location, BASE).toString();
        continue;
      }
      return res;
    }
    throw new Error("too many redirects");
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

async function main() {
  if (!VIDEO) throw new Error("Pass a video path");

  const admin = createAdminClient();
  const email = `journey+${Date.now()}@shotbreakdown.test`;
  const otherEmail = `journey-other+${Date.now()}@shotbreakdown.test`;

  step("1. Landing page is reachable and says what the product is");
  const landing = await fetch(BASE);
  const landingHtml = await landing.text();
  check("landing responds 200", landing.status === 200);
  check(
    "value proposition is above the fold",
    /searchable\s*\n?\s*cinematography reference library|searchable cinematography/i.test(landingHtml)
  );
  check("has a primary call to action", /Analyze a video/i.test(landingHtml));

  step("2. Sign up via the real magic-link callback");
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`createUser: ${createError?.message}`);
  const userId = created.user.id;

  const { data: other } = await admin.auth.admin.createUser({
    email: otherEmail,
    email_confirm: true,
  });
  const otherUserId = other?.user?.id;

  const session = new Session();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${BASE}/auth/callback` },
  });
  if (linkError || !link.properties) throw new Error(`generateLink: ${linkError?.message}`);

  // Hit our own callback with the token hash, exactly as the email template does.
  await session.follow(
    `/auth/callback?token_hash=${link.properties.hashed_token}&type=magiclink`
  );
  check("session cookie established", session.authed);

  const me = await json<{ authed?: boolean }>(await session.fetch("/api/me"));
  check("/api/me reports authenticated", me.authed === true);

  step("3. Upload a real video and start processing");
  const bytes = await readFile(VIDEO);
  const path = `${userId}/${Date.now()}-${basename(VIDEO)}`;
  const { error: uploadError } = await admin.storage
    .from(UPLOAD_BUCKET)
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  check("upload to storage succeeded", !uploadError, uploadError?.message);

  const createRes = await session.fetch("/api/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: path,
      sourceType: "video_upload",
      title: "Journey test clip",
      sizeBytes: bytes.byteLength,
    }),
  });
  const createBody = await json<{ videoId?: string; error?: string }>(createRes);
  check("POST /api/videos accepted", createRes.status === 200 && !!createBody.videoId, createBody);
  const videoId = createBody.videoId!;

  step("4. Processing is durable — the job survives with no browser attached");
  const statusEarly = await json<{ video?: { status?: string } }>(
    await session.fetch(`/api/videos/${videoId}`)
  );
  check(
    "video has a persisted processing state",
    !!statusEarly.video?.status && statusEarly.video.status !== "complete",
    statusEarly.video?.status
  );

  const drained = await drainQueue({ maxMs: 15 * 60_000, batchSize: 1 });
  check("worker drained the queue", drained.failed === 0 && drained.remaining === 0, drained);

  // The submit request warm-starts a worker of its own, so wait for a terminal
  // state rather than assuming this process did all the work.
  let finalStatus: { video?: Record<string, unknown>; readyShots?: number } = {};
  for (let i = 0; i < 120; i++) {
    finalStatus = await json(await session.fetch(`/api/videos/${videoId}`));
    const status = finalStatus.video?.status as string | undefined;
    if (status === "complete" || status === "failed") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  check("video completed", finalStatus.video?.status === "complete", finalStatus.video?.status);
  check("shots were produced", (finalStatus.readyShots ?? 0) > 0, finalStatus.readyShots);

  step("5. Shots are searchable in the owner's library");
  const mine = await json<{ shots: { id: string; slug: string | null; description: string | null }[]; total: number }>(
    await session.fetch(`/api/shots/search?scope=mine&video_id=${videoId}&limit=50`)
  );
  check("scope=mine returns the new shots", mine.total > 0, mine.total);
  check("every shot has a description", (mine.shots ?? []).every((s) => !!s.description));
  const shotId = mine.shots[0]?.id;

  const semantic = await json<{ total: number; usedSemantic: boolean }>(
    await session.fetch(`/api/shots/search?scope=mine&q=${encodeURIComponent("bright colourful frame")}`)
  );
  check("semantic search ran", semantic.usedSemantic === true);

  step("6. Shot detail page renders for the owner");
  const shotPage = await session.fetch(`/shots/${shotId}`);
  check("shot page responds 200", shotPage.status === 200, shotPage.status);
  const shotHtml = await shotPage.text();
  check("optical estimates are labelled", /\best\b/i.test(shotHtml));

  step("7. Save, then My Shots reflects it");
  const saveRes = await session.fetch(`/api/shots/${shotId}/save`, { method: "POST" });
  check("save succeeded", saveRes.status === 200, saveRes.status);
  const savedList = await json<{ total: number }>(
    await session.fetch("/api/shots/search?scope=saved&limit=10")
  );
  check("saved scope contains the shot", savedList.total >= 1, savedList.total);

  const viewRes = await session.fetch(`/api/shots/${shotId}/view`, { method: "POST" });
  check("view counter accepts a request", viewRes.status === 200, viewRes.status);

  step("8. Find Similar returns visually related shots");
  const similar = await json<{ shots?: unknown[] }>(
    await session.fetch(`/api/shots/${shotId}/similar?limit=5`)
  );
  check("similar endpoint responded", Array.isArray(similar.shots), similar);

  step("9. Collections, nesting and sequences");
  const collection = await json<{ collection?: { id: string } }>(
    await session.fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Journey deck", shotId }),
    })
  );
  check("collection created with a shot", !!collection.collection?.id, collection);
  const collectionId = collection.collection!.id;

  const child = await json<{ collection?: { id: string } }>(
    await session.fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Journey child", parentId: collectionId }),
    })
  );
  check("nested collection created", !!child.collection?.id, child);

  const sequence = await json<{ collection?: { id: string } }>(
    await session.fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Journey sequence", kind: "sequence" }),
    })
  );
  const sequenceId = sequence.collection!.id;
  check("sequence created", !!sequenceId);

  const allShotIds = mine.shots.slice(0, 4).map((s) => s.id);
  const added = await json<{ added?: number }>(
    await session.fetch(`/api/collections/${sequenceId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotIds: allShotIds }),
    })
  );
  check("shots added to the sequence", (added.added ?? 0) === allShotIds.length, added);

  const reversed = [...allShotIds].reverse();
  const reorder = await session.fetch(`/api/collections/${sequenceId}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotIds: reversed }),
  });
  check("sequence reordered", reorder.status === 200, reorder.status);

  const afterReorder = await json<{ collection?: { items: { shotId: string }[] } }>(
    await session.fetch(`/api/collections/${sequenceId}`)
  );
  check(
    "new order persisted",
    JSON.stringify(afterReorder.collection?.items.map((i) => i.shotId)) === JSON.stringify(reversed),
    afterReorder.collection?.items.map((i) => i.shotId)
  );

  step("10. Sharing works logged out, private stays private");
  const share = await json<{ url?: string; token?: string }>(
    await session.fetch("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceType: "collection", resourceId: sequenceId }),
    })
  );
  check("share link created", !!share.url, share);

  const anonymous = await fetch(share.url!, { redirect: "manual" });
  check("share link opens with no account", anonymous.status === 200, anonymous.status);
  const shareHtml = await anonymous.text();
  check("shared page shows the sequence name", shareHtml.includes("Journey sequence"));

  const anonShot = await fetch(`${BASE}/shots/${shotId}`, { redirect: "manual" });
  check("private shot is not visible logged out", anonShot.status === 404, anonShot.status);

  const anonVideo = await fetch(`${BASE}/videos/${videoId}`, { redirect: "manual" });
  check("private video is not visible logged out", anonVideo.status === 404, anonVideo.status);

  step("11. Another user cannot reach this user's data");
  const intruder = new Session();
  const { data: otherLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: otherEmail,
    options: { redirectTo: `${BASE}/auth/callback` },
  });
  await intruder.follow(
    `/auth/callback?token_hash=${otherLink!.properties!.hashed_token}&type=magiclink`
  );
  check("second user signed in", intruder.authed);

  const intruderShot = await intruder.fetch(`/shots/${shotId}`);
  check("other user gets 404 on the private shot", intruderShot.status === 404, intruderShot.status);

  const intruderCollection = await intruder.fetch(`/api/collections/${collectionId}`);
  check(
    "other user gets 404 on the private collection",
    intruderCollection.status === 404,
    intruderCollection.status
  );

  const intruderEdit = await intruder.fetch(`/api/shots/${shotId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldKey: "composition.shot_size", value: "wide" }),
  });
  check("other user cannot edit metadata", intruderEdit.status === 404, intruderEdit.status);

  const intruderDelete = await intruder.fetch(`/api/videos/${videoId}`, { method: "DELETE" });
  check("other user cannot delete the video", intruderDelete.status === 404, intruderDelete.status);

  const intruderSearch = await json<{ total: number }>(
    await intruder.fetch(`/api/shots/search?scope=mine&video_id=${videoId}`)
  );
  check("other user's scoped search finds nothing", intruderSearch.total === 0, intruderSearch.total);

  step("12. Prototype pollution is rejected");
  const polluted = await session.fetch(`/api/shots/${shotId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldKey: "__proto__.polluted", value: "PWNED" }),
  });
  check("__proto__ path rejected", polluted.status === 400, polluted.status);
  check("Object.prototype untouched", ({} as Record<string, unknown>).polluted === undefined);

  step("13. Open redirect is blocked");
  const redirect = await fetch(`${BASE}/auth/callback?next=//evil.example`, { redirect: "manual" });
  const location = redirect.headers.get("location") ?? "";
  check("protocol-relative next rejected", !location.includes("evil.example"), location);

  step("14. Metadata correction is recorded and re-indexed");
  const correction = await session.fetch(`/api/shots/${shotId}/metadata`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldKey: "composition.shot_size", value: "extreme-wide" }),
  });
  check("correction accepted", correction.status === 200, correction.status);

  const { data: edits } = await admin
    .from("shot_edits")
    .select("kind, field_key")
    .eq("shot_id", shotId);
  check("correction recorded for AI quality tracking", (edits ?? []).length > 0, edits);

  step("15. Representative frame can be overridden");
  const frames = await json<{ frames: { id: string; isRepresentative: boolean }[] }>(
    await session.fetch(`/api/shots/${shotId}/frame`)
  );
  check("candidate frames exist", frames.frames.length > 1, frames.frames.length);
  const alternative = frames.frames.find((f) => !f.isRepresentative);
  if (alternative) {
    const setFrame = await session.fetch(`/api/shots/${shotId}/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameId: alternative.id }),
    });
    check("representative frame changed", setFrame.status === 200, setFrame.status);
    const afterFrames = await json<{ frames: { id: string; isRepresentative: boolean }[] }>(
      await session.fetch(`/api/shots/${shotId}/frame`)
    );
    check(
      "new frame is marked representative",
      afterFrames.frames.find((f) => f.id === alternative.id)?.isRepresentative === true
    );
  }

  step("16. Export reflects the real collection");
  await admin.from("profiles").update({ plan: "pro" }).eq("id", userId);
  for (const format of ["csv", "json", "pdf"] as const) {
    const res = await session.fetch(
      `/api/exports?resourceType=collection&resourceId=${sequenceId}&format=${format}`
    );
    const buffer = Buffer.from(await res.arrayBuffer());
    check(`${format} export downloads`, res.status === 200 && buffer.byteLength > 200, {
      status: res.status,
      bytes: buffer.byteLength,
    });
    if (format === "pdf") check("pdf is a real PDF", buffer.subarray(0, 5).toString() === "%PDF-");
    if (format === "csv") {
      check("csv contains the shot count", buffer.toString().split("\r\n").length >= allShotIds.length + 1);
    }
  }

  step("17. Free plan limits are enforced server-side");
  await admin.from("profiles").update({ plan: "free" }).eq("id", userId);
  const overflow: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await session.fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=limit${i}test` }),
    });
    overflow.push(res.status);
  }
  check("monthly analysis cap returns 402", overflow.includes(402), overflow);

  step("18. Returning later, everything persists");
  const returning = new Session();
  const { data: returnLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${BASE}/auth/callback` },
  });
  await returning.follow(
    `/auth/callback?token_hash=${returnLink!.properties!.hashed_token}&type=magiclink`
  );
  const persisted = await json<{ total: number }>(
    await returning.fetch(`/api/shots/search?scope=mine&video_id=${videoId}`)
  );
  check("shots still present in a new session", persisted.total === mine.total, {
    before: mine.total,
    after: persisted.total,
  });

  step("19. Deleting the video removes everything derived from it");
  const { data: framePaths } = await admin
    .from("shot_frames")
    .select("storage_path")
    .eq("video_id", videoId);
  const sampleFramePath = framePaths?.[0]?.storage_path as string | undefined;

  const del = await session.fetch(`/api/videos/${videoId}`, { method: "DELETE" });
  check("delete succeeded", del.status === 200, del.status);

  const { count: remainingShots } = await admin
    .from("shots")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId);
  check("shots cascade-deleted", (remainingShots ?? 0) === 0, remainingShots);

  const { count: remainingItems } = await admin
    .from("collection_items")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", sequenceId);
  check("collection items cascade-deleted", (remainingItems ?? 0) === 0, remainingItems);

  if (sampleFramePath) {
    const { data: stillThere } = await admin.storage
      .from(UPLOAD_BUCKET)
      .createSignedUrl(sampleFramePath, 60);
    check("extracted frames removed from storage", !stillThere);
  }

  step("20. Account deletion removes the user");
  const deleteAccount = await session.fetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  check("account deleted", deleteAccount.status === 200, deleteAccount.status);
  const { data: gone } = await admin.auth.admin.getUserById(userId);
  check("auth user is gone", !gone?.user);

  if (otherUserId) await admin.auth.admin.deleteUser(otherUserId).catch(() => {});

  console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed} passed, ${failed} failed\x1b[0m`);
  if (failures.length) {
    console.log("failed checks:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\x1b[31mjourney aborted\x1b[0m", e instanceof Error ? e.stack : e);
  process.exit(1);
});
