/** Rotating technique and filmmaker queries — keeps the agent learning craft fundamentals. */

export type TechniqueCurriculumItem = {
  id: string;
  query: string;
  tags: string[];
};

export const TECHNIQUE_CURRICULUM: TechniqueCurriculumItem[] = [
  { id: "dolly-zoom", query: "dolly zoom vertigo effect cinematography tutorial", tags: ["dolly-zoom", "movement"] },
  { id: "three-point", query: "three point lighting film setup diagram", tags: ["lighting", "studio"] },
  { id: "golden-hour", query: "golden hour cinematography exposure tips", tags: ["natural-light", "golden-hour"] },
  { id: "teal-orange", query: "teal and orange color grading film look DaVinci", tags: ["color-grade", "teal-and-orange"] },
  { id: "anamorphic", query: "anamorphic lens characteristics flares cinematography", tags: ["anamorphic", "lens"] },
  { id: "handheld", query: "handheld camera operating documentary style tips", tags: ["handheld", "movement"] },
  { id: "low-key", query: "low key noir lighting cinematography setup", tags: ["low-key", "lighting"] },
  { id: "gimbal", query: "gimbal vs steadicam vs dolly when to use", tags: ["gimbal", "movement"] },
  { id: "roger-deakins", query: "Roger Deakins cinematography interview technique", tags: ["Roger-Deakins", "lighting"] },
  { id: "greig-fraser", query: "Greig Fraser Dune cinematography LED volume", tags: ["Greig-Fraser", "sci-fi"] },
  { id: "hoyte-van-hoytema", query: "Hoyte van Hoytema IMAX cinematography natural light", tags: ["IMAX", "natural-light"] },
  { id: "bradford-young", query: "Bradford Young underexposure cinematography style", tags: ["diffusion", "lighting"] },
  { id: "vfx-compositing", query: "visual effects compositing filmmaking breakdown", tags: ["vfx", "post"] },
  { id: "ai-video", query: "AI video generation Runway Pika cinematography workflow", tags: ["ai-generated", "post"] },
  { id: "davinci-grade", query: "DaVinci Resolve color grading cinematic look tutorial", tags: ["color-grade", "post"] },
  { id: "music-video-lighting", query: "music video lighting techniques BTS", tags: ["music-video", "lighting"] },
  { id: "instagram-filmmaker", query: "cinematographer Instagram BTS lighting setup", tags: ["bts", "lighting"] },
  { id: "shallow-dof", query: "shallow depth of field portrait lens T-stop cinematography", tags: ["shallow-dof", "lens"] },
];
