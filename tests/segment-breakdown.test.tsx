import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  DEPARTMENTS,
  SEGMENT_BREAKDOWN_VERSION,
  readSegmentBreakdown,
  type StoredSegmentBreakdown,
} from "@/lib/validation";

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: (props: Record<string, unknown>) =>
      React.createElement("img", { src: String(props.src ?? ""), alt: String(props.alt ?? "") }),
  };
});

import {
  SegmentBreakdown,
  breakdownToMarkdown,
  type SegmentBreakdownShot,
} from "@/components/segment/segment-breakdown";

/*
 * The renderer is a pure function of the stored document, so react-dom/server
 * is enough to pin the two things the v3 consolidation promised: a legacy row
 * never puts the old document back on screen, and a document is shown once,
 * in order, with nothing for a single shot that the read already said.
 */

function v3(overrides: Partial<StoredSegmentBreakdown> = {}): StoredSegmentBreakdown {
  return {
    title: "Paulista median, still man in moving traffic",
    what_happens: "A man stands still on a bike-lane median while traffic smears past.",
    focus_answer: "",
    technique: {
      name: "Still subject amid blurred traffic: long-exposure stills sequenced into video",
      evidence: "Background pedestrians jump between frames; smears are smooth inside each.",
      routes: [
        {
          name: "In camera: long-exposure stills sequenced",
          when: "You can lock the subject still.",
          steps: ["Lock off on sticks, 1/4s at f/11.", "Cut the stills on a 24fps timeline."],
          gives_up: "The subject cannot move.",
        },
        {
          name: "In post: optical-flow time remap of normal video",
          when: "You only have video.",
          steps: ["Speed 800% with Optical Flow.", "Mask the subject at 100%."],
          gives_up: "Warping on vehicle edges.",
        },
      ],
    },
    shot_sequence: [
      {
        shot_index: 0,
        timecode: "0:00-0:07",
        what_happens: "He stands; the traffic streaks.",
        how_it_was_made: "MFS, eye level, static, ~28mm, midday sun.",
        cut_note: "",
      },
    ],
    departments: DEPARTMENTS.map((role) => ({
      role,
      headline: `${role} headline.`,
      steps: role === "camera" ? ["Lock off on sticks."] : [],
      pitfalls: role === "camera" ? ["Wind shake."] : [],
    })),
    difficulty: "easy",
    crew: "2: operator, one performer.",
    kit: { minimum: "A phone on a tripod.", full: "Mirrorless, 24mm, sticks, remote." },
    version: SEGMENT_BREAKDOWN_VERSION,
    prompt_version: "segment-v3",
    focus: null,
    generated_at: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

function shotsFor(n: number): SegmentBreakdownShot[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    shotIndex: i,
    thumbnailUrl: null,
    timecode: `0:0${i * 2}`,
  }));
}

