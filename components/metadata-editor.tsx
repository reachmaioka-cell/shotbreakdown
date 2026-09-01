"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { humanize } from "@/lib/filters";
import {
  CAMERA_ANGLES,
  CAMERA_HEIGHTS,
  COLOR_TEMPERATURES,
  CONTRASTS,
  DEPTH_OF_FIELDS,
  INTERIOR_EXTERIOR,
  KEY_DIRECTIONS,
  LENS_TYPES,
  LIGHTING_KEYS,
  LIGHTING_QUALITIES,
  LIGHTING_SOURCES,
  MOVEMENT_DIRECTIONS,
  MOVEMENT_SPEEDS,
  MOVEMENT_TYPES,
  SATURATIONS,
  SHOT_SIZES,
  TIMES_OF_DAY,
  type ShotMetadata,
} from "@/lib/validation";

type EnumField = {
  path: string;
  label: string;
  options: readonly string[];
  current: string | undefined;
};

/**
 * Owner-facing correction UI.
 *
 * Only the enum facets and tags are editable here: they are what search and
 * filtering depend on, so a wrong value has real consequences. Free-text prose
 * is left as the model wrote it.
 */
export function MetadataEditor({
  shotId,
  metadata,
  tags,
}: {
  shotId: string;
  metadata: ShotMetadata;
  tags: string[];
}) {
  const router = useRouter();
  const [currentTags, setCurrentTags] = useState(tags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  const fields: EnumField[] = [
    { path: "composition.shot_size", label: "Shot size", options: SHOT_SIZES, current: metadata.composition?.shot_size },
    { path: "composition.camera_angle", label: "Angle", options: CAMERA_ANGLES, current: metadata.composition?.camera_angle },
    { path: "composition.camera_height", label: "Camera height", options: CAMERA_HEIGHTS, current: metadata.composition?.camera_height },
    { path: "movement_facets.type", label: "Movement", options: MOVEMENT_TYPES, current: metadata.movement_facets?.type },
    { path: "movement_facets.direction", label: "Direction", options: MOVEMENT_DIRECTIONS, current: metadata.movement_facets?.direction },
    { path: "movement_facets.speed", label: "Speed", options: MOVEMENT_SPEEDS, current: metadata.movement_facets?.speed },
    { path: "optics.lens_type", label: "Lens", options: LENS_TYPES, current: metadata.optics?.lens_type },
    { path: "optics.depth_of_field", label: "Depth of field", options: DEPTH_OF_FIELDS, current: metadata.optics?.depth_of_field },
    { path: "lighting_facets.quality", label: "Light quality", options: LIGHTING_QUALITIES, current: metadata.lighting_facets?.quality },
    { path: "lighting_facets.key_level", label: "Key level", options: LIGHTING_KEYS, current: metadata.lighting_facets?.key_level },
    { path: "lighting_facets.key_direction", label: "Key direction", options: KEY_DIRECTIONS, current: metadata.lighting_facets?.key_direction },
    { path: "lighting_facets.source", label: "Light source", options: LIGHTING_SOURCES, current: metadata.lighting_facets?.source },
    { path: "lighting_facets.contrast", label: "Contrast", options: CONTRASTS, current: metadata.lighting_facets?.contrast },
    { path: "color_facets.temperature", label: "Colour temperature", options: COLOR_TEMPERATURES, current: metadata.color_facets?.temperature },
    { path: "color_facets.saturation", label: "Saturation", options: SATURATIONS, current: metadata.color_facets?.saturation },
    { path: "environment.interior_exterior", label: "Interior/exterior", options: INTERIOR_EXTERIOR, current: metadata.environment?.interior_exterior },
    { path: "environment.time_of_day", label: "Time of day", options: TIMES_OF_DAY, current: metadata.environment?.time_of_day },
  ].filter((f) => f.current !== undefined);

  async function send(body: Record<string, unknown>, key: string) {
    setSaving(key);
    setError(null);
    try {
      const res = await fetch(`/api/shots/${shotId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; tags?: string[] };
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Could not save");
        return null;
      }
      setSavedField(key);
      setTimeout(() => setSavedField((f) => (f === key ? null : f)), 1600);
      router.refresh();
      return data;
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.path}>
            <label
              htmlFor={`field-${field.path}`}
              className="eyebrow mb-1 flex items-center gap-1.5"
            >
              {field.label}
              {savedField === field.path ? <span className="text-ok normal-case">saved</span> : null}
            </label>
            <select
              id={`field-${field.path}`}
              defaultValue={field.current}
              disabled={saving === field.path}
              onChange={(e) => void send({ fieldKey: field.path, value: e.target.value }, field.path)}
              className="w-full rounded-[3px] border border-line bg-ink-1 px-2 py-1.5 text-[13px] text-text-0 focus:border-line-strong focus:outline-none disabled:opacity-50"
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {humanize(option)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div>
        <p className="eyebrow mb-1.5">Tags</p>
        <ul className="flex flex-wrap gap-1.5">
          {currentTags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                disabled={saving === `tag-${tag}`}
                onClick={async () => {
                  const data = await send({ removeTags: [tag] }, `tag-${tag}`);
                  if (data?.tags) setCurrentTags(data.tags);
                }}
                className="inline-flex items-center gap-1.5 rounded-[3px] border border-line bg-ink-1 px-2 py-1 text-[11px] text-text-1 hover:border-danger/50 hover:text-danger disabled:opacity-50"
                aria-label={`Remove tag ${tag}`}
              >
                {tag}
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
          <li>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const value = newTag.trim();
                if (!value) return;
                const data = await send({ addTags: [value] }, "add-tag");
                if (data?.tags) setCurrentTags(data.tags);
                setNewTag("");
              }}
            >
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add tag"
                aria-label="Add tag"
                className="w-28 rounded-[3px] border border-dashed border-line bg-transparent px-2 py-1 text-[11px] text-text-0 placeholder-text-3 focus:border-line-strong focus:outline-none"
              />
            </form>
          </li>
        </ul>
      </div>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}
