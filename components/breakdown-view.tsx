import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import type { Breakdown } from "@/lib/validation";
import { ClipPreview } from "@/components/clip-preview";
import { Row } from "@/components/row";

export type FieldRowProps = {
  label: string;
  value: string;
  confidence?: number;
  fieldKey: string;
  submissionId: string;
};

function Field(props: FieldRowProps & { RowEl: ComponentType<FieldRowProps> }) {
  const Comp = props.RowEl;
  return (
    <Comp
      label={props.label}
      value={props.value}
      confidence={props.confidence}
      fieldKey={props.fieldKey}
      submissionId={props.submissionId}
    />
  );
}

export function BreakdownView({
  id,
  title,
  platform,
  frames,
  sourceUrl,
  breakdown,
  RowEl = Row,
  details,
}: {
  id: string;
  title: string | null;
  platform?: string | null;
  frames: string[];
  sourceUrl?: string | null;
  breakdown: Breakdown;
  RowEl?: ComponentType<FieldRowProps>;
  details?: ReactNode;
}) {
  const hero = frames[0] ?? null;
  const extras = frames.slice(1);

  return (
    <div className="flex flex-col gap-8">
      {hero || sourceUrl ? (
        <ClipPreview
          sourceUrl={sourceUrl}
          thumbnailUrl={hero}
          alt={title ?? ""}
          sizes="(max-width: 768px) 100vw, 768px"
          className="aspect-video w-full rounded-md"
          priority
        />
      ) : null}
      {extras.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          {extras.map((src) => (
            <div key={src} className="relative h-28 w-44 shrink-0 rounded-md overflow-hidden bg-zinc-900">
              <Image src={src} alt="" fill className="object-cover" sizes="176px" unoptimized={src.includes("token=")} />
            </div>
          ))}
        </div>
      ) : null}

      <div>
        {platform ? <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">{platform}</p> : null}
        <h1 className="text-lg font-medium">{title || "Shot breakdown"}</h1>
        <p className="text-zinc-400 text-sm mt-2">{breakdown.one_line_summary}</p>
        {breakdown.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2 mt-4">
            {breakdown.tags.map((tag) => (
              <li key={tag}>
                <a href={`/tags/${tag}`} className="bg-zinc-800 text-zinc-300 text-xs px-3 py-1.5 rounded-full hover:bg-zinc-700">
                  {tag}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Recreate it</h2>
        <ol className="flex flex-col gap-3 mb-6">
          {breakdown.recreation_steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-zinc-300">
              <span className="text-zinc-600 shrink-0 w-5">{i + 1}.</span>
              <span>{step.replace(/^Step \d+:\s*/i, "")}</span>
            </li>
          ))}
        </ol>
        <div className="grid sm:grid-cols-2 gap-4">
          <Budget title="Under $500" items={breakdown.budget_recreation.under_500_usd} />
          <Budget title="Under $5,000" items={breakdown.budget_recreation.under_5000_usd} />
        </div>
      </section>

      <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Camera</h2>
        <Field RowEl={RowEl} submissionId={id} fieldKey="movement.type" label="Move" value={breakdown.movement.type} confidence={breakdown.movement.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="movement.rig_guess" label="Rig" value={breakdown.movement.rig_guess} confidence={breakdown.movement.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lens" label="Lens" value={breakdown.lens} confidence={breakdown.lens_confidence} />
        <Field
          RowEl={RowEl}
          submissionId={id}
          fieldKey="focal_length_mm_est"
          label="Focal length"
          value={breakdown.focal_length_mm_est ? `${breakdown.focal_length_mm_est}mm FF eq.` : "—"}
          confidence={breakdown.lens_confidence}
        />
        <Field RowEl={RowEl} submissionId={id} fieldKey="depth_of_field" label="DoF" value={breakdown.depth_of_field} confidence={breakdown.depth_of_field_confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="camera_angle" label="Angle" value={breakdown.camera_angle} confidence={breakdown.camera_angle_confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="shot_type" label="Shot" value={breakdown.shot_type} confidence={breakdown.shot_type_confidence} />
      </section>

      <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Light</h2>
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.key" label="Key" value={breakdown.lighting.key} confidence={breakdown.lighting.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.fill" label="Fill" value={breakdown.lighting.fill} confidence={breakdown.lighting.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.back" label="Back" value={breakdown.lighting.back} confidence={breakdown.lighting.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.practicals" label="Practicals" value={breakdown.lighting.practicals} confidence={breakdown.lighting.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.ratio_est" label="Ratio" value={breakdown.lighting.ratio_est} confidence={breakdown.lighting.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="lighting.motivation" label="Motivation" value={breakdown.lighting.motivation} confidence={breakdown.lighting.confidence} />
      </section>

      <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Color</h2>
        <Field RowEl={RowEl} submissionId={id} fieldKey="color.look" label="Look" value={breakdown.color.look} confidence={breakdown.color.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="color.contrast" label="Contrast" value={breakdown.color.contrast} confidence={breakdown.color.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="color.saturation" label="Saturation" value={breakdown.color.saturation} confidence={breakdown.color.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="color.notable_hues" label="Hues" value={breakdown.color.notable_hues.join(", ")} confidence={breakdown.color.confidence} />
        <Field RowEl={RowEl} submissionId={id} fieldKey="color.lut_or_process_guess" label="Process" value={breakdown.color.lut_or_process_guess} confidence={breakdown.color.confidence} />
      </section>

      {breakdown.vfx.length > 0 ? (
        <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">VFX</h2>
          <ul className="flex flex-wrap gap-2">
            {breakdown.vfx.map((v) => (
              <li key={v} className="bg-zinc-800 text-zinc-300 text-xs px-3 py-1.5 rounded-full">
                {v}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {breakdown.post_production &&
      (breakdown.post_production.editing ||
        breakdown.post_production.color_grade ||
        breakdown.post_production.vfx ||
        breakdown.post_production.ai_tools) ? (
        <section className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">Post</h2>
          {breakdown.post_production.editing ? (
            <Field RowEl={RowEl} submissionId={id} fieldKey="post_production.editing" label="Editing" value={breakdown.post_production.editing} />
          ) : null}
          {breakdown.post_production.color_grade ? (
            <Field RowEl={RowEl} submissionId={id} fieldKey="post_production.color_grade" label="Grade" value={breakdown.post_production.color_grade} />
          ) : null}
          {breakdown.post_production.vfx ? (
            <Field RowEl={RowEl} submissionId={id} fieldKey="post_production.vfx" label="VFX finish" value={breakdown.post_production.vfx} />
          ) : null}
          {breakdown.post_production.ai_tools ? (
            <Field RowEl={RowEl} submissionId={id} fieldKey="post_production.ai_tools" label="AI tools" value={breakdown.post_production.ai_tools} />
          ) : null}
        </section>
      ) : null}

      {details ?? <DetailsBlock notes={breakdown.notes} mistakes={breakdown.common_mistakes} />}
    </div>
  );
}

export function DetailsBlock({ notes, mistakes }: { notes: string; mistakes: string[] }) {
  return (
    <details className="bg-zinc-950 border border-zinc-800 rounded-md p-6">
      <summary className="text-xs font-semibold uppercase tracking-widest text-zinc-500 cursor-pointer">Details</summary>
      <div className="mt-4">
        {notes ? <p className="text-sm text-zinc-400 mb-4">{notes}</p> : null}
        {mistakes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {mistakes.map((m) => (
              <li key={m} className="text-sm text-zinc-300">
                {m}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function Budget({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs text-zinc-500 mb-2">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="text-sm text-zinc-300">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
