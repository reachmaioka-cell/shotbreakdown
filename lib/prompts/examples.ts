import type { Breakdown } from "@/lib/validation";

export const GOLD_EXAMPLES: { label: string; breakdown: Breakdown }[] = [
  {
    label: "natural-light handheld",
    breakdown: {
      shot_type: "Medium close-up, slightly off-axis",
      shot_type_confidence: 0.86,
      camera_angle: "Eye level, camera left of the eyeline",
      camera_angle_confidence: 0.8,
      lens: "~35mm full-frame equivalent, vintage spherical",
      lens_confidence: 0.74,
      depth_of_field: "Shallow; near eye sharp, far ear and background fall off fast",
      depth_of_field_confidence: 0.82,
      focal_length_mm_est: 35,
      aperture_est: "f/2",
      sensor_format_guess: "full-frame",
      lighting: {
        key: "Hard-ish window side-key from camera left, slightly above eyeline",
        fill: "Weak bounce from a pale wall camera right; let the shadow side go down",
        back: "None; separation comes from the bright window edge on the hair",
        practicals: "No lamps in frame; daylight is the only source",
        ratio_est: "4:1",
        motivation: "Late-afternoon window, subject a few feet off the glass",
        confidence: 0.84,
      },
      color: {
        look: "Warm daylight, slightly faded, skin holds orange-gold",
        contrast: "Medium; lifted blacks, not crushed",
        saturation: "A hair under natural",
        notable_hues: ["window-white gold", "shadow cyan-gray"],
        lut_or_process_guess: "Rec.709, mild film print emulation, no heavy teal",
        confidence: 0.78,
      },
      movement: {
        type: "Handheld micro-drift; operator breathing, not a motivated move",
        rig_guess: "handheld",
        speed: "Still-ish, 1–2cm sway",
        confidence: 0.7,
      },
      vfx: [],
      recreation_steps: [
        "Park the subject 3–4 feet from a west-facing window, body open to camera, face 3/4 to the glass.",
        "Shoot ~35mm FF at f/2. Handheld, elbows in, lean on a doorframe if the sway is too drunk.",
        "Expose for the lit cheek. Let the far side of the face drop 2 stops. No fill board unless skin turns to mud.",
        "White-balance a little warm. In the grade, keep window highlights creamy and do not crush the shadows.",
      ],
      budget_recreation: {
        under_500_usd: [
          "Any APS-C/FF stills body + 35mm f/1.8, window, white foam-core on the floor as last-resort fill",
          "Phone: 1x lens, lock AE on the lit cheek, film in 4K 24, add grain later",
        ],
        under_5000_usd: [
          "FX6/C70 + 35mm Master Prime or Sigma 35/1.4, 4x4 opal if the window is brutal",
          "Optional 1x1 bounce through the window for shape, not brightness",
        ],
      },
      common_mistakes: [
        "Putting the window behind them and calling it 'natural light' — that is a silhouette.",
        "Adding an LED key that fights the window color and flattens the ratio.",
        "85mm from across the room; you will lose the space and the documentary feel.",
      ],
      one_line_summary: "Handheld 35mm MCU, window side-key, warm faded daylight, 4:1 ratio.",
      tags: ["natural-light", "handheld", "window-light", "medium-close-up", "golden-hour"],
      notes: "If the sun is too hard, sheer curtain. Do not 'fix it in the grade' by lifting the dark cheek.",
    },
  },
  {
    label: "studio three-point static",
    breakdown: {
      shot_type: "Medium shot, waist-up, centered",
      shot_type_confidence: 0.9,
      camera_angle: "Eye level, camera square to the subject",
      camera_angle_confidence: 0.88,
      lens: "~50mm full-frame equivalent, modern spherical",
      lens_confidence: 0.8,
      depth_of_field: "Moderate; subject sharp, seamless a stop down, not mushy",
      depth_of_field_confidence: 0.77,
      focal_length_mm_est: 50,
      aperture_est: "f/2.8",
      sensor_format_guess: "super-35",
      lighting: {
        key: "Large soft key camera left (softbox or 4x4 bounce) about 45° off, slightly high",
        fill: "Opal or bounce camera right, 1.5–2 stops under the key",
        back: "Hard hair light from back-right, snooted, just kissing the shoulder",
        practicals: "None required; this is a studio setup",
        ratio_est: "2:1",
        motivation: "Interview/beauty key; clean commercial wrap light",
        confidence: 0.9,
      },
      color: {
        look: "Neutral commercial, clean whites, healthy skin",
        contrast: "Controlled mid contrast",
        saturation: "True to skin, slightly rich",
        notable_hues: ["neutral gray seamless", "skin peach"],
        lut_or_process_guess: "Rec.709 broadcast, very light film contrast, no stylized LUT",
        confidence: 0.85,
      },
      movement: {
        type: "Locked off",
        rig_guess: "static",
        speed: "None",
        confidence: 0.95,
      },
      vfx: [],
      recreation_steps: [
        "Seamless paper, subject 6 feet off the backdrop. Camera on sticks, 50mm, eye-level.",
        "Key: 2x3 or 4x4 through diffusion camera left. Fill: bounce right, two stops under.",
        "Hair light back-right, flags on both sides of the lens to kill flare.",
        "Expose skin at 60–70 IRE. White-balance off the seamless. Do not crush blacks in the grade.",
      ],
      budget_recreation: {
        under_500_usd: [
          "Godox 60cm octabox + cheap LED 300, white foam-core fill, clamp-light with baking foil as a snoot for hair",
          "Tripod is non-negotiable; handheld kills the 'studio' read",
        ],
        under_5000_usd: [
          "Aputure 600d + Light Dome, 300d or bounce fill, 60d with 10° on the hair, C-stands and flags",
          "Alexa Mini / FX6 on sticks, 50mm, T2.8",
        ],
      },
      common_mistakes: [
        "Key too close and too small — raccoon eyes and hot cheeks.",
        "Hair light spilling onto the seamless; flag it or you get a white halo blob.",
        "Shooting 24mm 'to get more body' and stretching the face.",
      ],
      one_line_summary: "Locked 50mm medium, classic 2:1 three-point, clean commercial grade.",
      tags: ["studio", "three-point", "static", "interview", "soft-key"],
      notes: "If they wear glasses, raise the key and watch the bounce in the lenses before you roll.",
    },
  },
  {
    label: "gimbal push-in night exterior",
    breakdown: {
      shot_type: "Wide moving toward a medium on the subject",
      shot_type_confidence: 0.83,
      camera_angle: "Slightly low, walking eyeline",
      camera_angle_confidence: 0.76,
      lens: "~24mm full-frame equivalent, spherical",
      lens_confidence: 0.72,
      depth_of_field: "Deep enough to hold neon and face; not everything sharp",
      depth_of_field_confidence: 0.7,
      focal_length_mm_est: 24,
      aperture_est: "f/2",
      sensor_format_guess: "full-frame",
      lighting: {
        key: "Hard sodium/LED streetlamp camera right as the motivated key",
        fill: "Wet pavement bounce plus a very weak LED on the gimbal, minus-green",
        back: "Neon storefronts behind as edge and color contrast",
        practicals: "Shop neon, streetlamp, maybe car taillights in the deep bg",
        ratio_est: "8:1 on the face, city stays hot",
        motivation: "Night street; do not add a 'moon' source",
        confidence: 0.8,
      },
      color: {
        look: "Cool streets, warm skin from sodium, neon magenta/cyan accents",
        contrast: "High, with rolled-off highlights in signs",
        saturation: "Pushed on neon, restrained on skin",
        notable_hues: ["sodium amber", "cyan neon", "wet asphalt"],
        lut_or_process_guess: "High-contrast night LUT, minus-green on skin, neon left hot",
        confidence: 0.77,
      },
      movement: {
        type: "Slow gimbal push-in on the body axis, leveling as you walk",
        rig_guess: "gimbal",
        speed: "About 1.5 seconds per meter; no wobble, no snap zoom",
        confidence: 0.78,
      },
      vfx: ["optional digital grain", "mild highlight bloom on neon"],
      recreation_steps: [
        "Scout a street with one hard lamp and a neon wall. Wet the pavement if it is dry.",
        "24mm on a gimbal, f/2, 800–2500 ISO. Start wide, walk a straight line into a medium.",
        "Gel a tiny onboard LED minus-green only if the eyes disappear; keep it 3+ stops under the streetlamp.",
        "Grade: keep sodium on skin, let neon clip a little, add grain last.",
      ],
      budget_recreation: {
        under_500_usd: [
          "Phone or a7C on a DJI Osmo/RS3 Mini, 24mm look (0.5x on phone is too wide — stay 1x and crop later)",
          "Bucket of water on the asphalt, no extra lights",
        ],
        under_5000_usd: [
          "FX3 + 24mm f/1.4 on RS3 Pro, tiny Aputure MC onboard, polarizer if neon is screaming",
          "Optional 1/8 Black Pro-Mist for bloom instead of fake bloom in post",
        ],
      },
      common_mistakes: [
        "Walking too fast so it reads as a documentary follow, not a push-in.",
        "Keying them with a bright RGB tube that ignores the streetlamp.",
        "Starting on a 50mm; you will clip parking meters and never get the wide.",
      ],
      one_line_summary: "Night gimbal push-in, 24mm, sodium key, neon edge, wet street.",
      tags: ["night-exterior", "gimbal", "push-in", "neon", "wide-shot"],
      notes: "If cars pass, time the start so a taillight streak happens mid-push, not over the face.",
    },
  },
];

export function formatGoldExamples(tags: string[] = []): string {
  return selectGoldExamples(tags)
    .map((ex) => `Example (${ex.label}):\n${JSON.stringify(ex.breakdown)}`)
    .join("\n\n");
}

export function selectGoldExamples(tags: string[] = [], limit = 2): typeof GOLD_EXAMPLES {
  if (!tags.length) return GOLD_EXAMPLES.slice(0, limit);

  const scored = GOLD_EXAMPLES.map((ex) => {
    const overlap = ex.breakdown.tags.filter((t) =>
      tags.some((q) => t.includes(q) || q.includes(t))
    ).length;
    return { ex, score: overlap };
  })
    .sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score > 0).slice(0, limit);
  if (top.length >= limit) return top.map((s) => s.ex);
  const picked = top.map((s) => s.ex);
  for (const ex of GOLD_EXAMPLES) {
    if (picked.length >= limit) break;
    if (!picked.includes(ex)) picked.push(ex);
  }
  return picked.slice(0, limit);
}
