export const LEARN_TOPICS = [
  "golden-hour",
  "close-up-lenses",
  "handheld-vs-gimbal",
  "three-point-lighting",
  "teal-and-orange",
  "anamorphic-on-a-budget",
  "dolly-zoom",
  "low-key-lighting",
] as const;

export type LearnTopic = (typeof LEARN_TOPICS)[number];

export const LEARN_META: Record<
  LearnTopic,
  { title: string; description: string; relatedTags: [string, string] }
> = {
  "golden-hour": {
    title: "How to get the golden hour look",
    description: "Sun angle, ratio, and white balance for that last-hour glow.",
    relatedTags: ["golden-hour", "natural-light"],
  },
  "close-up-lenses": {
    title: "What lens for close-ups",
    description: "Why 50–85mm is the default, and when to break it.",
    relatedTags: ["close-up", "medium-close-up"],
  },
  "handheld-vs-gimbal": {
    title: "Handheld vs gimbal",
    description: "When shake is the point, and when it is just sloppy.",
    relatedTags: ["handheld", "gimbal"],
  },
  "three-point-lighting": {
    title: "Three-point lighting explained",
    description: "Key, fill, back — ratios you can actually meter.",
    relatedTags: ["three-point", "studio"],
  },
  "teal-and-orange": {
    title: "Teal and orange grade",
    description: "Complementary skin vs sky, without the Instagram LUT.",
    relatedTags: ["teal-orange", "color-grade"],
  },
  "anamorphic-on-a-budget": {
    title: "Anamorphic look on a budget",
    description: "Flares, squeeze, and oval bokeh without a $8k lens.",
    relatedTags: ["anamorphic", "wide-shot"],
  },
  "dolly-zoom": {
    title: "Dolly zoom",
    description: "The vertigo move: speed match, nodal point, and when not to.",
    relatedTags: ["dolly", "push-in"],
  },
  "low-key-lighting": {
    title: "Low-key lighting",
    description: "One source, deep shadows, and how not to crush faces.",
    relatedTags: ["low-key", "night-exterior"],
  },
};

export function isLearnTopic(value: string): value is LearnTopic {
  return (LEARN_TOPICS as readonly string[]).includes(value);
}
