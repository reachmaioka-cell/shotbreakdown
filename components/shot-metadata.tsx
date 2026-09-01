import Link from "next/link";
import { humanize } from "@/lib/filters";
import type { ShotMetadata } from "@/lib/validation";

type Row = { label: string; value: string | null | undefined; estimated?: boolean; href?: string };

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,6.5rem)_1fr] gap-x-4 gap-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-[12px] leading-5 text-text-2">{row.label}</dt>
          <dd className="text-[13px] leading-5 text-text-0">
            {row.href ? (
              <Link href={row.href} className="hover:text-accent hover:underline">
                {row.value}
              </Link>
            ) : (
              row.value
            )}
            {row.estimated ? (
              <span
                title="Estimated by image analysis, not verified production data"
                className="ml-1.5 align-[1px] rounded-[2px] border border-dashed border-line-strong px-1 text-[9px] uppercase tracking-wider text-text-3"
              >
                est
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Sections show the facets that fit on a line; longer prose observations sit
 * behind a disclosure so the rail scans rather than becoming a wall of text.
 */
function Section({
  title,
  rows,
  note,
  primaryCount = 4,
}: {
  title: string;
  rows: Row[];
  note?: string;
  primaryCount?: number;
}) {
  const visible = rows.filter((r) => r.value && r.value !== "none" && r.value !== "unclear");
  if (visible.length === 0) return null;

  const primary = visible.slice(0, primaryCount);
  const extra = visible.slice(primaryCount);

  return (
    <section className="border-t border-line pt-3">
      <h3 className="eyebrow mb-2">{title}</h3>
      <Rows rows={primary} />
      {extra.length > 0 || note ? (
        <details className="group mt-1.5">
          <summary className="cursor-pointer list-none text-[11px] text-text-2 hover:text-text-0">
            <span className="group-open:hidden">More ({extra.length + (note ? 1 : 0)})</span>
            <span className="hidden group-open:inline">Less</span>
          </summary>
          <div className="mt-1.5">
            {extra.length > 0 ? <Rows rows={extra} /> : null}
            {note ? (
              <p className="mt-2 text-[12px] leading-relaxed text-text-2">{note}</p>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Compact, scannable metadata. Grouped into the sections a filmmaker thinks in,
 * with every optical estimate labelled — the model cannot measure focal length
 * from a frame and must not imply otherwise.
 */
export function ShotMetadataPanel({ metadata }: { metadata: ShotMetadata }) {
  const c = metadata.composition;
  const o = metadata.optics;
  const l = metadata.lighting_facets;
  const col = metadata.color_facets;
  const env = metadata.environment;
  const subj = metadata.subject;
  const mv = metadata.movement_facets;

  const lightingFlags = [
    l?.backlight ? "Backlight" : null,
    l?.rim_light ? "Rim light" : null,
    l?.silhouette ? "Silhouette" : null,
    l?.practicals_visible ? "Practicals in frame" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Camera"
        rows={[
          {
            label: "Movement",
            value: mv?.type ? humanize(mv.type) : metadata.movement?.type,
            href: mv?.type ? `/camera-movements/${mv.type}` : undefined,
          },
          {
            label: "Direction",
            value: mv?.direction && mv.direction !== "none" ? humanize(mv.direction) : null,
          },
          { label: "Speed", value: mv?.speed ? humanize(mv.speed) : null },
          {
            label: "Rig",
            value: metadata.rig_guess
              ? humanize(metadata.rig_guess)
              : metadata.movement?.rig_guess
                ? humanize(metadata.movement.rig_guess)
                : null,
            estimated: true,
          },
        ]}
      />

      <Section
        title="Composition"
        primaryCount={3}
        rows={[
          {
            label: "Shot size",
            value: c?.shot_size ? humanize(c.shot_size) : metadata.shot_type,
          },
          {
            label: "Angle",
            value: c?.camera_angle ? humanize(c.camera_angle) : metadata.camera_angle,
          },
          { label: "Height", value: c?.camera_height ? humanize(c.camera_height) : null },
          { label: "Framing", value: c?.framing },
          { label: "Depth", value: c?.depth },
          // Retired fields, still present on shots analysed before the schema
          // consolidated them.
          { label: "Subject", value: c?.subject_position },
          { label: "Symmetry", value: c?.symmetry },
          { label: "Foreground", value: c?.foreground },
          { label: "Background", value: c?.background },
        ]}
      />

      <Section
        title="Lens"
        primaryCount={4}
        note="Optical values are estimated from the image, not read from metadata."
        rows={[
          { label: "Type", value: o?.lens_type ? humanize(o.lens_type) : metadata.lens, estimated: true },
          {
            label: "Focal length",
            value:
              o?.focal_length_range ??
              (metadata.focal_length_mm_est ? `~${metadata.focal_length_mm_est}mm` : null),
            estimated: true,
          },
          { label: "Aperture", value: metadata.aperture_est, estimated: true },
          {
            label: "Depth of field",
            value: o?.depth_of_field ? humanize(o.depth_of_field) : metadata.depth_of_field,
            estimated: true,
          },
          { label: "Character", value: o?.character },
          { label: "Compression", value: o?.compression },
          { label: "Distortion", value: o?.distortion },
          { label: "Bokeh", value: o?.bokeh },
          { label: "Sensor", value: metadata.sensor_format_guess, estimated: true },
        ]}
      />

      <Section
        title="Lighting"
        primaryCount={6}
        note={metadata.lighting_notes ?? metadata.lighting?.motivation ?? undefined}
        rows={[
          { label: "Quality", value: l?.quality ? humanize(l.quality) : null },
          { label: "Key level", value: l?.key_level ? humanize(l.key_level) : null },
          { label: "Key from", value: l?.key_direction ? humanize(l.key_direction) : null },
          { label: "Source", value: l?.source ? humanize(l.source) : null },
          { label: "Contrast", value: l?.contrast ? humanize(l.contrast) : null },
          {
            label: "Temperature",
            value: l?.color_temperature ? humanize(l.color_temperature) : null,
          },
          { label: "Also", value: lightingFlags.length ? lightingFlags.join(" · ") : null },
          { label: "Key light", value: metadata.lighting?.key },
          { label: "Fill", value: metadata.lighting?.fill },
          { label: "Backlight", value: metadata.lighting?.back },
        ]}
      />

      <Section
        title="Colour"
        note={metadata.color_notes ?? metadata.color?.lut_or_process_guess ?? undefined}
        rows={[
          { label: "Palette", value: col?.palette ?? metadata.color?.look },
          { label: "Saturation", value: col?.saturation ? humanize(col.saturation) : null },
          { label: "Contrast", value: col?.contrast ? humanize(col.contrast) : null },
          { label: "Temperature", value: col?.temperature ? humanize(col.temperature) : null },
        ]}
      />

      {col?.dominant_colors?.length ? (
        <div className="border-t border-line pt-3">
          <h3 className="eyebrow mb-2">Dominant colours</h3>
          <ul className="flex flex-wrap gap-1.5">
            {col.dominant_colors.map((family, i) => (
              <li key={family}>
                <Link
                  href={`/library?colors=${encodeURIComponent(family)}`}
                  className="flex items-center gap-1.5 rounded-[3px] border border-line bg-ink-1 px-1.5 py-1 text-[11px] text-text-1 hover:border-line-strong hover:text-text-0"
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-[2px] border border-white/10"
                    style={{ background: col.hex_colors?.[i] ?? "#333" }}
                  />
                  {humanize(col.color_names?.[i] ?? family)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section
        title="Environment"
        rows={[
          {
            label: "Interior/exterior",
            value: env?.interior_exterior ? humanize(env.interior_exterior) : null,
          },
          { label: "Location", value: env?.location_type },
          {
            label: "Time of day",
            value: env?.time_of_day ? humanize(env.time_of_day) : null,
            href: env?.time_of_day && env.time_of_day !== "unclear" ? `/library?time_of_day=${env.time_of_day}` : undefined,
          },
          { label: "Weather", value: env?.weather },
          { label: "Descriptors", value: env?.descriptors?.map(humanize).join(" · ") },
        ]}
      />

      <Section
        title="Subject"
        note={subj?.description}
        rows={[
          { label: "Type", value: subj?.types?.map(humanize).join(" · ") },
          { label: "Count", value: subj?.count },
        ]}
      />

      {metadata.ai_tools && !/^none/i.test(metadata.ai_tools) ? (
        <Section title="AI / post" rows={[{ label: "AI tools", value: metadata.ai_tools }]} />
      ) : null}
    </div>
  );
}

/** The at-a-glance strip above the fold: three or four facts, no wall of text. */
export function ShotSummaryStrip({ metadata }: { metadata: ShotMetadata }) {
  const items: { label: string; values: string[] }[] = [];

  const mv = metadata.movement_facets;
  if (mv) {
    items.push({
      label: "Camera",
      values: [
        mv.type ? humanize(mv.type) : "",
        mv.speed && mv.speed !== "none" ? humanize(mv.speed) : "",
        metadata.composition?.camera_angle ? humanize(metadata.composition.camera_angle) : "",
      ].filter(Boolean),
    });
  }
  if (metadata.optics) {
    items.push({
      label: "Lens",
      values: [
        metadata.optics.focal_length_range ?? "",
        metadata.optics.depth_of_field ? `${humanize(metadata.optics.depth_of_field)} DOF` : "",
        "Estimated",
      ].filter(Boolean),
    });
  }
  if (metadata.lighting_facets) {
    const l = metadata.lighting_facets;
    items.push({
      label: "Lighting",
      values: [
        `${humanize(l.quality)} key`,
        humanize(l.key_direction) + " direction",
        l.backlight ? "Backlight" : l.rim_light ? "Rim light" : "",
      ].filter(Boolean),
    });
  }
  if (metadata.color_facets) {
    items.push({
      label: "Look",
      values: [
        humanize(metadata.color_facets.temperature),
        humanize(metadata.color_facets.saturation),
        `${humanize(metadata.color_facets.contrast)} contrast`,
      ],
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <p className="eyebrow mb-1.5">{item.label}</p>
          <ul className="flex flex-col gap-0.5">
            {item.values.map((value) => (
              <li
                key={value}
                className={`text-[13px] leading-5 ${
                  value === "Estimated" ? "text-text-3 text-[11px] uppercase tracking-wider" : "text-text-0"
                }`}
              >
                {value}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
