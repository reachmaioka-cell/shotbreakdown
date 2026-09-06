import { SegmentBreakdown } from "@/components/segment/segment-breakdown";
import { BreakdownStatus } from "@/components/segment/breakdown-status";
import { RefocusDialog } from "@/components/segment/refocus-dialog";
import { SegmentAsk } from "@/components/segment/segment-ask";
import { DEPARTMENTS, StoredSegmentBreakdownSchema } from "@/lib/validation";

const fixture = StoredSegmentBreakdownSchema.parse({
  version: 1,
  prompt_version: "v1",
  focus: "How do I get that under-jaw key on a corridor walk?",
  generated_at: "2026-01-01T00:00:00Z",
  title: "A single push-in through a rain-lit corridor",
  what_happens: "First paragraph.\n\nSecond paragraph.",
  setting: "A wet corridor at night.",
  approach: "One dolly move.",
  focus_answer: "Answer para one.\n\nAnswer para two.",
  shot_sequence: [
    { shot_index: 0, timecode: "0:00", what_happens: "Courier clears frame left.", how_it_was_made: "Dolly, 32mm, T2.8.", cut_note: "Cut on the whip." },
    { shot_index: 1, timecode: "0:03", what_happens: "Push in.", how_it_was_made: "Same track.", cut_note: "" },
  ],
  departments: DEPARTMENTS.map((role) => ({
    role,
    headline: `${role} headline for this segment.`,
    steps: role === "vfx" ? [] : ["Do the first thing.", "Then the second."],
    gear: role === "vfx" ? [] : ["2x2 LED (or a bounced work light)"],
    pitfalls: role === "vfx" ? [] : ["The floor dries out between takes."],
  })),
  shot_list: ["1. Wide, corridor, dolly in", "2. Push to clean single"],
  prep_checklist: ["Wet the floor", "Tape the track"],
  minimum_crew: "Three: operator, gaffer, first AC",
  difficulty: "hard",
  budget_tiers: { under_500_usd: ["Bounce off a white sheet"], under_5000_usd: ["Rent one 2x2"], full_production: ["Full grip package"] },
  common_mistakes: ["Aiming the lamp at the actor."],
});

const shots = [
  { id: "a", shotIndex: 0, thumbnailUrl: null, timecode: "0:00" },
  { id: "b", shotIndex: 1, thumbnailUrl: null, timecode: "0:03" },
];

export default function Probe() {
  return (
    <main className="mx-auto max-w-4xl p-8 flex flex-col gap-8">
      <BreakdownStatus videoId="00000000-0000-0000-0000-000000000000" status={null} />
      <BreakdownStatus videoId="00000000-0000-0000-0000-000000000000" status="failed" error="model refused" />
      <RefocusDialog videoId="00000000-0000-0000-0000-000000000000" focus={fixture.focus} />
      <SegmentBreakdown breakdown={fixture} shots={shots} openRole="lighting_grip" segmentSeconds={12} />
      <SegmentAsk videoId="00000000-0000-0000-0000-000000000000" />
    </main>
  );
}
