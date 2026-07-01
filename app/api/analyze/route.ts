import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execAsync = promisify(exec)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── YouTube helpers (fallback path) ────────────────────────────────────────

async function fetchYouTubeMeta(url: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const data = await res.json()
    return { title: data.title, author: data.author_name, thumbnail: data.thumbnail_url }
  } catch { return null }
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mediaType = res.headers.get('content-type') || 'image/jpeg'
    return { data: base64, mediaType }
  } catch { return null }
}

// ─── Gemini video pipeline ───────────────────────────────────────────────────

const YTDLP_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
}

async function downloadClip(
  sourceUrl: string,
  startTime: string | null,
  endTime: string | null,
  outputPath: string
): Promise<boolean> {
  try {
    const sectionArg = startTime && endTime
      ? `--download-sections "*${startTime}-${endTime}"`
      : ''
    const cmd = [
      'yt-dlp',
      sectionArg,
      '-f "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]"',
      '--merge-output-format mp4',
      '--no-playlist',
      '--no-part',
      '--quiet',
      `-o "${outputPath}"`,
      `"${sourceUrl}"`,
    ].filter(Boolean).join(' ')
    await execAsync(cmd, { timeout: 120_000, env: YTDLP_ENV })
    return fs.existsSync(outputPath)
  } catch (e) {
    console.error('yt-dlp failed:', String(e).slice(0, 400))
    return false
  }
}

