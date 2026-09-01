import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
import { z } from "zod";
import { PreferencesSchema } from "@/lib/validation";

const BodySchema = PreferencesSchema.extend({
  display_name: z.string().max(80).nullable().optional(),
  credit_me: z.boolean().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { display_name, credit_me, ...prefs } = parsed.data;

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: user.id,
      ...prefs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return jsonError(error.message, 500);

  if (display_name !== undefined || credit_me !== undefined) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        ...(display_name !== undefined ? { display_name } : {}),
        ...(credit_me !== undefined ? { credit_me } : {}),
      })
      .eq("id", user.id);
    if (profileError) return jsonError(profileError.message, 500);
  }

  return NextResponse.json({ ok: true });
}