function render(breakdown: StoredSegmentBreakdown, n = breakdown.shot_sequence.length) {
  return renderToString(<SegmentBreakdown breakdown={breakdown} shots={shotsFor(n)} openRole={null} />);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("SegmentBreakdown, a single-shot v3 row", () => {
  const html = render(v3());

  it("leads with the read and the technique, and shows the used route open", () => {
    expect(html.indexOf('id="what-happens"')).toBeLessThan(html.indexOf('id="how-it-was-made"'));
    expect(html.indexOf('id="how-it-was-made"')).toBeLessThan(html.indexOf('id="departments"'));
    expect(html).toContain("Still subject amid blurred traffic");
    expect(html).toContain("Lock off on sticks, 1/4s at f/11.");
  });

  it("keeps the other route shut but present, with its steps in the DOM", () => {
    expect(html).toContain("In post: optical-flow time remap of normal video");
    expect(html).toContain("Speed 800% with Optical Flow.");
    // The used route is a card, not a disclosure; only the second route folds.
    const routeDetails = html.slice(html.indexOf('id="how-it-was-made"'), html.indexOf('id="departments"'));
    expect(count(routeDetails, "<details")).toBe(1);
    expect(routeDetails).not.toMatch(/<details[^>]*\sopen/);
  });

  it("has no shot sequence for one shot", () => {
    expect(html).not.toContain('id="shot-sequence"');
    expect(html).not.toContain("data-shot-index");
  });

  it("gives an idle department a line, not a drawer", () => {
    const departments = html.slice(html.indexOf('id="departments"'));
    // Only camera has steps or pitfalls; every other department is flat.
    expect(count(departments, "<details")).toBe(1);
    expect(departments).toContain("vfx headline.");
  });

  it("does not say the crew in the article; that line lives in the rail", () => {
    expect(html).not.toContain("2: operator, one performer.");
  });

  it("does not print the answer section when nothing was asked", () => {
    expect(html).not.toContain('id="the-question"');
  });
});

describe("SegmentBreakdown, the answer", () => {
  it("heads the answer with the question that was asked", () => {
    const html = render(v3({ focus: "how do they do this effect", focus_answer: "Stills, sequenced." }));
    const answer = html.slice(html.indexOf('id="the-question"'), html.indexOf('id="how-it-was-made"'));
    expect(answer).toContain("how do they do this effect");
    expect(answer).toContain("Stills, sequenced.");
    expect(html.indexOf('id="what-happens"')).toBeLessThan(html.indexOf('id="the-question"'));
  });
});

describe("SegmentBreakdown, a three-shot row", () => {
  const breakdown = v3({
    shot_sequence: [0, 1, 2].map((i) => ({
      shot_index: i,
      timecode: `0:0${i * 4}-0:0${i * 4 + 4}`,
      what_happens: `Beat ${i}.`,
      how_it_was_made: `Setup ${i}.`,
      cut_note: i === 0 ? "" : `Cut on the ${i} beat.`,
    })),
  });
  const html = render(breakdown);

  it("ends with the sequence, one row per shot in both layouts", () => {
    expect(html.indexOf('id="departments"')).toBeLessThan(html.indexOf('id="shot-sequence"'));
    // A row and its jump button in the table, and the same pair in the stack.
    expect(count(html, 'data-shot-index="1"')).toBe(4);
    expect(html).toContain("Cut on the 2 beat.");
  });
});

describe("SegmentBreakdown, a row written before the technique spine", () => {
  const legacy = readSegmentBreakdown({
    version: SEGMENT_BREAKDOWN_VERSION,
    prompt_version: "segment-v2",
    focus: null,
    generated_at: "2026-01-01T00:00:00.000Z",
    title: "Old row",
    what_happens: "Something happens.",
    setting: "RETIRED-SETTING",
    approach: "RETIRED-APPROACH",
    focus_answer: "",
    shot_sequence: [
      { shot_index: 0, timecode: "0:00-0:07", what_happens: "x", how_it_was_made: "y", cut_note: "" },
    ],
    departments: DEPARTMENTS.map((role) => ({
      role,
      headline: `${role} headline.`,
      steps: [],
      pitfalls: [],
      gear: ["RETIRED-GEAR"],
    })),
    shot_list: ["RETIRED-SHOT-LIST"],
    prep_checklist: ["RETIRED-PREP"],
    minimum_crew: "RETIRED-CREW",
    difficulty: "easy",
    budget_tiers: { under_500_usd: ["RETIRED-TIER"], under_5000_usd: [], full_production: [] },
    common_mistakes: ["RETIRED-MISTAKE"],
    post_production: {
      key_technique: "RETIRED-POST",
      in_camera_or_post: "RETIRED-POST",
      pipeline: [],
      alternatives: [],
      pitfalls: [],
    },
  });

  it("still parses, and reaches the browser without any retired key", () => {
    expect(legacy).not.toBeNull();
    expect(JSON.stringify(legacy)).not.toContain("RETIRED");
  });

  it("shows the regenerate note where the technique would be, and none of the old document", () => {
    const html = render(legacy!);
    const spine = html.slice(html.indexOf('id="how-it-was-made"'), html.indexOf('id="departments"'));
    expect(spine).toContain("predates the technique section");
    expect(html).not.toContain("RETIRED");
  });

  it("exports the same document as Markdown", () => {
    const md = breakdownToMarkdown(legacy!);
    expect(md).toContain("predates the technique section");
    expect(md).not.toContain("RETIRED");
  });
});

describe("breakdownToMarkdown", () => {
  it("mirrors the page: read, technique with every route, departments, and kit last", () => {
    const md = breakdownToMarkdown(v3({ focus: "how?", focus_answer: "Like this." }));
    const order = ["# Paulista median", "## how?", "## How it was made", "### In camera:", "### In post:", "## Departments", "## Kit"];
    const positions = order.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md).not.toContain("## Shot sequence");
    expect(md).toContain("Crew: 2: operator, one performer.");
  });
});
