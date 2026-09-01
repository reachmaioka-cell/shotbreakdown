const DB_NAME = "shotbreakdown";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type PendingLink = { kind: "link"; url: string };
export type PendingFileMeta = { kind: "file"; name: string; type: string };

export function savePendingLink(url: string) {
  sessionStorage.setItem("pendingSubmit", JSON.stringify({ kind: "link", url } satisfies PendingLink));
}

export function readPendingLink(): PendingLink | null {
  const raw = sessionStorage.getItem("pendingSubmit");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingLink;
    if (parsed.kind === "link" && parsed.url) return parsed;
  } catch {
    return null;
  }
  return null;
}

export function clearPendingLink() {
  sessionStorage.removeItem("pendingSubmit");
}

export async function savePendingFile(file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, "file");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  sessionStorage.setItem("pendingFile", JSON.stringify({ kind: "file", name: file.name, type: file.type }));
}

export async function readPendingFile(): Promise<File | null> {
  if (!sessionStorage.getItem("pendingFile")) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("file");
    req.onsuccess = () => resolve((req.result as File | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingFile() {
  sessionStorage.removeItem("pendingFile");
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("file");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export function hasPendingSubmit(): boolean {
  return typeof window !== "undefined" && (!!sessionStorage.getItem("pendingSubmit") || !!sessionStorage.getItem("pendingFile"));
}
