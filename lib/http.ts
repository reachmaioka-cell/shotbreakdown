import { NextResponse } from "next/server";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function isInternalRequest(request: Request): boolean {
  const header =
    request.headers.get("authorization") ??
    request.headers.get("x-internal-secret") ??
    request.headers.get("x-cron-secret") ??
    "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const secrets = [process.env.CRON_SECRET, process.env.INTERNAL_SECRET].filter(
    (s): s is string => !!s
  );
  return secrets.length > 0 && secrets.includes(token);
}


