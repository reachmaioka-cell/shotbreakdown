import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { z } from "zod";

const SignalSchema = z.object({ card: z.enum(["recreate", "camera", "light", "color", "details"]) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: true });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const parsed = SignalSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { error } = await supabase.rpc("record_preference_signal", { p_card: parsed.data.card });
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
