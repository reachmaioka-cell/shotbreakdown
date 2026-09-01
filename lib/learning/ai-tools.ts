/** Proactive curriculum: AI image/video tools filmmakers use to create or finish shots. */

export type AiToolCurriculumItem = {
  id: string;
  name: string;
  category: "video" | "image" | "workflow";
  /** Primary use case for cinematographers */
  useCase: string;
  tags: string[];
};

export const AI_TOOL_CURRICULUM: AiToolCurriculumItem[] = [
  {
    id: "runway-gen3",
    name: "Runway Gen-3 Alpha",
    category: "video",
    useCase: "Text/image-to-video, camera motion control, lip sync, inpainting for VFX plates",
    tags: ["ai-generated", "runway", "video-gen", "post"],
  },
  {
    id: "runway-act-one",
    name: "Runway Act-One",
    category: "video",
    useCase: "Performance transfer and character animation from reference video",
    tags: ["ai-generated", "runway", "character", "post"],
  },
  {
    id: "pika-2",
    name: "Pika 2.0",
    category: "video",
    useCase: "Stylized text-to-video, scene extension, camera moves on stills",
    tags: ["ai-generated", "pika", "video-gen", "post"],
  },
  {
    id: "kling",
    name: "Kling AI",
    category: "video",
    useCase: "Long-form text-to-video, realistic motion, Chinese indie filmmaker adoption",
    tags: ["ai-generated", "kling", "video-gen", "post"],
  },
  {
    id: "sora",
    name: "OpenAI Sora",
    category: "video",
    useCase: "High-fidelity text-to-video, physics-aware motion, cinematic prompt syntax",
    tags: ["ai-generated", "sora", "video-gen", "post"],
  },
  {
    id: "luma-dream-machine",
    name: "Luma Dream Machine",
    category: "video",
    useCase: "Fast iteration text/image-to-video for previz and social clips",
    tags: ["ai-generated", "luma", "video-gen", "post"],
  },
  {
    id: "veo",
    name: "Google Veo",
    category: "video",
    useCase: "Cinematic text-to-video, long clips, integration with Google tools",
    tags: ["ai-generated", "veo", "video-gen", "post"],
  },
  {
    id: "midjourney",
    name: "Midjourney",
    category: "image",
    useCase: "Reference frames, mood boards, storyboard stills, style-locked plates for anim",
    tags: ["ai-generated", "midjourney", "image-gen", "post"],
  },
  {
    id: "flux",
    name: "Flux (Black Forest Labs)",
    category: "image",
    useCase: "Photoreal stills, consistent characters, high-res plates for comp",
    tags: ["ai-generated", "flux", "image-gen", "post"],
  },
  {
    id: "dalle3",
    name: "DALL-E 3",
    category: "image",
    useCase: "Quick concept frames, ChatGPT-integrated prompting for shot design",
    tags: ["ai-generated", "dalle", "image-gen", "post"],
  },
  {
    id: "stable-diffusion",
    name: "Stable Diffusion / ComfyUI",
    category: "workflow",
    useCase: "Custom pipelines, ControlNet depth/pose, img2img for set extensions",
    tags: ["ai-generated", "comfyui", "controlnet", "workflow", "post"],
  },
  {
    id: "controlnet",
    name: "ControlNet",
    category: "workflow",
    useCase: "Lock composition with depth/canny/pose maps from real plates",
    tags: ["ai-generated", "controlnet", "workflow", "post"],
  },
  {
    id: "topaz-video",
    name: "Topaz Video AI",
    category: "workflow",
    useCase: "Upscale, denoise, slow-mo interpolation — finishing AI-assisted footage",
    tags: ["ai-generated", "topaz", "upscale", "post"],
  },
  {
    id: "after-effects-roto",
    name: "After Effects + AI rotoscoping",
    category: "workflow",
    useCase: "Roto brush, content-aware fill, comp AI plates over practical footage",
    tags: ["ai-generated", "after-effects", "vfx", "post"],
  },
  {
    id: "davinci-neural",
    name: "DaVinci Resolve Neural Engine",
    category: "workflow",
    useCase: "Magic mask, speed warp, super scale — AI inside the grade timeline",
    tags: ["ai-generated", "davinci", "color-grade", "post"],
  },
  {
    id: "elevenlabs-sync",
    name: "ElevenLabs + lip sync tools",
    category: "workflow",
    useCase: "ADR, dialogue replacement synced to AI or practical video",
    tags: ["ai-generated", "dialogue", "post"],
  },
  {
    id: "haiper",
    name: "Haiper",
    category: "video",
    useCase: "Short-form stylized video, social-first AI cinematography",
    tags: ["ai-generated", "haiper", "video-gen", "post"],
  },
  {
    id: "minimax-hailuo",
    name: "MiniMax Hailuo",
    category: "video",
    useCase: "Character consistency across shots, anime/realistic hybrid motion",
    tags: ["ai-generated", "minimax", "video-gen", "post"],
  },
];

export function aiToolSearchQueries(item: AiToolCurriculumItem): string[] {
  return [
    `${item.name} tutorial cinematography filmmaker workflow ${new Date().getFullYear()}`,
    `${item.name} prompt tips camera movement lighting realistic`,
    `${item.name} vs traditional filmmaking when to use limitations`,
    `${item.name} ${item.useCase.split(",")[0]} how to`,
    `recreate cinematic shot using ${item.name} step by step`,
    `${item.name} BTS breakdown indie filmmaker`,
  ];
}

export function aiToolLabel(item: AiToolCurriculumItem): string {
  return `${item.name} (${item.category})`;
}