// Pull username + caption from Instagram without downloading the video
async function getInstagramMeta(url: string): Promise<{ uploader: string; title: string } | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --print "%(uploader_id)s\t%(title)s" --skip-download --no-playlist --quiet "${url}"`,
      { timeout: 20_000, env: YTDLP_ENV }
    )
    const line = stdout.trim().split('\n')[0]
    const tabIdx = line.indexOf('\t')
    if (tabIdx === -1) return null
    const uploader = line.slice(0, tabIdx).trim()
    const title = line.slice(tabIdx + 1).trim()
    if (!uploader || uploader === 'NA') return null
    return { uploader, title }
  } catch (e) {
    console.error('Instagram meta failed:', String(e).slice(0, 100))
    return null
  }
}

async function uploadThumbnailBuffer(buf: Buffer, shotId: string, ext: string): Promise<string | null> {
  const mime = ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const storageName = `${shotId}.${ext === 'webp' ? 'webp' : 'jpg'}`
  const { data: upload } = await supabase.storage
    .from('thumbnails')
    .upload(storageName, buf, { contentType: mime, upsert: true })
  if (!upload) return null
  const { data: { publicUrl } } = supabase.storage.from('thumbnails').getPublicUrl(upload.path)
  await supabase.from('shots').update({ thumbnail_url: publicUrl }).eq('id', shotId)
  return publicUrl
}

// Find a file matching base + any image extension (yt-dlp picks the ext)
function findThumbnailFile(base: string): string | null {
  for (const ext of ['jpg', 'jpeg', 'webp', 'png']) {
    const p = `${base}.${ext}`
    if (fs.existsSync(p)) return p
  }
  // yt-dlp sometimes appends the video ID — scan tmpdir for any match
  try {
    const dir = path.dirname(base)
    const prefix = path.basename(base)
    const match = fs.readdirSync(dir).find(f => f.startsWith(prefix) && /\.(jpg|jpeg|webp|png)$/.test(f))
    if (match) return path.join(dir, match)
  } catch { /* ignore */ }
  return null
}

// Extract thumbnail via yt-dlp and save to Supabase storage.
// Method 1: --write-thumbnail (fast, no video download).
// Method 2: download 5s clip → extract frame with ffmpeg (fallback).
async function extractAndSaveThumbnail(sourceUrl: string, shotId: string): Promise<string | null> {
  const base = path.join(os.tmpdir(), `thumb_${shotId}`)

  // ── Method 1: direct thumbnail ─────────────────────────────────────────────
  try {
    await execAsync(
      `yt-dlp --write-thumbnail --skip-download --no-playlist --quiet -o "${base}" "${sourceUrl}"`,
      { timeout: 30_000, env: YTDLP_ENV }
    )
    const thumbPath = findThumbnailFile(base)
    if (thumbPath) {
      const ext = path.extname(thumbPath).slice(1)
      const buf = fs.readFileSync(thumbPath)
      fs.unlink(thumbPath, () => {})
      const url = await uploadThumbnailBuffer(buf, shotId, ext)
      if (url) { console.log('Thumbnail extracted via yt-dlp.'); return url }
    }
  } catch (e) {
    console.error('yt-dlp thumbnail failed:', String(e).slice(0, 200))
  }

  // ── Method 2: short clip → ffmpeg frame ───────────────────────────────────
  const clipPath = `${base}_clip.mp4`
  const framePath = `${base}_frame.jpg`
  try {
    await execAsync(
      `yt-dlp -f "best[height<=720]/best" --no-playlist --download-sections "*0-5" --merge-output-format mp4 --quiet -o "${clipPath}" "${sourceUrl}"`,
      { timeout: 60_000, env: YTDLP_ENV }
    )
    if (fs.existsSync(clipPath)) {
      await execAsync(
        `ffmpeg -y -i "${clipPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${framePath}"`,
        { timeout: 15_000, env: YTDLP_ENV }
      )
      fs.unlink(clipPath, () => {})
      if (fs.existsSync(framePath)) {
        const buf = fs.readFileSync(framePath)
        fs.unlink(framePath, () => {})
        const url = await uploadThumbnailBuffer(buf, shotId, 'jpg')
        if (url) { console.log('Thumbnail extracted via ffmpeg frame.'); return url }
      }
    }
  } catch (e) {
    console.error('ffmpeg frame extraction failed:', String(e).slice(0, 200))
  }

  return null
}

async function uploadToGeminiAndWait(filePath: string): Promise<string | null> {
  try {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!)
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType: 'video/mp4',
      displayName: path.basename(filePath),
    })
    let file = uploadResult.file
    // Poll until Gemini finishes processing the video
    while (file.state === FileState.PROCESSING) {
      await new Promise(r => setTimeout(r, 2000))
      file = await fileManager.getFile(file.name)
    }
    if (file.state !== FileState.ACTIVE) {
      console.error('Gemini file not active:', file.state)
      return null
    }
    return file.uri
  } catch (e) {
    console.error('Gemini upload failed:', e)
    return null
  }
}

async function analyzeVideoWithGemini(fileUri: string, prompt: string): Promise<string | null> {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 8192, temperature: 0.2 },
    })
    const result = await model.generateContent([
      { fileData: { mimeType: 'video/mp4', fileUri } },
      { text: prompt },
    ])
    return result.response.text()
  } catch (e) {
    console.error('Gemini generation failed:', e)
    return null
  }
}

async function cleanupGeminiFile(fileUri: string) {
  try {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!)
    // fileUri is like "https://generativelanguage.googleapis.com/v1beta/files/abc123"
    const fileName = fileUri.split('/').pop()!
    await fileManager.deleteFile(`files/${fileName}`)
  } catch { /* best-effort */ }
}

// ─── Status helpers ──────────────────────────────────────────────────────────

async function resetStatus(shotId: string) {
  await supabase.from('shots').update({ status: 'analyzed' }).eq('id', shotId)
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildPrompt(timeRange: string, focusLine: string, discipline: string | null, isVideo: boolean, personalizationLine = ''): string {
  const videoIntro = isVideo
    ? `You are watching the actual video clip. Observe everything across the full duration — camera movement, lighting changes, VFX layers, editing rhythm, set details, color grade, and any post-production effects.`
    : `You are analyzing a still frame. Make confident professional inferences for every department based on what you can see.`

  const disciplineEmphasis = discipline
    ? `\n\nThis analysis is for: ${discipline}. Weight your recreation steps and depth of detail toward what is most actionable for that role. Every section should still be filled — but go deepest on what matters most to them.`
    : `\n\nNo specific role was provided. Fill every section with equal depth.`

  return `You are a senior film analyst${personalizationLine} covering every department — camera, lighting, VFX, color, editing, production design, and art direction. Break down this shot so any filmmaker on the crew can use it.

${videoIntro}

${timeRange}${focusLine}${disciplineEmphasis}

