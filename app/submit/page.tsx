'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

function detectPlatform(url: string) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('tiktok.com')) return 'tiktok'
  if (url.includes('instagram.com')) return 'instagram'
  return 'other'
}

export default function SubmitPage() {
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startMin, setStartMin] = useState('')
  const [startSec, setStartSec] = useState('')
  const [endMin, setEndMin] = useState('')
  const [endSec, setEndSec] = useState('')

  const startTime = startMin || startSec ? `${startMin || '0'}:${(startSec || '0').padStart(2, '0')}` : ''
  const endTime = endMin || endSec ? `${endMin || '0'}:${(endSec || '0').padStart(2, '0')}` : ''

  const handleTimeInput = (val: string, max: number) => val.replace(/\D/g, '').slice(0, String(max).length)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url && !file) return
    setLoading(true)
    setError('')

    try {
      const platform = url ? detectPlatform(url) : 'upload'
      let title = file ? file.name.replace(/\.[^/.]+$/, '') : url

      // Fetch video title from oEmbed so library shows a real name
      const oembedEndpoints: Record<string, string> = {
        youtube: 'https://www.youtube.com/oembed',
        tiktok: 'https://www.tiktok.com/oembed',
      }
      if (oembedEndpoints[platform] && url) {
        try {
          const oembedRes = await fetch(`${oembedEndpoints[platform]}?url=${encodeURIComponent(url)}&format=json`)
          if (oembedRes.ok) {
            const meta = await oembedRes.json()
            // For TikTok, combine author name + title for context
            if (platform === 'tiktok' && meta.author_name) {
              title = `${meta.author_name} — ${meta.title || 'TikTok'}`
            } else if (meta.title) {
              title = meta.title
            }
          }
        } catch { /* fall back to URL */ }
      }

      // Instagram doesn't have a public oEmbed — use username from URL as fallback
      if (platform === 'instagram' && url) {
        const match = url.match(/instagram\.com\/([^/?]+)/)
        if (match) title = `@${match[1]} — Instagram`
      }

      const { data, error: insertError } = await supabase
        .from('shots')
        .insert({
          title,
          source_url: url || null,
          platform,
          status: 'pending',
          start_time: startTime || null,
          end_time: endTime || null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      if (data) {
        fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shotId: data.id }),
        })
      }

      setSubmitted(true)
    } catch (err: unknown) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">✓</div>
          <h2 className="text-2xl font-bold mb-2">Shot submitted</h2>
          <p className="text-white/50 mb-8">Our AI is generating the breakdown. It'll be live shortly.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/library" className="text-sm bg-white text-black px-5 py-2.5 rounded-full font-medium hover:bg-white/90 transition">
              View Library
            </Link>
            <button
              onClick={() => { setSubmitted(false); setUrl(''); setFile(null); setStartTime(''); setEndTime('') }}
              className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50"
            >
              Submit another
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">ShotBreakdown</Link>
      </nav>

      <div className="max-w-xl mx-auto px-6 py-20">
        <h1 className="text-3xl font-bold mb-2">Submit a shot</h1>
        <p className="text-white/50 mb-10">Drop a link or upload a file. That's it.</p>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* URL */}
          <input
            type="url"
            placeholder="Paste a YouTube, TikTok, or Instagram link..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
          />

          {/* Timestamp — only when URL entered */}
          {url && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/30 shrink-0">Start</span>
              <input type="text" inputMode="numeric" placeholder="0" value={startMin}
                onChange={(e) => setStartMin(handleTimeInput(e.target.value, 99))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition"
                title="Minutes (leave blank for 0)" />
              <span className="text-white/30 text-sm">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={startSec}
                onChange={(e) => setStartSec(handleTimeInput(e.target.value, 59))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition"
                title="Seconds" />
              <span className="text-white/20 text-sm px-1">→</span>
              <span className="text-xs text-white/30 shrink-0">End</span>
              <input type="text" inputMode="numeric" placeholder="0" value={endMin}
                onChange={(e) => setEndMin(handleTimeInput(e.target.value, 99))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition"
                title="Minutes (leave blank for 0)" />
              <span className="text-white/30 text-sm">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={endSec}
                onChange={(e) => setEndSec(handleTimeInput(e.target.value, 59))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition"
                title="Seconds" />
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/20">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* File drop */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer ${
              dragging ? 'border-white/40 bg-white/5' : 'border-white/10 hover:border-white/20'
            }`}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            {file ? (
              <p className="text-white/80 text-sm">{file.name}</p>
            ) : (
              <>
                <p className="text-white/30 text-sm mb-1">Drop a video, frame, or GIF</p>
                <p className="text-xs text-white/15">MP4 · MOV · JPG · PNG · GIF</p>
                <p className="text-xs text-white/15 mt-2">Instagram blocked the fetch — drag the downloaded video in or upload the frame</p>
              </>
            )}
            <input id="file-input" type="file" accept="video/*,image/*,.gif" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={(!url && !file) || loading}
            className="w-full bg-white text-black py-3 rounded-full font-medium hover:bg-white/90 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? 'Submitting...' : 'Analyze shot'}
          </button>
        </form>
      </div>
    </main>
  )
}
