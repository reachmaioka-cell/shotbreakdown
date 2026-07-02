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

// Downloads a clip (startTime/endTime given) or the full video (both null).
export async function downloadClip(
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

export async function analyzeVideoWithGemini(fileUri: string, prompt: string, maxOutputTokens = 32768): Promise<string | null> {
  try {
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
  } catch (e) {
    console.error('Gemini generation failed:', e)
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
