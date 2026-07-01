'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'reachmaioka@gmail.com'

type ImportStatus = 'idle' | 'fetching' | 'inserting' | 'analyzing' | 'done' | 'error'

const DISCIPLINES = ['Director', 'DP / Cinematographer', 'Editor', 'Colorist', 'VFX Artist', 'Producer']

type QueueItem = {
  localId: string
  url: string
  startMin: string
  startSec: string
  endMin: string
  endSec: string
  focus: string
  disciplines: string[]
  customThumbnail: string
}

type ImportRow = {
  localId: string
  url: string
  title: string
  status: ImportStatus
  error?: string
  shotId?: string
}

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  featured: boolean
  created_at: string
}

const STATUS_LABEL: Record<ImportStatus, string> = {
  idle: 'Queued',
  fetching: 'Fetching...',
  inserting: 'Inserting...',
  analyzing: 'Analyzing...',
  done: '✓ Done',
  error: '✗ Error',
}

function timecode(min: string, sec: string) {
  if (!min && !sec) return ''
  return `${min || '0'}:${(sec || '0').padStart(2, '0')}`
}

function handleTimeInput(val: string, max: number) {
  const digits = val.replace(/\D/g, '').slice(0, 2)
  if (!digits) return ''
  const num = parseInt(digits, 10)
  return num > max ? String(max) : digits
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Queue form
  const [newUrl, setNewUrl] = useState('')
  const [newStartMin, setNewStartMin] = useState('')
  const [newStartSec, setNewStartSec] = useState('')
  const [newEndMin, setNewEndMin] = useState('')
  const [newEndSec, setNewEndSec] = useState('')
  const [newFocus, setNewFocus] = useState('')
  const [newDisciplines, setNewDisciplines] = useState<Set<string>>(new Set())
  const [newCustomThumbnail, setNewCustomThumbnail] = useState('')
  const [timeError, setTimeError] = useState('')

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importing, setImporting] = useState(false)

  // Archive
  const [shots, setShots] = useState<Shot[]>([])
  const [shotsLoading, setShotsLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    loadShots()
  }, [])

  const loadShots = async () => {
    setShotsLoading(true)
    const { data } = await supabase.from('shots').select('*').eq('status', 'analyzed').order('created_at', { ascending: false })
    if (data) setShots(data)
    setShotsLoading(false)
  }

  const toggleFeatured = async (shot: Shot) => {
    await supabase.from('shots').update({ featured: !shot.featured }).eq('id', shot.id)
    setShots(prev => prev.map(s => s.id === shot.id ? { ...s, featured: !s.featured } : s))
  }

  const addToQueue = () => {
    if (!newUrl.trim()) return
    setTimeError('')

    const start = timecode(newStartMin, newStartSec)
    const end = timecode(newEndMin, newEndSec)

    if (start && end) {
      const toSecs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + (s || 0) }
      if (toSecs(end) <= toSecs(start)) {
        setTimeError('End time must be after start time.')
        return
      }
    }

    setQueue(prev => [...prev, {
      localId: `${Date.now()}-${Math.random()}`,
      url: newUrl.trim(),
      startMin: newStartMin, startSec: newStartSec,
      endMin: newEndMin, endSec: newEndSec,
      focus: newFocus.trim(),
      disciplines: Array.from(newDisciplines),
      customThumbnail: newCustomThumbnail.trim(),
    }])
    setNewUrl('')
    setNewStartMin(''); setNewStartSec(''); setNewEndMin(''); setNewEndSec('')
    setNewFocus('')
    setNewDisciplines(new Set())
    setNewCustomThumbnail('')
  }

  const removeFromQueue = (localId: string) => {
    setQueue(prev => prev.filter(q => q.localId !== localId))
  }

  const runImport = async () => {
    if (!queue.length) return
    setImporting(true)
    setRows(queue.map(q => ({ localId: q.localId, url: q.url, title: q.url, status: 'idle' })))
    const toProcess = [...queue]
    setQueue([])

    for (let i = 0; i < toProcess.length; i++) {
      const item = toProcess[i]

      setRows(prev => prev.map((r, j) => j === i ? { ...r, status: 'fetching' } : r))

      let title = item.url
      let thumbnail_url: string | null = null
      const platform = item.url.includes('youtube.com') || item.url.includes('youtu.be') ? 'youtube'
        : item.url.includes('tiktok.com') ? 'tiktok'
        : item.url.includes('instagram.com') ? 'instagram' : 'other'

      try {
        if (platform === 'youtube') {
          const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(item.url)}&format=json`)
          if (res.ok) {
            const m = await res.json()
            title = m.title || item.url
            const match = item.url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)
            if (match) thumbnail_url = `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`
          }
        } else if (platform === 'tiktok') {
          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(item.url)}`)
          if (res.ok) { const m = await res.json(); title = `${m.author_name} — ${m.title || 'TikTok'}` }
        } else if (platform === 'instagram') {
          const match = item.url.match(/instagram\.com\/([^/?]+)/)
          if (match) title = `@${match[1]} — Instagram`
        }
      } catch { /* keep url as title */ }

      setRows(prev => prev.map((r, j) => j === i ? { ...r, status: 'inserting', title } : r))

      const startTime = timecode(item.startMin, item.startSec) || null
      const endTime = timecode(item.endMin, item.endSec) || null

      const finalThumbnail = item.customThumbnail || thumbnail_url

      const { data: shot, error } = await supabase
        .from('shots')
        .insert({ title, source_url: item.url, platform, status: 'pending', thumbnail_url: finalThumbnail, user_id: user?.id ?? null, start_time: startTime, end_time: endTime, focus: item.focus || null, discipline: item.disciplines.length > 0 ? item.disciplines.join(', ') : null })
        .select().single()

      if (error || !shot) {
        setRows(prev => prev.map((r, j) => j === i ? { ...r, status: 'error', error: error?.message } : r))
        continue
      }

      setRows(prev => prev.map((r, j) => j === i ? { ...r, status: 'analyzing', shotId: shot.id } : r))

      await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shotId: shot.id,
          focus: item.focus || null,
          discipline: item.disciplines.length > 0 ? item.disciplines.join(', ') : null,
        }),
      })

      setRows(prev => prev.map((r, j) => j === i ? { ...r, status: 'done' } : r))
    }

    setImporting(false)
    setTimeout(loadShots, 8000)
  }

  if (authLoading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Loading...</p>
    </div>
  )

  if (!user || user.email !== ADMIN_EMAIL) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Access denied.</p>
    </div>
  )

  const startTime = timecode(newStartMin, newStartSec)
  const endTime = timecode(newEndMin, newEndSec)

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">ShotBreakdown</Link>
        <span className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full">Admin</span>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-16">

        {/* Quick nav */}
        <section>
          <h2 className="text-xs text-white/25 uppercase tracking-widest mb-4">Admin Tools</h2>
          <Link
            href="/admin/submissions"
            className="inline-flex items-center gap-3 border border-white/10 rounded-xl px-5 py-3.5 hover:border-white/25 transition group"
          >
            <span className="text-sm font-medium">User Submissions</span>
            <span className="text-xs text-white/30">Review all submissions · AI curation scores · promote to public library →</span>
          </Link>
        </section>

        {/* Import section */}
        <section>
          <h2 className="text-xl font-bold mb-1">Import shots</h2>
          <p className="text-sm text-white/40 mb-8">Add shots to the queue with optional timecodes and notes for the AI, then import all at once.</p>

          {/* Add to queue form */}
          <div className="border border-white/10 rounded-2xl p-6 space-y-4">
            <input
              type="url"
              placeholder="YouTube, TikTok, or Instagram URL"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addToQueue()}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
            />

            {/* Timecode */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/30 shrink-0">Start</span>
              <input type="text" inputMode="numeric" placeholder="0" value={newStartMin}
                onChange={e => setNewStartMin(handleTimeInput(e.target.value, 99))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/30 text-sm">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={newStartSec}
                onChange={e => setNewStartSec(handleTimeInput(e.target.value, 59))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/20 text-sm px-1">→</span>
              <span className="text-xs text-white/30 shrink-0">End</span>
              <input type="text" inputMode="numeric" placeholder="0" value={newEndMin}
                onChange={e => setNewEndMin(handleTimeInput(e.target.value, 99))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/30 text-sm">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={newEndSec}
                onChange={e => setNewEndSec(handleTimeInput(e.target.value, 59))}
                className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-white/30 transition" />
              {startTime && endTime && (
                <span className="text-xs text-white/20 ml-1">{startTime} – {endTime}</span>
              )}
            </div>
            {timeError && <p className="text-red-400 text-xs">{timeError}</p>}

            {/* Focus / description */}
            <input
              type="text"
              placeholder="What should the AI focus on? (optional) — e.g. the lighting rig, camera movement, VFX pipeline"
              value={newFocus}
              onChange={e => setNewFocus(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
            />

            {/* Custom thumbnail */}
            <div>
              <p className="text-xs text-white/30 mb-1.5">
                Frame thumbnail URL <span className="text-white/15">(optional — YouTube only serves the cover image by default)</span>
              </p>
              <input
                type="url"
                placeholder="Paste a direct image URL of the specific frame — e.g. from ytscreenshot.com"
                value={newCustomThumbnail}
                onChange={e => setNewCustomThumbnail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-white/30 transition"
              />
              {newCustomThumbnail && (
                <img src={newCustomThumbnail} alt="Thumbnail preview" className="mt-2 h-20 rounded-lg object-cover border border-white/10" />
              )}
            </div>

            {/* Disciplines */}
            <div>
              <p className="text-xs text-white/30 mb-2">Tailor for discipline (optional — pick as many as apply)</p>
              <div className="flex flex-wrap gap-2">
                {DISCIPLINES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNewDisciplines(prev => {
                      const next = new Set(prev)
                      next.has(d) ? next.delete(d) : next.add(d)
                      return next
                    })}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      newDisciplines.has(d)
                        ? 'bg-white text-black border-white'
                        : 'border-white/10 text-white/40 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={addToQueue}
              disabled={!newUrl.trim()}
              className="bg-white/10 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-white/20 transition disabled:opacity-30"
            >
              Add to queue
            </button>
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-white/30">{queue.length} shot{queue.length !== 1 ? 's' : ''} in queue</p>
                <button
                  onClick={runImport}
                  disabled={importing}
                  className="bg-white text-black px-5 py-2 rounded-full text-sm font-medium hover:bg-white/90 transition disabled:opacity-30"
                >
                  {importing ? 'Importing...' : `Import all ${queue.length}`}
                </button>
              </div>
              {queue.map(item => {
                const st = timecode(item.startMin, item.startSec)
                const et = timecode(item.endMin, item.endSec)
                return (
                  <div key={item.localId} className="flex items-start gap-3 border border-white/10 rounded-xl px-4 py-3">
                    {item.customThumbnail && (
                      <img src={item.customThumbnail} alt="" className="w-16 h-10 object-cover rounded-lg shrink-0 border border-white/10" />
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm text-white/70 truncate">{item.url}</p>
                      <div className="flex gap-2 flex-wrap">
                        {st && et && (
                          <span className="text-xs text-white/30">{st} – {et}</span>
                        )}
                        {item.focus && (
                          <span className="text-xs text-white/30 italic">"{item.focus}"</span>
                        )}
                        {item.disciplines.map(d => (
                          <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{d}</span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromQueue(item.localId)}
                      className="text-white/20 hover:text-white/60 transition text-sm shrink-0 mt-0.5"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Import progress */}
          {rows.length > 0 && (
            <div className="mt-6 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-white/5">
                <p className="text-xs text-white/30 uppercase tracking-widest">Import progress</p>
              </div>
              {rows.map((row, i) => (
                <div key={i} className={`flex items-center gap-4 px-4 py-3 text-sm ${i > 0 ? 'border-t border-white/5' : ''}`}>
                  <span className={`shrink-0 text-xs w-24 ${
                    row.status === 'done' ? 'text-green-400'
                    : row.status === 'error' ? 'text-red-400'
                    : row.status === 'idle' ? 'text-white/20'
                    : 'text-white/40'
                  }`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                  <span className="text-white/60 truncate flex-1">{row.title}</span>
                  {row.shotId && (
                    <Link href={`/admin/review/${row.shotId}`} className="text-xs text-white/50 hover:text-white transition shrink-0 font-medium">
                      Review →
                    </Link>
                  )}
                  {row.error && (
                    <span className="text-xs text-red-400/60 shrink-0 truncate max-w-48">{row.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Archive management */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Archive</h2>
              <p className="text-sm text-white/40">Toggle featured status. Featured shots appear in the Featured tab.</p>
            </div>
            <button onClick={loadShots} className="text-xs text-white/30 hover:text-white transition">
              Refresh
            </button>
          </div>

          {shotsLoading ? (
            <p className="text-white/20 text-sm">Loading...</p>
          ) : shots.length === 0 ? (
            <p className="text-white/20 text-sm">No analyzed shots yet.</p>
          ) : (
            <>
              <p className="text-xs text-white/20 mb-4">
                {shots.length} analyzed · {shots.filter(s => s.featured).length} featured
              </p>
              <div className="space-y-1">
                {shots.map(shot => (
                  <div key={shot.id} className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 transition group">
                    {shot.thumbnail_url ? (
                      <img src={shot.thumbnail_url} alt={shot.title} className="w-16 h-10 object-cover rounded-lg shrink-0" />
                    ) : (
                      <div className="w-16 h-10 bg-white/5 rounded-lg shrink-0" />
                    )}
                    <Link href={`/shot/${shot.id}`} className="flex-1 min-w-0">
                      <p className="text-sm truncate group-hover:text-white/80 transition">{shot.title}</p>
                      <p className="text-xs text-white/30 capitalize mt-0.5">{shot.platform}</p>
                    </Link>
                    <Link
                      href={`/admin/review/${shot.id}`}
                      className="text-xs text-white/30 hover:text-white transition shrink-0"
                    >
                      Review
                    </Link>
                    <button
                      onClick={() => toggleFeatured(shot)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition shrink-0 ${
                        shot.featured
                          ? 'border-white text-white bg-white/10'
                          : 'border-white/10 text-white/30 hover:border-white/30 hover:text-white/60'
                      }`}
                    >
                      {shot.featured ? '★ Featured' : '☆ Feature'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