RULES — follow exactly:
1. Never write "unknown", "unclear", or "cannot determine". Commit to a specific inference every time.
2. Camera: name a real body and real lens family. Judge by color science, DOF, bokeh, distortion.
3. Lighting: name real sources (SkyPanel, Kino Flo, HMI, fresnel, bounce). Note positions, modifiers, ratios, color temp.
4. VFX: identify every post-production layer — particles, composites, speed ramps, parallax, CG, screen replacements, stabilization, beauty work. For each, describe the technique and software to recreate it.
5. Color grade: describe the grade as a colorist would — log profile, contrast curve, shadow/highlight treatment, color casts, skin tone, saturation, and any identifiable LUT style.
6. Production design: describe the set — practical or built, key materials and textures, color palette, notable props, whether green screen or virtual production was used.
7. Editing: describe the cut type, pacing, rhythm, what makes this a strong in/out point, and how it would cut against adjacent shots.
8. Recreation steps: write exactly 8 steps tailored to the discipline specified. Cover camera, lighting, movement, VFX pipeline, color grade, and crew. Each step must be a concrete on-set or post action with real gear, software, and settings named.

Return ONLY valid JSON — no commentary, no markdown:

{
  "camera_specs": {
    "camera": "real body name",
    "lens": "focal length + lens family",
    "aperture": "T-stop or f-stop",
    "shutter": "shutter speed + angle",
    "iso": "EI or ISO value",
    "frame_rate": "capture fps + delivery fps if different"
  },
  "lighting": {
    "type": "natural | artificial | mixed",
    "key_light": "source, size, position, modifier",
    "key_light_position": "left | right | front-left | front-right | overhead | back-left | back-right | behind",
    "fill": "source, ratio — or none",
    "fill_position": "left | right | front-left | front-right | overhead | none",
    "backlight": "source description — or null",
    "backlight_position": "left | right | back-left | back-right | behind | none",
    "notes": "color temp, practicals, overall lighting style and mood"
  },
  "camera_movement": {
    "type": "dolly | pan | tilt | handheld | static | orbit | zoom | push-in | pull-out",
    "speed": "slow | medium | fast",
    "notes": "describe the move observed, rig used, and emotional purpose"
  },
  "vfx": [
    "Element name — what it is, how it was made, software and technique to recreate it (e.g. Rain parallax — 3 particle layers in After Effects with Trapcode Particular, Screen blend, foreground/mid/bg speeds 100%/60%/30%)"
  ],
  "color_grade": {
    "style": "overall look name or description",
    "log_profile": "log format likely used (ARRI LogC, S-Log3, BRAW, etc.)",
    "shadows": "color cast and treatment in shadows",
    "midtones": "color cast and treatment in midtones",
    "highlights": "color cast and treatment in highlights",
    "skin_tone": "how skin tones are handled",
    "contrast": "contrast curve description (flat, S-curve, lifted blacks, etc.)",
    "saturation": "overall saturation approach",
    "lut_reference": "identifiable LUT style or reference grade",
    "notes": "any secondary grades, power windows, or special treatments"
  },
  "production_design": {
    "set_type": "practical location | built set | studio | virtual production | green screen | mixed",
    "description": "overall environment and setting",
    "color_palette": "dominant color choices in the set and wardrobe",
    "key_elements": ["notable design element or prop"],
    "materials": "surfaces, textures, materials visible",
    "green_screen": "yes — describe what was replaced | no",
    "notes": "construction notes, art direction style, reference era or aesthetic"
  },
  "editing": {
    "cut_type": "hard cut | dissolve | match cut | smash cut | wipe | none (single shot)",
    "pacing": "slow | medium | fast",
    "rhythm": "how this shot fits into the edit — breathes or drives",
    "in_point": "what makes this a strong in point",
    "out_point": "what makes this a strong out point",
    "notes": "any speed ramps, jump cuts, intercutting, or editorial effects visible"
  },
  "recreation_steps": [
    { "step": 1, "title": "step title", "description": "specific, actionable instruction for this role" }
  ],
  "ai_tools": {
    "platform": "Higgsfield | Runway | Kling | Pika | Sora | Real Camera | Unknown",
    "model": "model name or null",
    "prompt": "detailed prompt to recreate this look in an AI video tool",
    "steps": ["step 1", "step 2"]
  },
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`
}

// ─── Main route ──────────────────────────────────────────────────────────────

type PreferenceProfile = {
  computed?: {
    top_cameras?: string[]
    top_lighting?: string[]
    top_movements?: string[]
    top_ai_tools?: string[]
    avg_rating?: number
  }
}

function buildPersonalizationLine(profile: PreferenceProfile | null): string {
  if (!profile?.computed) return ''
  const { top_cameras, top_lighting, top_movements, avg_rating } = profile.computed
  const parts: string[] = []
  if (top_cameras?.length) parts.push(`preferred cameras: ${top_cameras.join(', ')}`)
  if (top_lighting?.length) parts.push(`preferred lighting: ${top_lighting.join(', ')}`)
  if (top_movements?.length) parts.push(`preferred movement: ${top_movements.join(', ')}`)
  if (!parts.length) return ''
  const avgNote = avg_rating ? ` (avg rating: ${avg_rating}/10)` : ''
  return `\n\nUser preference profile${avgNote} — go deeper on: ${parts.join('; ')}.`
}

export async function POST(req: NextRequest) {
  let shotId = ''
  let tmpPath: string | null = null
  let geminiFileUri: string | null = null

  try {
    const body = await req.json()
    shotId = body.shotId
    const focus: string | null = body.focus ?? null
    const discipline: string | null = body.discipline ?? null

    const { data: shotRaw } = await supabase.from('shots').select('*').eq('id', shotId).single()
    if (!shotRaw) return NextResponse.json({ error: 'Shot not found' }, { status: 404 })

    // Fetch user preferences for personalization
    let preferenceProfile: PreferenceProfile | null = null
    if (shotRaw.user_id) {
      const { data: prof } = await supabase.from('profiles').select('preference_profile').eq('id', shotRaw.user_id).single()
      preferenceProfile = (prof?.preference_profile as PreferenceProfile) ?? null
    }

    await supabase.from('shots').update({ status: 'pending', discipline, focus }).eq('id', shotId)

    // For Instagram: extract thumbnail + enrich title from metadata
    let thumbnailUrl: string | null = shotRaw.thumbnail_url ?? null
    if (shotRaw.platform === 'instagram' && shotRaw.source_url) {
      // Run thumbnail extraction and metadata fetch in parallel
      const [thumb, meta] = await Promise.all([
        thumbnailUrl ? Promise.resolve(thumbnailUrl) : extractAndSaveThumbnail(shotRaw.source_url, shotId),
        getInstagramMeta(shotRaw.source_url),
      ])
      if (thumb) thumbnailUrl = thumb
      if (meta?.uploader) {
        const caption = meta.title && !meta.title.startsWith('Video by ')
          ? meta.title.slice(0, 80)
          : null
        const newTitle = caption
          ? `@${meta.uploader} — ${caption}`
          : `@${meta.uploader} — Instagram`
        await supabase.from('shots').update({ title: newTitle }).eq('id', shotId)
      }
    }

    const shot = { ...shotRaw, thumbnail_url: thumbnailUrl }

    const timeRange = shot.start_time && shot.end_time
      ? `This clip runs from ${shot.start_time} to ${shot.end_time}.`
      : ''
    const focusLine = focus
      ? `\n\nThe user specifically wants to understand: "${focus}". Make this the central thread of your breakdown.`
      : ''
    const personalizationLine = buildPersonalizationLine(preferenceProfile)
    let rawText: string | null = null
    let usedVideo = false

    // ── Path A: Gemini watches the actual video ──────────────────────────────
    // YouTube: requires start+end times to limit clip length
    // Instagram: download full post (reels are short, yt-dlp handles it)
    // Instagram: use thumbnail + Claude (faster, more reliable than full download)
    // YouTube: use Gemini video only when user specified a clip range
    const canUseVideo =
      shot.source_url &&
      !!process.env.GEMINI_API_KEY &&
      shot.platform === 'youtube' &&
      shot.start_time &&
      shot.end_time

    if (canUseVideo) {
      console.log('Attempting Gemini video analysis...')
      tmpPath = path.join(os.tmpdir(), `shot_${shotId}.mp4`)

      const downloaded = await downloadClip(shot.source_url!, shot.start_time ?? null, shot.end_time ?? null, tmpPath)
      if (downloaded) {
        console.log('Clip downloaded, uploading to Gemini...')
        geminiFileUri = await uploadToGeminiAndWait(tmpPath)
        if (geminiFileUri) {
          console.log('Gemini file ready, generating analysis...')
          const prompt = buildPrompt(timeRange, focusLine, discipline, true, personalizationLine)
          rawText = await analyzeVideoWithGemini(geminiFileUri, prompt)
          if (rawText) {
            usedVideo = true
            console.log('Gemini video analysis complete.')
          }
        }
      }
    }

    // ── Path B: Claude analyzes a still image (fallback) ────────────────────
    if (!rawText) {
      if (!usedVideo) console.log('Falling back to Claude image analysis...')
      const prompt = buildPrompt(timeRange, focusLine, discipline, false, personalizationLine)
      let messageContent: Anthropic.MessageParam['content'] = [{ type: 'text', text: prompt }]

      if (shot.platform === 'youtube' && shot.source_url) {
        if (shot.thumbnail_url) {
          const image = await fetchImageAsBase64(shot.thumbnail_url)
          if (image) {
            messageContent = [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data } },
              { type: 'text', text: `Video title: "${shot.title}"\n\n${prompt}` },
            ]
          }
        } else {
          const meta = await fetchYouTubeMeta(shot.source_url)
          if (meta?.thumbnail) {
            const [image] = await Promise.all([
              fetchImageAsBase64(meta.thumbnail),
              supabase.from('shots').update({ thumbnail_url: meta.thumbnail, title: meta.title }).eq('id', shotId),
            ])
            if (image) {
              messageContent = [
                { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data } },
                { type: 'text', text: `Video title: "${meta.title}" by ${meta.author}\n\n${prompt}` },
              ]
            }
          }
        }
      } else if (shot.thumbnail_url) {
        // Instagram (thumbnail extracted by yt-dlp above) or direct upload
        const image = await fetchImageAsBase64(shot.thumbnail_url)
        if (image) {
          messageContent = [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data } },
            { type: 'text', text: `Source: "${shot.title}"\n\n${prompt}` },
          ]
        }
      }

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5000,
        messages: [{ role: 'user', content: messageContent }],
      })

      const content = message.content[0]
      if (content.type !== 'text') {
        await resetStatus(shotId)
        return NextResponse.json({ error: 'Unexpected AI response type' }, { status: 500 })
      }
      rawText = content.text
    }

    // ── Parse the JSON response ──────────────────────────────────────────────
    // Strip markdown fences and Gemini 2.5 thinking blocks
    const stripped = rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?\n?/g, '')
      .trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('No JSON in response:', stripped.slice(0, 300))
      await resetStatus(shotId)
      return NextResponse.json({ error: 'AI did not return valid JSON — try again' }, { status: 500 })
    }

    let breakdown
    try {
      breakdown = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('JSON parse error:', e)
      console.error('Raw response length:', rawText?.length, '| JSON match length:', jsonMatch[0].length)
      console.error('JSON tail (last 200 chars):', jsonMatch[0].slice(-200))
      await resetStatus(shotId)
      return NextResponse.json({ error: 'AI response was malformed — try again' }, { status: 500 })
    }

    const { error: insertError } = await supabase.from('breakdowns').upsert({
      shot_id: shotId,
      ai_tools: breakdown.ai_tools,
      camera_specs: breakdown.camera_specs,
      lighting: breakdown.lighting,
      camera_movement: breakdown.camera_movement,
      vfx: breakdown.vfx,
      color_grade: breakdown.color_grade ?? null,
      production_design: breakdown.production_design ?? null,
      editing: breakdown.editing ?? null,
      recreation_steps: breakdown.recreation_steps,
      tags: breakdown.tags,
      verified: false,
    }, { onConflict: 'shot_id' })

    if (insertError) {
      console.error('BREAKDOWN UPSERT ERROR:', JSON.stringify(insertError))
      await resetStatus(shotId)
      return NextResponse.json({ error: 'Failed to save breakdown: ' + insertError.message }, { status: 500 })
    }

    await supabase.from('shots').update({ status: 'analyzed' }).eq('id', shotId)

    return NextResponse.json({ success: true, breakdown, source: usedVideo ? 'gemini-video' : 'claude-image' })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('ANALYZE ERROR:', msg)
    if (shotId) await resetStatus(shotId)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    // Clean up temp video file
    if (tmpPath) fs.unlink(tmpPath, () => {})
    // Clean up Gemini file storage
    if (geminiFileUri) cleanupGeminiFile(geminiFileUri)
  }
}
