import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)

export const YTDLP_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
}

// Both yt-dlp (occasional YouTube 403s) and Gemini (occasional 503 "high
// demand") fail transiently often enough that a couple of retries with
// backoff meaningfully improves real-world success rate.
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (i < attempts - 1) {
        const delay = 2000 * (i + 1)
        console.error(`${label} failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`, String(e).slice(0, 200))
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

// Downloads a clip (startTime/endTime given) or the full video (both null).
export async function downloadClip(
  sourceUrl: string,
  startTime: string | null,
  endTime: string | null,
  outputPath: string
): Promise<boolean> {
  try {
    await withRetry(async () => {
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
      if (!fs.existsSync(outputPath)) throw new Error('yt-dlp reported success but output file is missing')
    }, 'yt-dlp download')
    return true
  } catch (e) {
    console.error('yt-dlp failed after retries:', String(e).slice(0, 400))
    return false
  }
}

// Real duration in seconds, via yt-dlp metadata only (no download).
export async function getVideoDuration(sourceUrl: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --print "%(duration)s" --skip-download --no-playlist --quiet "${sourceUrl}"`,
      { timeout: 20_000, env: YTDLP_ENV }
    )
    const secs = parseFloat(stdout.trim())
    return Number.isFinite(secs) ? secs : null
  } catch (e) {
    console.error('yt-dlp duration fetch failed:', String(e).slice(0, 200))
    return null
  }
}

export async function uploadToGeminiAndWait(filePath: string): Promise<string | null> {
  try {
    return await withRetry(async () => {
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
        throw new Error(`Gemini file not active: ${file.state}`)
      }
      return file.uri
    }, 'Gemini upload')
  } catch (e) {
    console.error('Gemini upload failed after retries:', e)
    return null
  }
}

export async function analyzeVideoWithGemini(fileUri: string, prompt: string, maxOutputTokens = 32768): Promise<string | null> {
  try {
    return await withRetry(async () => {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens, temperature: 0.2 },
      })
      const result = await model.generateContent([
        { fileData: { mimeType: 'video/mp4', fileUri } },
        { text: prompt },
      ])
      return result.response.text()
    }, 'Gemini generation')
  } catch (e) {
    console.error('Gemini generation failed after retries:', e)
    return null
  }
}

export async function cleanupGeminiFile(fileUri: string) {
  try {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!)
    // fileUri is like "https://generativelanguage.googleapis.com/v1beta/files/abc123"
    const fileName = fileUri.split('/').pop()!
    await fileManager.deleteFile(`files/${fileName}`)
  } catch { /* best-effort */ }
}
