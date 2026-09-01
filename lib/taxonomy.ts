/**
 * Programmatic taxonomy pages.
 *
 * Each entry is a real filter over the shot database plus written editorial
 * explaining the technique. Deliberately curated rather than exhaustive: a page
 * only exists where the facet is something a filmmaker actually searches for
 * and where we can say something useful beyond listing thumbnails.
 *
 * Pages with too little real content are not rendered at all — see
 * MIN_SHOTS_FOR_INDEX.
 */

export type TaxonomyEntry = {
  slug: string;
  title: string;
  /** Meta description and page intro. */
  description: string;
  /** Two or three sentences of genuine craft explanation. */
  explainer: string;
  /** The facet filter this page represents. */
  filter: Record<string, string[]>;
  related?: string[];
};

export type TaxonomyGroup = {
  segment: string;
  label: string;
  intro: string;
  entries: TaxonomyEntry[];
};

/** Below this, a taxonomy page is a thin doorway and is not published. */
export const MIN_SHOTS_FOR_INDEX = 3;

export const TAXONOMY_GROUPS: TaxonomyGroup[] = [
  {
    segment: "camera-movements",
    label: "Camera movement",
    intro: "How the camera moves, and what each move does to a scene.",
    entries: [
      {
        slug: "push-in",
        title: "Push In Shots",
        description:
          "Reference shots where the camera pushes in toward the subject — slow dolly ins, creeping punch-ins and emotional reveals.",
        explainer:
          "A push in moves the camera toward the subject on the lens axis, tightening the frame without cutting. Because the background scales with the move, it reads as intensifying attention rather than the flat magnification of a zoom. Slow pushes build pressure under dialogue; fast pushes hit like a cut.",
        filter: { movement_type: ["push-in"] },
        related: ["pull-out", "dolly", "tracking"],
      },
      {
        slug: "pull-out",
        title: "Pull Out Shots",
        description:
          "Shots where the camera pulls back to reveal context — reverse dollies, reveals and isolation endings.",
        explainer:
          "Pulling out reverses the push: the subject shrinks and the world arrives around them. It is the standard grammar for isolation, for a reveal that recontextualises what you have been looking at, and for ending a sequence on scale.",
        filter: { movement_type: ["pull-out"] },
        related: ["push-in", "crane"],
      },
      {
        slug: "tracking",
        title: "Tracking Shots",
        description:
          "Camera moves that travel with a subject — lateral tracks, follow shots and walk-and-talks.",
        explainer:
          "A tracking shot moves alongside or behind a subject so they stay a constant size while the world slides past. The parallax between foreground and background is what sells the motion, so tracking works best where there is something close to the lens to pass.",
        filter: { movement_type: ["tracking"] },
        related: ["dolly", "handheld", "orbit"],
      },
      {
        slug: "handheld",
        title: "Handheld Camera",
        description:
          "Handheld cinematography references — documentary looseness, controlled instability and reactive framing.",
        explainer:
          "Handheld keeps a live, human weight in the frame: the operator reacts a beat after the action rather than anticipating it. The amount of movement is a tone control, from an almost-locked breathing frame to full documentary chaos.",
        filter: { movement_type: ["handheld"] },
        related: ["tracking", "static"],
      },
      {
        slug: "static",
        title: "Static and Locked-Off Shots",
        description:
          "Locked-off frames where nothing moves but the subject — composition-first cinematography references.",
        explainer:
          "A locked frame makes composition do all the work. With no camera motion to carry the eye, blocking, negative space and the moment of entry into frame become the edit. It is also the cleanest way to make a subsequent move feel significant.",
        filter: { movement_type: ["static"] },
        related: ["handheld", "push-in"],
      },
      {
        slug: "orbit",
        title: "Orbit and Arc Shots",
        description: "Circling camera moves that wrap around a subject.",
        explainer:
          "An orbit keeps the subject centred while the background rotates behind them, which separates figure from ground more aggressively than any other move. It reads as heightened, so it is usually reserved for a turn in the story rather than used as coverage.",
        filter: { movement_type: ["orbit"] },
        related: ["tracking", "crane"],
      },
      {
        slug: "crane",
        title: "Crane and Jib Shots",
        description: "Vertical camera moves that change the viewer's relationship to the scene.",
        explainer:
          "Craning changes height mid-shot, so the audience's vantage shifts from participant to observer or the reverse. Rising off a scene is the oldest ending in cinema for a reason: it hands the moment back to the world it happened in.",
        filter: { movement_type: ["crane"] },
        related: ["aerial", "pull-out"],
      },
    ],
  },
  {
    segment: "shot-types",
    label: "Shot size",
    intro: "How much of the subject is in frame, and what that does to the audience.",
    entries: [
      {
        slug: "close-up",
        title: "Close-Up Shots",
        description: "Close-up cinematography references — faces, detail and pressure.",
        explainer:
          "The close-up removes the world and leaves performance. Because there is no context left to read, everything the audience gets comes from the face and the light on it, which is why close-ups live or die on the key.",
        filter: { shot_size: ["close-up", "extreme-close-up"] },
        related: ["medium", "insert"],
      },
      {
        slug: "wide",
        title: "Wide Shots",
        description: "Wide and establishing shot references — scale, geography and place.",
        explainer:
          "A wide gives the audience the map: where everyone is, how big the space is, and what the subject is up against. Held long enough, a wide stops being information and starts being tone.",
        filter: { shot_size: ["wide", "extreme-wide"] },
        related: ["medium", "close-up"],
      },
      {
        slug: "medium",
        title: "Medium Shots",
        description: "Medium shot references — the working distance of most narrative coverage.",
        explainer:
          "The medium is the neutral distance: close enough to read a face, wide enough to keep gesture and blocking. Most scenes live here, which makes what you do with lens and light the thing that differentiates the frame.",
        filter: { shot_size: ["medium", "medium-close-up", "medium-wide"] },
        related: ["close-up", "wide"],
      },
      {
        slug: "insert",
        title: "Insert Shots",
        description: "Insert and detail shot references — hands, objects and texture.",
        explainer:
          "An insert isolates a detail the audience needs. Its job is clarity, so inserts are usually lit harder and framed tighter than the coverage around them, and they cut best when the motion in frame matches the motion of the shot they follow.",
        filter: { shot_size: ["insert", "extreme-close-up"] },
        related: ["close-up"],
      },
    ],
  },
  {
    segment: "lighting",
    label: "Lighting",
    intro: "Lighting schemes and what they do to a frame.",
    entries: [
      {
        slug: "low-key",
        title: "Low Key Lighting",
        description:
          "Low key lighting references — dense shadow, high contrast and selective exposure.",
        explainer:
          "Low key means most of the frame falls below middle grey, with light used to pick out only what matters. The look depends less on how dark it is than on the contrast ratio between key and fill: cut the fill and the shadow side goes to black.",
        filter: { lighting_key: ["low-key"] },
        related: ["high-key", "hard-light", "night"],
      },
      {
        slug: "high-key",
        title: "High Key Lighting",
        description: "High key lighting references — bright, low-contrast, open shadow.",
        explainer:
          "High key fills the shadows until the image sits mostly above middle grey. It reads as open, commercial and safe, which is why it dominates beauty, comedy and product work — and why using it against dark material is such an effective inversion.",
        filter: { lighting_key: ["high-key"] },
        related: ["low-key", "soft-light"],
      },
      {
        slug: "soft-light",
        title: "Soft Light",
        description: "Soft lighting references — wrapped shadow transitions and large sources.",
        explainer:
          "Softness is a function of source size relative to subject: the bigger and closer the source, the more gradual the shadow edge. Soft light flatters skin and hides texture, which is exactly why it is the wrong choice when you want a face to look worked-in.",
        filter: { lighting_quality: ["soft"] },
        related: ["hard-light", "high-key"],
      },
      {
        slug: "hard-light",
        title: "Hard Light",
        description: "Hard lighting references — defined shadow edges, texture and contrast.",
        explainer:
          "Hard light comes from a small or distant source and produces a crisp shadow edge. It reveals texture, carves shape, and puts a hard-edged shadow somewhere in frame — so where that shadow lands becomes a compositional decision.",
        filter: { lighting_quality: ["hard"] },
        related: ["soft-light", "low-key"],
      },
      {
        slug: "backlight",
        title: "Backlight and Rim Light",
        description: "Backlit cinematography references — separation, haze and silhouette.",
        explainer:
          "Backlight sits behind the subject and edges them away from the background. In haze or smoke it becomes visible as a beam; taken far enough with no fill it collapses the subject into silhouette.",
        filter: { key_direction: ["back"] },
        related: ["low-key", "night"],
      },
      {
        slug: "natural-light",
        title: "Natural Light",
        description: "Available-light cinematography references — daylight, windows and practicals.",
        explainer:
          "Working with available light means choosing time and position instead of instruments. The craft is in what you block, bounce and negative-fill, and in shooting the twenty minutes when the light is doing what you need.",
        filter: { lighting_source: ["natural"] },
        related: ["golden-hour", "soft-light"],
      },
    ],
  },
  {
    segment: "moods",
    label: "Mood",
    intro: "The emotional register of a frame.",
    entries: [
      {
        slug: "cinematic",
        title: "Cinematic Shots",
        description: "Shots with a heightened, composed, film-grammar look.",
        explainer:
          "‘Cinematic’ usually means a deliberate accumulation: controlled contrast, a considered aspect ratio, motivated light and a frame that is composed rather than captured. It is a result, not a setting.",
        filter: { moods: ["cinematic"] },
      },
      {
        slug: "moody",
        title: "Moody and Tense Shots",
        description: "Tense, ominous and low-light references.",
        explainer:
          "Tension is built with what you withhold: shadow that hides part of the frame, a lens long enough to flatten escape routes, and framing that leaves the wrong amount of space around a subject.",
        filter: { moods: ["tense", "ominous", "melancholic"] },
        related: ["low-key", "night"],
      },
      {
        slug: "dreamy",
        title: "Dreamy and Surreal Shots",
        description: "Soft, hazy, unreal reference frames.",
        explainer:
          "Dreamlike images usually break one rule of realism cleanly: bloomed highlights, impossible light direction, unmotivated colour, or a frame rate that is not life. Break more than one and it reads as an error.",
        filter: { moods: ["dreamy", "surreal"] },
      },
      {
        slug: "commercial",
        title: "Commercial Cinematography",
        description: "Product, beauty and brand-film reference shots.",
        explainer:
          "Commercial work optimises for legibility of the product and cleanliness of the frame: controlled highlight shape, deliberate negative space for type, and colour that survives compression on a phone.",
        filter: { moods: ["commercial"] },
      },
      {
        slug: "documentary",
        title: "Documentary Look",
        description: "Observational, available-light, reactive-framing references.",
        explainer:
          "The documentary look comes from constraint made visible: available light, a frame that reacts rather than anticipates, and a willingness to let the subject move out of ideal composition.",
        filter: { moods: ["documentary"] },
        related: ["handheld", "natural-light"],
      },
    ],
  },
  {
    segment: "colors",
    label: "Colour",
    intro: "Palette and colour temperature as a storytelling tool.",
    entries: [
      {
        slug: "warm",
        title: "Warm Colour Palettes",
        description: "Amber, gold and tungsten-leaning reference frames.",
        explainer:
          "Warm frames read as memory, safety and interiority — partly cultural, partly because skin sits comfortably in that range. Pushed far enough the palette collapses toward monochrome, which is often the point.",
        filter: { color_temperature: ["warm"] },
        related: ["golden-hour", "cool"],
      },
      {
        slug: "cool",
        title: "Cool Colour Palettes",
        description: "Blue, teal and daylight-leaning reference frames.",
        explainer:
          "Cool palettes read as night, distance and control. Because skin has almost no blue in it, a cool frame either separates a face from its surroundings or, with enough fill, drains it — which is a deliberate choice either way.",
        filter: { color_temperature: ["cool"] },
        related: ["warm", "night"],
      },
      {
        slug: "desaturated",
        title: "Desaturated Looks",
        description: "Muted, low-chroma reference frames.",
        explainer:
          "Pulling saturation shifts the audience's attention from colour to value and texture. It also raises the cost of any colour you leave in, which is why desaturated grades usually protect one hue.",
        filter: { saturation: ["desaturated", "muted"] },
      },
      {
        slug: "saturated",
        title: "Saturated and Bold Colour",
        description: "High-chroma, colour-forward reference frames.",
        explainer:
          "Heavy saturation makes colour the subject. It needs discipline in the frame — usually a restricted palette — because once every hue is loud, nothing reads as an accent.",
        filter: { saturation: ["saturated", "hyper-saturated"] },
      },
    ],
  },
  {
    segment: "lenses",
    label: "Lens",
    intro: "Focal length and depth of field as a perspective choice.",
    entries: [
      {
        slug: "wide-angle",
        title: "Wide Angle Cinematography",
        description: "Wide and ultra-wide lens references — expanded space and distortion.",
        explainer:
          "A wide lens exaggerates distance between planes: near things get bigger, far things get further. It makes rooms feel larger and faces feel closer, which is why it is both the interior lens and the confrontation lens.",
        filter: { lens_type: ["wide", "ultra-wide"] },
        related: ["telephoto"],
      },
      {
        slug: "telephoto",
        title: "Telephoto Cinematography",
        description: "Long lens references — compression, isolation and flattened space.",
        explainer:
          "Long lenses compress the distance between planes, stacking background onto subject. That flattening is what makes a crowd feel dense and a subject feel trapped, independent of any depth-of-field effect.",
        filter: { lens_type: ["telephoto"] },
        related: ["wide-angle", "shallow-focus"],
      },
      {
        slug: "shallow-focus",
        title: "Shallow Depth of Field",
        description: "Shallow focus references — subject isolation and fall-off.",
        explainer:
          "Shallow focus removes everything the audience does not need. Depth of field is a product of focal length, aperture and distance, so the same look is reachable more than one way — and each way changes the perspective differently.",
        filter: { depth_of_field: ["shallow"] },
        related: ["telephoto"],
      },
      {
        slug: "deep-focus",
        title: "Deep Focus",
        description: "Deep focus references — multiple planes held sharp.",
        explainer:
          "Deep focus keeps foreground and background legible at once, handing the audience a choice about where to look. It demands blocking that is worth reading in more than one plane.",
        filter: { depth_of_field: ["deep"] },
        related: ["wide-angle"],
      },
    ],
  },
  {
    segment: "times",
    label: "Time of day",
    intro: "When a shot was made, and what that light does.",
    entries: [
      {
        slug: "night",
        title: "Night Cinematography",
        description: "Night exterior and low-light reference frames.",
        explainer:
          "Night is not the absence of light but a specific ratio: sources that are visible in frame, deep unlit space between them, and just enough exposure to hold detail in the shadows without flattening them.",
        filter: { time_of_day: ["night"] },
        related: ["low-key", "cool"],
      },
      {
        slug: "golden-hour",
        title: "Golden Hour",
        description: "Golden hour reference frames — low, warm, directional sun.",
        explainer:
          "Golden hour gives a low sun that acts as a hard key and a natural backlight at once, with a warm cast the whole frame shares. Its problem is duration: the light changes measurably every few minutes.",
        filter: { time_of_day: ["golden-hour"] },
        related: ["warm", "natural-light"],
      },
      {
        slug: "daylight",
        title: "Daylight Exteriors",
        description: "Midday and afternoon exterior reference frames.",
        explainer:
          "Open daylight is the hardest light most productions face: high, contrasty and unflattering. The craft is in choosing the shade, the bounce and the direction the subject faces relative to it.",
        filter: { time_of_day: ["midday", "afternoon", "morning"] },
      },
      {
        slug: "interior",
        title: "Interior Cinematography",
        description: "Interior reference frames — windows, practicals and controlled space.",
        explainer:
          "Interiors let you decide where every photon comes from. Most convincing interior lighting still pretends to come from something the audience can see: a window, a lamp, a screen.",
        filter: { interior_exterior: ["interior"] },
      },
    ],
  },
];

export function findTaxonomy(segment: string, slug: string): TaxonomyEntry | null {
  const group = TAXONOMY_GROUPS.find((g) => g.segment === segment);
  return group?.entries.find((e) => e.slug === slug) ?? null;
}

export function taxonomyGroup(segment: string): TaxonomyGroup | null {
  return TAXONOMY_GROUPS.find((g) => g.segment === segment) ?? null;
}

export function allTaxonomyPaths(): { segment: string; slug: string }[] {
  return TAXONOMY_GROUPS.flatMap((group) =>
    group.entries.map((entry) => ({ segment: group.segment, slug: entry.slug }))
  );
}

/** Related links resolved across every group, so cross-linking is not manual. */
export function resolveRelated(entry: TaxonomyEntry): { href: string; title: string }[] {
  if (!entry.related?.length) return [];
  const out: { href: string; title: string }[] = [];
  for (const slug of entry.related) {
    for (const group of TAXONOMY_GROUPS) {
      const match = group.entries.find((e) => e.slug === slug);
      if (match) {
        out.push({ href: `/${group.segment}/${match.slug}`, title: match.title });
        break;
      }
    }
  }
  return out;
}
