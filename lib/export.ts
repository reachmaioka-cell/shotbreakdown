import { getCollection, type CollectionItem } from "@/lib/collections";
import { humanize } from "@/lib/filters";
import { formatDuration, formatTimecode, getShot, searchShots } from "@/lib/shots";
import { fetchAnalysisImage } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  readSegmentBreakdown,
  type ShotMetadata,
  type StoredSegmentBreakdown,
} from "@/lib/validation";

export type ExportFormat = "pdf" | "csv" | "json";
export type ExportResourceType = "collection" | "video" | "shot";

export type ExportRow = {
  position: number;
  shotId: string;
  title: string;
  description: string;
  whyItWorks: string;
  note: string;
  videoTitle: string;
  timecode: string;
  duration: string;
  shotSize: string;
  cameraAngle: string;
  cameraHeight: string;
  movement: string;
  movementDirection: string;
  movementSpeed: string;
  lensType: string;
  focalLength: string;
  depthOfField: string;
  lightingQuality: string;
  lightingKey: string;
  keyDirection: string;
  lightingSource: string;
  colorTemperature: string;
  saturation: string;
  palette: string;
  dominantColors: string;
  interiorExterior: string;
  locationType: string;
  timeOfDay: string;
  subjects: string;
  moods: string;
  tags: string;
  url: string;
  thumbnailUrl: string | null;
};

export type ExportPayload = {
  title: string;
  subtitle: string;
  kind: string;
  rows: ExportRow[];
  /**
   * A segment export carries its breakdown. The rows describe the shots; the
   * breakdown is the answer, and exporting the shots without it would ship the
   * evidence and drop the conclusion.
   */
  breakdown?: StoredSegmentBreakdown | null;
};

function metaRow(
  metadata: ShotMetadata | null,
  base: {
    position: number;
    shotId: string;
    title: string;
    note: string;
    videoTitle: string;
    startSeconds: number;
    durationSeconds: number;
    tags: string[];
    url: string;
    thumbnailUrl: string | null;
  }
): ExportRow {
  const m = metadata;
  return {
    position: base.position,
    shotId: base.shotId,
    title: base.title,
    description: m?.description ?? m?.one_line_summary ?? "",
    whyItWorks: m?.why_it_works ?? "",
    note: base.note,
    videoTitle: base.videoTitle,
    timecode: base.durationSeconds > 0 ? formatTimecode(base.startSeconds) : "",
    duration: base.durationSeconds > 0 ? formatDuration(base.durationSeconds) : "",
    shotSize: m?.composition?.shot_size ?? "",
    cameraAngle: m?.composition?.camera_angle ?? "",
    cameraHeight: m?.composition?.camera_height ?? "",
    movement: m?.movement_facets?.type ?? "",
    movementDirection: m?.movement_facets?.direction ?? "",
    movementSpeed: m?.movement_facets?.speed ?? "",
    lensType: m?.optics?.lens_type ?? "",
    focalLength: m?.optics?.focal_length_range ?? "",
    depthOfField: m?.optics?.depth_of_field ?? "",
    lightingQuality: m?.lighting_facets?.quality ?? "",
    lightingKey: m?.lighting_facets?.key_level ?? "",
    keyDirection: m?.lighting_facets?.key_direction ?? "",
    lightingSource: m?.lighting_facets?.source ?? "",
    colorTemperature: m?.color_facets?.temperature ?? "",
    saturation: m?.color_facets?.saturation ?? "",
    palette: m?.color_facets?.palette ?? "",
    dominantColors: (m?.color_facets?.dominant_colors ?? []).join("; "),
    interiorExterior: m?.environment?.interior_exterior ?? "",
    locationType: m?.environment?.location_type ?? "",
    timeOfDay: m?.environment?.time_of_day ?? "",
    subjects: (m?.subject?.types ?? []).join("; "),
    moods: (m?.mood ?? []).join("; "),
    tags: base.tags.join("; "),
    url: base.url,
    thumbnailUrl: base.thumbnailUrl,
  };
}

