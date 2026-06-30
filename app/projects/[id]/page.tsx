'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  source_url: string | null
}

type ProjectShot = {
  id: string
  notes: string | null
  shots: Shot
}

type Project = {
  id: string
  name: string
  description: string | null
}

export default function ProjectPage() {
  const params = useParams()
  const projectId = params.id as string

  const [user, setUser] = useState<User | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [projectShots, setProjectShots] = useState<ProjectShot[]>([])
  const [url, setUrl] = useState('')
  const [startMin, setStartMin] = useState('')
  const [startSec, setStartSec] = useState('')
  const [endMin, setEndMin] = useState('')
  const [endSec, setEndSec] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showAddFromLibrary, setShowAddFromLibrary] = useState(false)
  const [libraryShots, setLibraryShots] = useState<Shot[]>([])
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [topPicks, setTopPicks] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)

  const startTime = startMin || startSec ? `${startMin || '0'}:${(startSec || '0').padStart(2, '0')}` : ''
  const endTime = endMin || endSec ? `${endMin || '0'}:${(endSec || '0').padStart(2, '0')}` : ''
  const handleTimeInput = (val: string, max: number) => {
    const digits = val.replace(/\D/g, '').slice(0, 2)
    if (!digits) return ''
    const num = parseInt(digits, 10)
    return num > max ? String(max) : digits
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    supabase.from('projects').select('*').eq('id', projectId).single().then(({ data }) => {
      if (data) setProject(data)
    })
    supabase.from('project_shots').select('id, notes, shots(id, title, platform, status, thumbnail_url, source_url)')
      .eq('project_id', projectId).order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setProjectShots(data as unknown as ProjectShot[]) })
  }, [projectId])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const submitShot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)

    if (startTime && endTime) {
      const toSecs = (t: string) => { const [m, s] = t.split(':').map(Number); return m * 60 + (s || 0) }
      if (toSecs(endTime) <= toSecs(startTime)) {
        setSubmitting(false)
        return
      }
    }

    let title = url
    try {
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
        if (res.ok) { const m = await res.json(); title = m.title || url }
      } else if (url.includes('tiktok.com')) {
        const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}&format=json`)
        if (res.ok) { const m = await res.json(); title = `${m.author_name} — ${m.title || 'TikTok'}` }
      } else if (url.includes('instagram.com')) {
        const match = url.match(/instagram\.com\/([^/?]+)/)
        if (match) title = `@${match[1]} — Instagram`
      }
    } catch { /* keep URL */ }

    const platform = url.includes('youtube') || url.includes('youtu.be') ? 'youtube'
      : url.includes('tiktok') ? 'tiktok'
      : url.includes('instagram') ? 'instagram' : 'other'

    const { data: shot } = await supabase.from('shots')
      .insert({ title, source_url: url, platform, status: 'pending', start_time: startTime || null, end_time: endTime || null, user_id: user?.id ?? null })
      .select().single()

    if (shot) {
      await supabase.from('project_shots').insert({ project_id: projectId, shot_id: shot.id })
      setProjectShots(prev => [{ id: '', notes: null, shots: shot }, ...prev])
      setUrl('')
      setStartMin(''); setStartSec(''); setEndMin(''); setEndSec('')
      fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shotId: shot.id }) })
    }
    setSubmitting(false)
  }

  const removeShot = async (shotId: string) => {
    await supabase.from('project_shots').delete().eq('project_id', projectId).eq('shot_id', shotId)
    setProjectShots(prev => prev.filter(ps => ps.shots.id !== shotId))
    setMenuOpen(null)
  }

  const toggleTopPick = (shotId: string) => {
    setTopPicks(prev => {
      const next = new Set(prev)
      next.has(shotId) ? next.delete(shotId) : next.add(shotId)
      return next
    })
  }

  const addFromLibrary = async (shot: Shot) => {
    const already = projectShots.some(ps => ps.shots.id === shot.id)
    if (already) return
    await supabase.from('project_shots').insert({ project_id: projectId, shot_id: shot.id })
    setProjectShots(prev => [{ id: '', notes: null, shots: shot }, ...prev])
    setShowAddFromLibrary(false)
  }

  const loadLibrary = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const { data } = await supabase.from('shots').select('*')
      .eq('user_id', session?.user?.id ?? '')
      .order('created_at', { ascending: false })
    if (data) setLibraryShots(data)
    setShowAddFromLibrary(true)
  }

  const topPickShots = projectShots.filter(ps => topPicks.has(ps.shots.id))
  const otherShots = projectShots.filter(ps => !topPicks.has(ps.shots.id))

  if (!project) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Loading...</p>
    </main>
  )

  const ShotRow = ({ ps }: { ps: ProjectShot }) => (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 transition group relative">
      {selectMode && (
        <button onClick={() => toggleTopPick(ps.shots.id)}
          className={`w-5 h-5 rounded-full border shrink-0 transition ${topPicks.has(ps.shots.id) ? 'bg-white border-white' : 'border-white/20 hover:border-white/50'}`} />
      )}
      {ps.shots.thumbnail_url ? (
        <img src={ps.shots.thumbnail_url} alt={ps.shots.title} className="w-16 h-10 object-cover rounded-lg shrink-0" />
      ) : (
        <div className="w-16 h-10 bg-white/5 rounded-lg shrink-0" />
      )}
      <Link href={`/shot/${ps.shots.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-white/80 transition">{ps.shots.title}</p>
        <p className="text-xs text-white/30 capitalize mt-0.5">{ps.shots.platform} · {ps.shots.status}</p>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        {/* Three dot menu */}
        <div className="relative" ref={menuOpen === ps.shots.id ? menuRef : null}>
          <button
            onClick={(e) => { e.preventDefault(); setMenuOpen(menuOpen === ps.shots.id ? null : ps.shots.id) }}
            className="text-white/20 hover:text-white/60 transition px-1 py-1 opacity-0 group-hover:opacity-100"
          >
            ···
          </button>
          {menuOpen === ps.shots.id && (
            <div className="absolute right-0 top-7 bg-zinc-900 border border-white/10 rounded-xl py-1 w-36 z-10 shadow-xl">
              <button onClick={() => removeShot(ps.shots.id)}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5 transition">
                bye
              </button>
            </div>
          )}
        </div>
        <Link href={`/shot/${ps.shots.id}`} className="text-white/20 group-hover:text-white/40 transition text-sm">→</Link>
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar links={[
        { href: '/featured', label: 'Featured' },
        { href: '/research', label: 'Research' },
        { href: '/library', label: 'Library' },
        { href: '/projects', label: '← Projects' },
      ]} />

      <div className="max-w-4xl mx-auto px-6 py-12">

        <div className="mb-10">
          <h1 className="text-2xl font-bold mb-1">{project.name}</h1>
          {project.description && <p className="text-white/40 text-sm">{project.description}</p>}
        </div>

        {/* Input row */}
        <form onSubmit={submitShot} className="mb-10 space-y-3">
          <div className="flex gap-3">
            <input type="url"
              placeholder="Paste a YouTube, TikTok, or Instagram link..."
              value={url} onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition text-sm"
            />
            <button type="submit" disabled={!url.trim() || submitting}
              className="bg-white text-black px-5 py-3 rounded-xl text-sm font-medium hover:bg-white/90 transition disabled:opacity-30 shrink-0">
              {submitting ? 'Analyzing...' : 'Analyze'}
            </button>
            <button type="button" onClick={loadLibrary}
              className="border border-white/10 px-5 py-3 rounded-xl text-sm text-white/50 hover:border-white/30 hover:text-white transition shrink-0">
              From library
            </button>
            <button type="button" onClick={() => setSelectMode(!selectMode)}
              className={`border px-5 py-3 rounded-xl text-sm transition shrink-0 ${selectMode ? 'border-white text-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'}`}>
              {selectMode ? 'Done' : 'Selects'}
            </button>
          </div>

          {url && (
            <div className="flex items-center gap-2 pl-1">
              <span className="text-xs text-white/30 shrink-0">Start</span>
              <input type="text" inputMode="numeric" placeholder="0" value={startMin}
                onChange={(e) => setStartMin(handleTimeInput(e.target.value, 99))}
                className="w-10 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-center text-xs focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/30 text-xs">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={startSec}
                onChange={(e) => setStartSec(handleTimeInput(e.target.value, 59))}
                className="w-10 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-center text-xs focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/20 text-xs px-1">→</span>
              <span className="text-xs text-white/30 shrink-0">End</span>
              <input type="text" inputMode="numeric" placeholder="0" value={endMin}
                onChange={(e) => setEndMin(handleTimeInput(e.target.value, 99))}
                className="w-10 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-center text-xs focus:outline-none focus:border-white/30 transition" />
              <span className="text-white/30 text-xs">:</span>
              <input type="text" inputMode="numeric" placeholder="00" value={endSec}
                onChange={(e) => setEndSec(handleTimeInput(e.target.value, 59))}
                className="w-10 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-center text-xs focus:outline-none focus:border-white/30 transition" />
            </div>
          )}
        </form>

        {/* From library panel */}
        {showAddFromLibrary && (
          <div className="border border-white/10 rounded-2xl p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium">Add from library</p>
              <button onClick={() => setShowAddFromLibrary(false)} className="text-white/30 hover:text-white text-sm transition">Close</button>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {libraryShots.map(shot => {
                const added = projectShots.some(ps => ps.shots.id === shot.id)
                return (
                  <div key={shot.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/5 transition">
                    <span className="text-sm text-white/70 truncate mr-4">{shot.title}</span>
                    <button onClick={() => addFromLibrary(shot)} disabled={added}
                      className="text-xs text-white/40 hover:text-white transition shrink-0 disabled:opacity-30">
                      {added ? 'Added' : '+ Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top picks section */}
        {topPickShots.length > 0 && (
          <div className="mb-8">
            <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Top picks</p>
            <div className="space-y-1">
              {topPickShots.map((ps, i) => <ShotRow key={ps.shots.id + i} ps={ps} />)}
            </div>
          </div>
        )}

        {/* All shots */}
        {projectShots.length === 0 ? (
          <div className="text-center py-24 text-white/20">
            <p>No shots yet — paste a link above or add from the library.</p>
          </div>
        ) : (
          <div>
            {topPickShots.length > 0 && <p className="text-xs text-white/30 uppercase tracking-widest mb-3">All shots</p>}
            <div className="space-y-1">
              {otherShots.map((ps, i) => <ShotRow key={ps.shots.id + i} ps={ps} />)}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
