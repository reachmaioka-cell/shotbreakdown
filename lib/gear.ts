// Hierarchical catalog — used by Research filters and to guide AI naming consistency

export type GearBrand = { brand: string; models: string[] }
export type GearCategory = { type: string; brands: GearBrand[] }
export type GearSection = { type: string; options: string[] }

// ── Cameras ──────────────────────────────────────────────────────────────────
export const CAMERA_CATALOG: GearCategory[] = [
  {
    type: 'Cinema',
    brands: [
      { brand: 'ARRI', models: ['ARRI Alexa 35', 'ARRI Alexa Mini LX', 'ARRI Alexa LF', 'ARRI Alexa Mini', 'ARRI Amira'] },
      { brand: 'RED', models: ['RED V-RAPTOR', 'RED Komodo-X', 'RED Komodo', 'RED Monstro', 'RED Helium', 'RED Dragon'] },
      { brand: 'Sony Cinema', models: ['Sony Venice 2', 'Sony Venice', 'Sony FX9'] },
      { brand: 'Blackmagic', models: ['Blackmagic URSA Mini Pro 12K', 'Blackmagic Pocket 6K G2', 'Blackmagic Cinema Camera 6K', 'Blackmagic Pocket 4K'] },
      { brand: 'Canon Cinema', models: ['Canon C70', 'Canon C300 Mark III', 'Canon C500 Mark II', 'Canon EOS R5 C'] },
      { brand: 'Panavision', models: ['Panavision Millennium DXL2', 'Panavision Panaflex'] },
    ],
  },
  {
    type: 'Mirrorless / Hybrid',
    brands: [
      { brand: 'Sony', models: ['Sony FX3', 'Sony FX6', 'Sony A7S III', 'Sony ZV-E1', 'Sony A7 IV'] },
      { brand: 'Canon', models: ['Canon EOS R5', 'Canon EOS R6 Mark II'] },
      { brand: 'Panasonic', models: ['Panasonic S5 II', 'Panasonic GH6', 'Panasonic AU-EVA1'] },
      { brand: 'Fujifilm', models: ['Fujifilm X-H2S', 'Fujifilm X-T5'] },
      { brand: 'Nikon', models: ['Nikon Z9', 'Nikon Z8'] },
    ],
  },
  {
    type: 'Mobile / Action',
    brands: [
      { brand: 'Apple', models: ['iPhone 15 Pro', 'iPhone 14 Pro', 'iPhone 13 Pro'] },
      { brand: 'DJI', models: ['DJI Ronin 4D', 'DJI Osmo Pocket 3', 'DJI Air 3'] },
      { brand: 'GoPro', models: ['GoPro Hero 12', 'GoPro Hero 11'] },
      { brand: 'Samsung', models: ['Samsung S24 Ultra'] },
    ],
  },
  {
    type: 'AI / Simulated',
    brands: [
      { brand: 'AI', models: ['AI Simulated', 'AI Generated', 'CGI'] },
    ],
  },
]

// Flat list — used in AI prompt to enforce consistent naming
export const CAMERAS = CAMERA_CATALOG.flatMap(c => c.brands.flatMap(b => b.models))

// ── Lenses ───────────────────────────────────────────────────────────────────
export const LENS_CATALOG: GearSection[] = [
  {
    type: 'Focal Length',
    options: ['Ultra Wide (8–14mm)', 'Wide (16–24mm)', 'Standard (28–40mm)', 'Normal (50mm)', 'Portrait (75–100mm)', 'Telephoto (135–200mm)', 'Super Telephoto (200mm+)'],
  },
  {
    type: 'Format',
    options: ['Anamorphic', 'Spherical', 'Full Frame', 'Super 35', 'Large Format'],
  },
  {
    type: 'Type',
    options: ['Prime', 'Zoom', 'Macro', 'Tilt-shift'],
  },
  {
    type: 'Brand / Series',
    options: ['Zeiss Supreme Prime', 'Zeiss Ultra Prime', 'Cooke S7/i', 'Leica Summilux-C', 'ARRI Signature Prime', 'Canon CN-E', 'Sigma Cine', 'Sony G Master', 'Angenieux Optimo', 'Atlas Orion', 'Laowa', 'Tokina Vista'],
  },
]

export const LENS_OPTIONS = LENS_CATALOG.flatMap(s => s.options)

// ── AI Tools ─────────────────────────────────────────────────────────────────
export const AI_CATALOG: GearSection[] = [
  {
    type: 'Video Generation',
    options: ['Runway Gen-3', 'Kling', 'Higgsfield', 'Pika', 'Sora', 'Luma Dream Machine', 'Stable Video Diffusion', 'Genmo'],
  },
  {
    type: 'Image Generation',
    options: ['Midjourney', 'DALL-E 3', 'Stable Diffusion', 'Adobe Firefly', 'Leonardo AI', 'Ideogram'],
  },
  {
    type: 'Enhancement / Upscaling',
    options: ['Topaz Video AI', 'Topaz Gigapixel', 'Adobe Enhance'],
  },
  {
    type: 'VFX / Compositing',
    options: ['After Effects', 'Unreal Engine', 'Blender', 'Houdini', 'Nuke', 'DaVinci Resolve', 'ComfyUI'],
  },
]

export const AI_PLATFORMS = AI_CATALOG.flatMap(s => s.options)

// ── Lighting ─────────────────────────────────────────────────────────────────
export const LIGHTING_CATALOG: GearSection[] = [
  {
    type: 'Source',
    options: ['Natural', 'Artificial', 'Mixed', 'Practical'],
  },
  {
    type: 'Quality',
    options: ['Hard light', 'Soft light', 'Diffused', 'Bounced'],
  },
  {
    type: 'Style / Setup',
    options: ['Three-point', 'High-key', 'Low-key', 'Silhouette', 'Motivated', 'Available light', 'Rembrandt', 'Butterfly'],
  },
]

export const LIGHTING_OPTIONS = LIGHTING_CATALOG.flatMap(s => s.options)

// ── Techniques ───────────────────────────────────────────────────────────────
export const TECHNIQUES = [
  'Dolly', 'Pan', 'Tilt', 'Handheld', 'Static', 'Orbit', 'Zoom',
  'Rack focus', 'Slow motion', 'Time lapse', 'Drone', 'Steadicam',
  'Gimbal', 'Whip pan', 'Push in', 'Pull back',
]
