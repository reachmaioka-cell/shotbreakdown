/**
 * Re-map stored dominant_colors onto the canonical colour families.
 *
 * A pure data transform over metadata that already exists — no AI calls. Run
 * once after adding the canonical vocabulary; new analyses normalise on write.
 */
import { canonicalColors } from "../lib/validation";
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const admin = createAdminClient();
  const { data: shots, error } = await admin
    .from("shots")
    .select("id, metadata")
    .not("metadata->color_facets", "is", null)
    .limit(1000);

  if (error) throw new Error(error.message);

  let updated = 0;
  for (const shot of shots ?? []) {
    const metadata = shot.metadata as Record<string, unknown>;
    const facets = metadata.color_facets as Record<string, unknown> | undefined;
    const current = (facets?.dominant_colors as string[] | undefined) ?? [];
    if (current.length === 0) continue;

    const families = canonicalColors(current);
    if (families.join(",") === current.join(",")) continue;

    const next = {
      ...metadata,
      color_facets: {
        ...facets,
        dominant_colors: families,
        color_names: (facets?.color_names as string[] | undefined) ?? current,
      },
    };

    const { error: updateError } = await admin
      .from("shots")
      .update({ metadata: next })
      .eq("id", shot.id);
    if (updateError) {
      console.error(`  ✗ ${shot.id}: ${updateError.message}`);
      continue;
    }
    updated += 1;
  }

  console.log(`normalised ${updated} shot(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
