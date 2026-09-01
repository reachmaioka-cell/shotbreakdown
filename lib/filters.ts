import {
  CAMERA_ANGLES,
  COLOR_FAMILIES,
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
  MOODS,
  MOVEMENT_SPEEDS,
  MOVEMENT_TYPES,
  SATURATIONS,
  SHOT_SIZES,
  SUBJECT_TYPES,
  TIMES_OF_DAY,
} from "@/lib/validation";

export type FilterGroup = {
  key: string;
  label: string;
  /** Fixed vocabulary, or null when values come from the data (tags, colours). */
  options: readonly string[] | null;
  /** Groups beyond the first few live behind "More filters". */
  primary: boolean;
};

/*
 * Every facet the database can filter on stays available; `primary` only
 * decides what the rail shows before "More filters".
 *
 * Six primary groups is a deliberate ceiling. Eight groups rendered ~62 chips
 * against 39 frames, which inverts the point of a visual library — the rail
 * competed with the images instead of narrowing them. These six are the axes a
 * filmmaker actually reaches for first.
 */
export const FILTER_GROUPS: FilterGroup[] = [
  { key: "shot_size", label: "Shot size", options: SHOT_SIZES, primary: true },
  { key: "movement_type", label: "Camera movement", options: MOVEMENT_TYPES, primary: true },
  { key: "lens_type", label: "Lens", options: LENS_TYPES, primary: true },
  { key: "lighting_key", label: "Lighting", options: LIGHTING_KEYS, primary: true },
  { key: "colors", label: "Colour", options: COLOR_FAMILIES, primary: true },
  { key: "moods", label: "Mood", options: MOODS, primary: true },
  { key: "camera_angle", label: "Angle", options: CAMERA_ANGLES, primary: false },
  { key: "time_of_day", label: "Time of day", options: TIMES_OF_DAY, primary: false },
  { key: "subject_types", label: "Subject", options: SUBJECT_TYPES, primary: false },
  { key: "depth_of_field", label: "Depth of field", options: DEPTH_OF_FIELDS, primary: false },
  { key: "movement_speed", label: "Movement speed", options: MOVEMENT_SPEEDS, primary: false },
  { key: "camera_height", label: "Camera height", options: CAMERA_HEIGHTS, primary: false },
  { key: "lighting_quality", label: "Light quality", options: LIGHTING_QUALITIES, primary: false },
  { key: "key_direction", label: "Key direction", options: KEY_DIRECTIONS, primary: false },
  { key: "lighting_source", label: "Light source", options: LIGHTING_SOURCES, primary: false },
  { key: "color_temperature", label: "Colour temperature", options: COLOR_TEMPERATURES, primary: false },
  { key: "saturation", label: "Saturation", options: SATURATIONS, primary: false },
  { key: "interior_exterior", label: "Interior / exterior", options: INTERIOR_EXTERIOR, primary: false },
  { key: "aspect_ratio", label: "Aspect ratio", options: null, primary: false },
  { key: "source_type", label: "Source", options: null, primary: false },
  { key: "tags", label: "Tags", options: null, primary: false },
];

/** Label for a filter key, for chips rendered outside the rail. */
export function filterLabel(key: string): string {
  return FILTER_GROUPS.find((g) => g.key === key)?.label ?? humanize(key);
}

export const FILTER_KEYS = FILTER_GROUPS.map((g) => g.key);

export const CONTRAST_OPTIONS = CONTRASTS;

/** "medium-close-up" -> "Medium close up". Values are stored kebab-case. */
export function humanize(value: string): string {
  const cleaned = value.replace(/[-_]/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Read active filters out of URL search params. */
export function filtersFromParams(params: URLSearchParams): Record<string, string[]> {
  const active: Record<string, string[]> = {};
  for (const key of FILTER_KEYS) {
    const values = params.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
    if (values.length > 0) active[key] = values;
  }
  return active;
}

export function countActiveFilters(active: Record<string, string[]>): number {
  return Object.values(active).reduce((sum, values) => sum + values.length, 0);
}