/**
 * Gather exactly what the resource contains, with the caller's authorization
 * already applied — an export must never widen access.
 */
export async function buildExportPayload(
  resourceType: ExportResourceType,
  resourceId: string,
  viewerId: string | null,
  origin: string
): Promise<ExportPayload | null> {
  if (resourceType === "collection") {
    const collection = await getCollection({ id: resourceId }, viewerId);
    if (!collection) return null;

    const rows = await Promise.all(
      collection.items.map(async (item: CollectionItem, index) => {
        const shot = await getShot(item.shotId, viewerId);
        return metaRow(shot?.metadata ?? null, {
          position: index + 1,
          shotId: item.shotId,
          title: item.summary ?? item.title ?? `Shot ${index + 1}`,
          note: item.note ?? "",
          videoTitle: item.videoTitle ?? "",
          startSeconds: item.startSeconds,
          durationSeconds: item.durationSeconds,
          tags: shot?.tags ?? [],
          url: `${origin}/shots/${item.slug ?? item.shotId}`,
          thumbnailUrl: item.thumbnailUrl,
        });
      })
    );

    return {
      title: collection.name,
      subtitle:
        collection.description ??
        `${collection.itemCount} shot${collection.itemCount === 1 ? "" : "s"}`,
      kind: collection.kind,
      rows,
    };
  }

  if (resourceType === "video") {
    const result = await searchShots({
      filters: { video_id: resourceId },
      limit: 96,
      viewerId,
      scope: viewerId ? "mine" : "public",
    });
    if (result.shots.length === 0) return null;

    const rows = await Promise.all(
      [...result.shots]
        .sort((a, b) => a.shotIndex - b.shotIndex)
        .map(async (shot, index) => {
          const detail = await getShot(shot.id, viewerId);
          return metaRow(detail?.metadata ?? null, {
            position: index + 1,
            shotId: shot.id,
            title: shot.summary ?? shot.title ?? `Shot ${index + 1}`,
            note: "",
            videoTitle: shot.videoTitle ?? "",
            startSeconds: shot.startSeconds,
            durationSeconds: shot.durationSeconds,
            tags: shot.tags,
            url: `${origin}/shots/${shot.slug ?? shot.id}`,
            thumbnailUrl: shot.thumbnailUrl,
          });
        })
    );

    const admin = createAdminClient();
    const { data: videoRow } = await admin
      .from("videos")
      .select("title, breakdown, focus")
      .eq("id", resourceId)
      .maybeSingle();
    const breakdown = readSegmentBreakdown(videoRow?.breakdown);

    return {
      title: (videoRow?.title as string | null) ?? result.shots[0].videoTitle ?? "Segment",
      subtitle: breakdown
        ? breakdown.title
        : `${rows.length} shot${rows.length === 1 ? "" : "s"} in this segment`,
      kind: "video",
      rows,
      breakdown,
    };
  }

  const shot = await getShot(resourceId, viewerId);
  if (!shot) return null;
  return {
    title: shot.metadata?.one_line_summary ?? shot.title ?? "Shot",
    subtitle: shot.video?.title ?? "",
    kind: "shot",
    rows: [
      metaRow(shot.metadata, {
        position: 1,
        shotId: shot.id,
        title: shot.title ?? "Shot",
        note: "",
        videoTitle: shot.video?.title ?? "",
        startSeconds: shot.startSeconds,
        durationSeconds: shot.durationSeconds,
        tags: shot.tags,
        url: `${origin}/shots/${shot.slug ?? shot.id}`,
        thumbnailUrl: shot.thumbnailUrl,
      }),
    ],
  };
}

