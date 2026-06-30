'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

const FREE_LIMIT = 10
const DISCIPLINES = ['Director', 'DP', 'Gaffer', 'Editor', 'Colorist', 'VFX Artist', 'Producer']

function captureVideoFrame(file: File, seconds: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)
    video.src = url
    video.currentTime = seconds
    const cleanup = () => URL.revokeObjectURL(url)
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 1280
        canvas.height = video.videoHeight || 720
        const ctx = canvas.getContext('2d')
        if (!ctx) { cleanup(); resolve(null); return }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => { cleanup(); resolve(blob) }, 'image/jpeg', 0.85)
      } catch { cleanup(); resolve(null) }
    }
    video.onerror = () => { cleanup(); resolve(null) }
    video.load()
  })
}

function detectPlatform(url: string) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('tiktok.com')) return 'tiktok'
  if (url.includes('instagram.com')) return 'instagram'
  return 'other'
}

export default function SubmitPage() {
  const [user, setUser] = useState<User | null>(null)
  const [usageCount, setUsageCount] = useState(0)
  const [authLoading, setAuthLoading] = useState(true)

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
  const [focus, setFocus] = useState('')
  const [disciplines, setDisciplines] = useState<Set<string>>(new Set())
  const [isPro, setIsPro] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const [{ count }, { data: profile }] = await Promise.all([
          supabase.from('shots').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id),
          supabase.from('profiles').select('is_pro').eq('id', session.user.id).single(),
        ])
        setUsageCount(count ?? 0)
        setIsPro(profile?.is_pro ?? false)
      }
      setAuthLoading(false)
    })
  }, [])

  const startTime = startMin || startSec ? `${startMin || '0'}:${(startSec || '0').padStart(2, '0')}` : ''
  const endTime = endMin || endSec ? `${endMin || '0'}:${(endSec || '0').padStart(2, '0')}` : ''
  const isVideoFile = !!file && (file.type.startsWith('video') || /\.(mp4|mov)$/i.test(file.name))
  const handleTimeInput = (val: string, max: number) => {
    const digits = val.replace(/\D/g, '').slice(0, 2)
    if (!digits) return ''
    const num = parseInt(digits, 10)
    return num > max ? String(max) : digits
  }

  const resetForm = () => {
    setSubmitted(false); setUrl(''); setFile(null)
    setStartMin(''); setStartSec(''); setEndMin(''); setEndSec('')
    setFocus(''); setDisciplines(new Set())
  }

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
      if (startTime && endTime) {
        const toSecs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + (s || 0) }
        if (toSecs(endTime) <= toSecs(startTime)) {
          setError('End time must be after start time.')
          setLoading(false)
          return
        }
      }

      const platform = url ? detectPlatform(url) : 'upload'
      let title = file ? file.name.replace(/\.[^/.]+$/, '') : url

      const oembedEndpoints: Record<string, string> = {
        youtube: 'https://www.youtube.com/oembed',
        tiktok: 'https://www.tiktok.com/oembed',
      }
      if (oembedEndpoints[platform] && url) {
        try {
          const oembedRes = await fetch(`${oembedEndpoints[platform]}?url=${encodeURIComponent(url)}&format=json`)
          if (oembedRes.ok) {
            const meta = await oembedRes.json()
            if (platform === 'tiktok' && meta.author_name) {
              title = `${meta.author_name} — ${meta.title || 'TikTok'}`
            } else if (meta.title) {
              title = meta.title
            }
          }
        } catch { /* fall back to URL */ }
      }

      if (platform === 'instagram' && url) {
        const match = url.match(/instagram\.com\/([^/?]+)/)
        if (match) {
          const seg = match[1]
          // /p/, /reel/, /tv/ etc. are post types, not usernames
          const isPostType = ['p', 'reel', 'tv', 'stories', 'explore', 'accounts'].includes(seg)
          title = isPostType ? 'Instagram Post' : `@${seg} — Instagram`
        }
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
          user_id: user?.id ?? null,
          focus: focus || null,
          discipline: disciplines.size > 0 ? Array.from(disciplines).join(', ') : null,
        })
        .select()
        .single()

      if (insertError) throw insertError

      if (data) {
        setUsageCount(c => c + 1)

        if (isVideoFile && file && startTime) {
          const toSecs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + (s || 0) }
          const blob = await captureVideoFrame(file, toSecs(startTime))
          if (blob) {
            const { data: upload } = await supabase.storage.from('thumbnails').upload(`${data.id}.jpg`, blob, { contentType: 'image/jpeg', upsert: true })
            if (upload) {
              const { data: { publicUrl } } = supabase.storage.from('thumbnails').getPublicUrl(upload.path)
              await supabase.from('shots').update({ thumbnail_url: publicUrl }).eq('id', data.id)
            }
          }
        }

        fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shotId: data.id, focus: focus || null, discipline: disciplines.size > 0 ? Array.from(disciplines).join(', ') : null }),
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

  const Timecode = () => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/30 shrink-0">Start</span>
      <input type="text" inputMode="numeric" placeholder="0" value={startMin}
        onChange={(e) => setStartMin(handleTimeInput(e.target.value, 99))}
        className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
      <span className="text-white/30 text-sm">:</span>
      <input type="text" inputMode="numeric" placeholder="00" value={startSec}
        onChange={(e) => setStartSec(handleTimeInput(e.target.value, 59))}
        className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
      <span className="text-white/20 text-sm px-1">→</span>
      <span className="text-xs text-white/30 shrink-0">End</span>
      <input type="text" inputMode="numeric" placeholder="0" value={endMin}
        onChange={(e) => setEndMin(handleTimeInput(e.target.value, 99))}
        className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
      <span className="text-white/30 text-sm">:</span>
      <input type="text" inputMode="numeric" placeholder="00" value={endSec}
        onChange={(e) => setEndSec(handleTimeInput(e.target.value, 59))}
        className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
    </div>
  )

  if (authLoading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/30">Loading...</p>
      </main>
    )
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
            <button onClick={resetForm}
              className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50">
              Analyze another
            </button>
          </div>
        </div>
      </main>
    )
  }

  const atLimit = !isPro && usageCount >= FREE_LIMIT

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar links={[
        { href: '/projects', label: 'Projects' },
        { href: '/library', label: 'Library' },
      ]} />

      <div className="max-w-xl mx-auto px-6 py-20">
        <h1 className="text-3xl font-bold mb-2">Analyze a shot</h1>
        <p className="text-white/50 mb-2">Drop a link or upload a file. That's it.</p>
        {user && (
          <p className="text-xs text-white/25 mb-10">
            {atLimit
              ? `${FREE_LIMIT} of ${FREE_LIMIT} free analyses used`
              : `${usageCount} of ${FREE_LIMIT} free analyses used`}
          </p>
        )}

        {atLimit ? (
          <div className="border border-white/10 rounded-2xl p-8 text-center mt-10">
            <p className="text-lg font-semibold mb-2">You've used all {FREE_LIMIT} free analyses</p>
            <p className="text-sm text-white/40 mb-6">Upgrade to Pro for unlimited breakdowns.</p>
            <Link href="/upgrade" className="inline-block bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition">
              Upgrade to Pro
            </Link>
            <p className="text-xs text-white/20 mt-4">More plans coming soon.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="url"
              placeholder="Paste a YouTube, TikTok, or Instagram link..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
            />

            {url && <Timecode />}

            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/20">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

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

            {isVideoFile && (
              <div className="space-y-1.5">
                <Timecode />
                <p className="text-xs text-white/20">Leave blank to analyze the whole video.</p>
              </div>
            )}

            <input
              type="text"
              placeholder="What do you want to know? (optional) — e.g. how the lighting was done"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
            />

            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-white/30 w-full mb-0.5">Your role (optional) — pick as many as apply</span>
              {DISCIPLINES.map((d) => (
                <button key={d} type="button"
                  onClick={() => setDisciplines(prev => {
                    const next = new Set(prev)
                    next.has(d) ? next.delete(d) : next.add(d)
                    return next
                  })}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    disciplines.has(d) ? 'bg-white text-black border-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
                  }`}>
                  {d}
                </button>
              ))}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={(!url && !file) || loading}
              className="w-full bg-white text-black py-3 rounded-full font-medium hover:bg-white/90 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? 'Analyzing...' : 'Run analysis'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