const CSV_COLUMNS: (keyof ExportRow)[] = [
  "position", "title", "description", "whyItWorks", "note", "videoTitle", "timecode", "duration",
  "shotSize", "cameraAngle", "cameraHeight", "movement", "movementDirection", "movementSpeed",
  "lensType", "focalLength", "depthOfField", "lightingQuality", "lightingKey", "keyDirection",
  "lightingSource", "colorTemperature", "saturation", "palette", "dominantColors",
  "interiorExterior", "locationType", "timeOfDay", "subjects", "moods", "tags", "url",
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Guard against spreadsheet formula injection from user-supplied text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(payload: ExportPayload): string {
  const header = CSV_COLUMNS.map((c) => csvCell(humanize(String(c)))).join(",");
  const lines = payload.rows.map((row) => CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}

export function toJson(payload: ExportPayload): string {
  return JSON.stringify(
    {
      title: payload.title,
      subtitle: payload.subtitle,
      kind: payload.kind,
      exportedAt: new Date().toISOString(),
      shotCount: payload.rows.length,
      breakdown: payload.breakdown ?? undefined,
      // Thumbnail URLs are short-lived signed links; they do not belong in an
      // exported file that outlives them.
      shots: payload.rows.map((row) => {
        const rest: Record<string, unknown> = { ...row };
        delete rest.thumbnailUrl;
        return rest;
      }),
    },
    null,
    2
  );
}

/* ------------------------------------------------------------------ *
 * PDF contact sheet.
 *
 * Written directly rather than pulling in a PDF library: the document is a
 * fixed grid of JPEGs plus Helvetica text, which the PDF format supports
 * natively. Keeps the function bundle small and has no runtime dependency.
 * ------------------------------------------------------------------ */

const PAGE_W = 842; // A4 landscape, points
const PAGE_H = 595;
const MARGIN = 32;
const COLS = 3;
const ROWS = 2;

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Latin-1 only; the PDF core fonts cannot encode anything else. */
function sanitize(text: string, max: number): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .slice(0, max);
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines.slice(0, maxLines);
}

type JpegInfo = { data: Buffer; width: number; height: number };

/** Read intrinsic dimensions from the JPEG SOF marker. */
function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export async function toPdf(payload: ExportPayload): Promise<Buffer> {
  const images = new Map<number, JpegInfo>();

  await Promise.all(
    payload.rows.map(async (row, index) => {
      if (!row.thumbnailUrl) return;
      try {
        const { buffer, contentType } = await fetchAnalysisImage(row.thumbnailUrl);
        if (!contentType.includes("jpeg") && !contentType.includes("jpg")) return;
        const size = jpegSize(buffer);
        if (!size || !size.width || !size.height) return;
        images.set(index, { data: buffer, width: size.width, height: size.height });
      } catch {
        // A missing thumbnail degrades to a text-only cell rather than failing.
      }
    })
  );

  const perPage = COLS * ROWS;
  const pageCount = Math.max(1, Math.ceil(payload.rows.length / perPage));

  const objects: Buffer[] = [];
  const addObject = (content: Buffer | string): number => {
    objects.push(typeof content === "string" ? Buffer.from(content, "latin1") : content);
    return objects.length; // 1-indexed object numbers
  };

  // 1 catalog, 2 pages, 3 font — reserved up front so page objects can point at them.
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const imageIds = new Map<number, number>();
  for (const [index, info] of images) {
    const header = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${info.data.length} >>\nstream\n`,
      "latin1"
    );
    const footer = Buffer.from("\nendstream", "latin1");
    imageIds.set(index, addObject(Buffer.concat([header, info.data, footer])));
  }

  const pageIds: number[] = [];
  const cellW = (PAGE_W - MARGIN * 2) / COLS;
  const cellH = (PAGE_H - MARGIN * 2 - 40) / ROWS;
  const imgH = cellH - 46;

  for (let page = 0; page < pageCount; page++) {
    const rows = payload.rows.slice(page * perPage, (page + 1) * perPage);
    const parts: string[] = [];

    parts.push("BT /F2 13 Tf 0.96 0.96 0.96 rg");
    parts.push(`1 0 0 1 ${MARGIN} ${PAGE_H - MARGIN - 4} Tm (${pdfEscape(sanitize(payload.title, 80))}) Tj ET`);
    parts.push("BT /F1 8 Tf 0.55 0.55 0.58 rg");
    parts.push(
      `1 0 0 1 ${MARGIN} ${PAGE_H - MARGIN - 17} Tm (${pdfEscape(
        sanitize(`${payload.subtitle} | ShotBreakdown | page ${page + 1} of ${pageCount}`, 120)
      )}) Tj ET`
    );

    rows.forEach((row, i) => {
      const globalIndex = page * perPage + i;
      const col = i % COLS;
      const rowIdx = Math.floor(i / COLS);
      const x = MARGIN + col * cellW;
      const yTop = PAGE_H - MARGIN - 40 - rowIdx * cellH;

      const image = images.get(globalIndex);
      const imageId = imageIds.get(globalIndex);
      const boxW = cellW - 10;

      if (image && imageId) {
        const scale = Math.min(boxW / image.width, imgH / image.height);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const drawX = x + (boxW - drawW) / 2;
        const drawY = yTop - drawH;
        parts.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm /Im${globalIndex} Do Q`);
      } else {
        parts.push(`0.11 0.11 0.13 rg ${x} ${(yTop - imgH).toFixed(2)} ${boxW} ${imgH} re f`);
      }

      let textY = yTop - imgH - 11;
      parts.push("BT /F2 7.5 Tf 0.96 0.96 0.96 rg");
      parts.push(
        `1 0 0 1 ${x} ${textY.toFixed(2)} Tm (${pdfEscape(
          sanitize(`${String(row.position).padStart(2, "0")}  ${row.title}`, 64)
        )}) Tj ET`
      );

      textY -= 10;
      const facets = [row.shotSize, row.movement, row.lightingKey, row.timeOfDay]
        .filter((v) => v && v !== "unclear")
        .map(humanize)
        .join("  |  ");
      if (facets) {
        parts.push("BT /F1 6.5 Tf 0.62 0.62 0.66 rg");
        parts.push(`1 0 0 1 ${x} ${textY.toFixed(2)} Tm (${pdfEscape(sanitize(facets, 70))}) Tj ET`);
        textY -= 9;
      }

      const body = row.note || row.description;
      if (body) {
        parts.push("BT /F1 6.5 Tf 0.72 0.72 0.76 rg");
        for (const line of wrap(sanitize(body, 200), 62, 2)) {
          parts.push(`1 0 0 1 ${x} ${textY.toFixed(2)} Tm (${pdfEscape(line)}) Tj ET`);
          parts.push("BT /F1 6.5 Tf 0.72 0.72 0.76 rg");
          textY -= 8;
        }
        parts.push("ET");
      }
    });

    parts.push("BT /F1 6 Tf 0.4 0.4 0.44 rg");
    parts.push(
      `1 0 0 1 ${MARGIN} ${MARGIN - 14} Tm (${pdfEscape(
        "Camera, lens and lighting values are AI estimates from image analysis, not verified production data."
      )}) Tj ET`
    );

    const content = `0.024 0.024 0.027 rg 0 0 ${PAGE_W} ${PAGE_H} re f\n${parts.join("\n")}\n`;
    const contentId = addObject(
      Buffer.concat([
        Buffer.from(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n`, "latin1"),
        Buffer.from(content, "latin1"),
        Buffer.from("\nendstream", "latin1"),
      ])
    );

    const xobjects = rows
      .map((_, i) => {
        const globalIndex = page * perPage + i;
        const id = imageIds.get(globalIndex);
        return id ? `/Im${globalIndex} ${id} 0 R` : null;
      })
      .filter(Boolean)
      .join(" ");

    pageIds.push(
      addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> /XObject << ${xobjects} >> >> ` +
          `/Contents ${contentId} 0 R >>`
      )
    );
  }

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "latin1"
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let position = chunks[0].length;

  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}
