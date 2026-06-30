'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'

type BreakdownSnap = {
  camera_specs: Record<string, unknown> | null
  ai_tools: Record<string, unknown> | null
  lighting: Record<string, unknown> | null
  camera_movement: Record<string, unknown> | null
  vfx: string[] | null
  tags: string[] | null
  recreation_steps: { step: number; title: string; description: string }[] | null
}

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  source_url: string | null
  created_at: string
  start_time: string | null
  end_time: string | null
  breakdowns: BreakdownSnap[]
}

type ProjectMembership = { shot_id: string; project_name: string; project_id: string }
type Project = { id: string; name: string }
type SortOption = 'newest' | 'oldest' | 'a-z' | 'z-a'

function ytId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  return m ? m[1] : null
}

function tcSecs(t: string | null): number {
  if (!t) return 0
  const [m, s] = t.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

function strVal(obj: Record<string, unknown> | null | undefined, key: string): string {
  const v = obj?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

function FilterRow({ label, options, active, onToggle }: {
  label: string
  options: string[]
  active: Set<string>
  onToggle: (v: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="flex gap-4 items-start">
      <span className="text-xs text-white/25 shrink-0 w-16 mt-1.5 text-right">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button
            key={o}
            onClick={() => onToggle(o)}
            className={`text-xs px-3 py-1 rounded-full border transition capitalize ${
              active.has(o)
                ? 'bg-white text-black border-white'
                : 'border-white/15 text-white/50 hover:border-white/40 hover:text-white'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function LibraryPage() {
  const [shots, setShots] = useState<Shot[]>([])
  const [memberships, setMemberships] = useState<ProjectMembership[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortOption>('newest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [addingToProject, setAddingToProject] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hoveringId, setHoveringId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Record<string, Set<string>>>({})
  const [retrying, setRetrying] = useState<Set<string>>(new Set())

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id

      const [{ data: s }, { data: ps }, { data: p }] = await Promise.all([
        supabase.from('shots')
          .select('*, breakdowns(camera_specs, ai_tools, lighting, camera_movement, vfx, tags, recreation_steps)')
          .eq('user_id', userId ?? '')
          .order('created_at', { ascending: false }),
        supabase.from('project_shots').select('shot_id, project_id, projects(name)'),
        supabase.from('projects').select('id, name').order('name'),
      ])
      if (s) setShots(s as Shot[])
      if (ps) {
        setMemberships((ps as unknown as { shot_id: string; project_id: string; projects: { name: string } }[]).map(row => ({
          shot_id: row.shot_id,
          project_id: row.project_id,
          project_name: row.projects?.name ?? '',
        })))
      }
      if (p) setProjects(p)
      setLoading(false)
    }
    load()
  }, [])

  const toggleFilter = (category: string, value: string) => {
    setActiveFilters(prev => {
      const next = { ...prev }
      const set = new Set(prev[category] ?? [])
      set.has(value) ? set.delete(value) : set.add(value)
      if (set.size === 0) delete next[category]
      else next[category] = set
      return next
    })
  }

  const totalActiveFilters = Object.values(activeFilters).reduce((sum, s) => sum + s.size, 0)

  const shotProjects = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const m of memberships) {
      if (!map[m.shot_id]) map[m.shot_id] = []
      map[m.shot_id].push(m.project_name)
    }
    return map
  }, [memberships])

  const filterOptions = useMemo(() => {
    const cameras = new Set<string>()
    const lenses = new Set<string>()
    const aiPlatforms = new Set<string>()
    const lightingTypes = new Set<string>()
    const movements = new Set<string>()
    const frameRates = new Set<string>()
    const tags = new Set<string>()
    const platforms = new Set<string>()

    for (const shot of shots) {
      if (shot.platform) platforms.add(shot.platform)
      const bd = shot.breakdowns?.[0]
      if (!bd) continue
      const cam = strVal(bd.camera_specs, 'camera')
      if (cam) cameras.add(cam)
      const lens = strVal(bd.camera_specs, 'lens')
      if (lens) lenses.add(lens)
      const fps = strVal(bd.camera_specs, 'frame_rate')
      if (fps) frameRates.add(fps)
      const ai = strVal(bd.ai_tools, 'platform')
      if (ai) aiPlatforms.add(ai)
      const lt = strVal(bd.lighting, 'type')
      if (lt) lightingTypes.add(lt)
      const mv = strVal(bd.camera_movement, 'type')
      if (mv) movements.add(mv)
      for (const t of bd.tags ?? []) if (t) tags.add(t)
    }

    return {
      cameras: [...cameras].sort(),
      lenses: [...lenses].sort(),
      frameRates: [...frameRates].sort(),
      aiPlatforms: [...aiPlatforms].sort(),
      lightingTypes: [...lightingTypes].sort(),
      movements: [...movements].sort(),
      tags: [...tags].sort(),
      platforms: [...platforms].sort(),
    }
  }, [shots])

  const filtered = useMemo(() => {
    const kw = keyword.toLowerCase().trim()
    let list = [...shots]

    if (kw) {
      list = list.filter(s => {
        const bd = s.breakdowns?.[0]
        const haystack = [
          s.title,
          s.platform,
          s.status,
          ...(shotProjects[s.id] ?? []),
          strVal(bd?.camera_specs, 'camera'),
          strVal(bd?.camera_specs, 'lens'),
          strVal(bd?.camera_specs, 'aperture'),
          strVal(bd?.camera_specs, 'frame_rate'),
          strVal(bd?.camera_specs, 'shutter'),
          strVal(bd?.camera_specs, 'iso'),
          strVal(bd?.ai_tools, 'platform'),
          strVal(bd?.ai_tools, 'model'),
          strVal(bd?.ai_tools, 'prompt'),
          strVal(bd?.lighting, 'type'),
          strVal(bd?.lighting, 'key_light'),
          strVal(bd?.lighting, 'fill'),
          strVal(bd?.lighting, 'notes'),
          strVal(bd?.camera_movement, 'type'),
          strVal(bd?.camera_movement, 'notes'),
          ...(bd?.vfx ?? []),
          ...(bd?.tags ?? []),
          ...(bd?.recreation_steps?.map(r => `${r.title} ${r.description}`) ?? []),
        ].join(' ').toLowerCase()
        return haystack.includes(kw)
      })
    }

    const f = activeFilters
    if (f.platform?.size) list = list.filter(s => f.platform.has(s.platform))
    if (f.status?.size) list = list.filter(s => f.status.has(s.status))
    if (f.camera?.size || f.lens?.size || f.fps?.size || f.ai?.size || f.lighting?.size || f.movement?.size || f.tag?.size) {
      list = list.filter(s => {
        const bd = s.breakdowns?.[0]
        if (!bd) return false
        if (f.camera?.size && !f.camera.has(strVal(bd.camera_specs, 'camera'))) return false
        if (f.lens?.size && !f.lens.has(strVal(bd.camera_specs, 'lens'))) return false
        if (f.fps?.size && !f.fps.has(strVal(bd.camera_specs, 'frame_rate'))) return false
        if (f.ai?.size && !f.ai.has(strVal(bd.ai_tools, 'platform'))) return false
        if (f.lighting?.size && !f.lighting.has(strVal(bd.lighting, 'type'))) return false
        if (f.movement?.size && !f.movement.has(strVal(bd.camera_movement, 'type'))) return false
        if (f.tag?.size && !(bd.tags ?? []).some(t => f.tag.has(t))) return false
        return true
      })
    }

    if (sort === 'oldest') list = list.reverse()
    else if (sort === 'a-z') list = list.sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'z-a') list = list.sort((a, b) => b.title.localeCompare(a.title))
    return list
  }, [shots, keyword, sort, shotProjects, activeFilters])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const addSelectedToProject = async (projectId: string) => {
    const rows = Array.from(selected).map(shotId => ({ project_id: projectId, shot_id: shotId }))
    await supabase.from('project_shots').upsert(rows, { onConflict: 'project_id,shot_id' })
    const { data: ps } = await supabase.from('project_shots').select('shot_id, project_id, projects(name)')
    if (ps) {
      setMemberships((ps as unknown as { shot_id: string; project_id: string; projects: { name: string } }[]).map(row => ({
        shot_id: row.shot_id,
        project_id: row.project_id,
        project_name: row.projects?.name ?? '',
      })))
    }
    setSelected(new Set())
    setSelectMode(false)
    setAddingToProject(false)
  }

  const deleteShot = async (shotId: string) => {
    await supabase.from('project_shots').delete().eq('shot_id', shotId)
    await supabase.from('breakdowns').delete().eq('shot_id', shotId)
    await supabase.from('shots').delete().eq('id', shotId)
    setShots(prev => prev.filter(s => s.id !== shotId))
    setMemberships(prev => prev.filter(m => m.shot_id !== shotId))
  }

  const deleteSelected = async () => {
    const ids = Array.from(selected)
    for (const id of ids) {
      await supabase.from('project_shots').delete().eq('shot_id', id)
      await supabase.from('breakdowns').delete().eq('shot_id', id)
      await supabase.from('shots').delete().eq('id', id)
    }
    setShots(prev => prev.filter(s => !selected.has(s.id)))
    setMemberships(prev => prev.filter(m => !selected.has(m.shot_id)))
    setSelected(new Set())
    setSelectMode(false)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar links={[
        { href: '/research', label: 'Research' },
        { href: '/projects', label: 'Projects' },
      ]} cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-6xl mx-auto px-6 py-12">

        <div className="flex items-end justify-between mb-8">
          <h1 className="text-3xl font-bold">Your Library</h1>
          <div className="flex gap-2 items-center">
            {selectMode && selected.size > 0 && (
              <>
                <div className="relative">
                  <button
                    onClick={() => setAddingToProject(!addingToProject)}
                    className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition"
                  >
                    Add {selected.size} to project
                  </button>
                  {addingToProject && (
                    <div className="absolute right-0 top-10 bg-zinc-900 border border-white/10 rounded-xl py-1 w-52 z-10 shadow-xl">
                      {projects.length === 0 ? (
                        <p className="text-xs text-white/30 px-4 py-3">No projects yet — <Link href="/projects" className="underline">create one</Link></p>
                      ) : projects.map(p => (
                        <button key={p.id} onClick={() => addSelectedToProject(p.id)}
                          className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 transition">
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={deleteSelected}
                  className="text-sm border border-red-500/30 text-red-400 px-4 py-2 rounded-full hover:border-red-500/60 hover:text-red-300 transition"
                >
                  Delete {selected.size}
                </button>
              </>
            )}
            <button
              onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); setAddingToProject(false) }}
              className={`text-sm px-4 py-2 rounded-full border transition ${selectMode ? 'border-white text-white' : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'}`}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
          </div>
        </div>

        {/* Search + controls */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search titles, cameras, lenses, AI tools, lighting..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="flex-1 min-w-64 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-sm px-4 py-2.5 rounded-xl border transition ${
              totalActiveFilters > 0 || showFilters
                ? 'border-white text-white'
                : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
            }`}
          >
            Filters{totalActiveFilters > 0 ? ` · ${totalActiveFilters}` : ''}
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/70 focus:outline-none focus:border-white/30 transition cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="a-z">A → Z</option>
            <option value="z-a">Z → A</option>
          </select>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="border border-white/10 rounded-2xl p-5 mb-6 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-white/25 uppercase tracking-widest">Filter by</p>
              {totalActiveFilters > 0 && (
                <button onClick={() => setActiveFilters({})} className="text-xs text-white/30 hover:text-white transition">
                  Clear all
                </button>
              )}
            </div>
            <FilterRow
              label="Platform"
              options={filterOptions.platforms}
              active={activeFilters.platform ?? new Set()}
              onToggle={v => toggleFilter('platform', v)}
            />
            <FilterRow
              label="Status"
              options={['analyzed', 'pending']}
              active={activeFilters.status ?? new Set()}
              onToggle={v => toggleFilter('status', v)}
            />
            <FilterRow
              label="Camera"
              options={filterOptions.cameras}
              active={activeFilters.camera ?? new Set()}
              onToggle={v => toggleFilter('camera', v)}
            />
            <FilterRow
              label="Lens"
              options={filterOptions.lenses}
              active={activeFilters.lens ?? new Set()}
              onToggle={v => toggleFilter('lens', v)}
            />
            <FilterRow
              label="AI Tool"
              options={filterOptions.aiPlatforms}
              active={activeFilters.ai ?? new Set()}
              onToggle={v => toggleFilter('ai', v)}
            />
            <FilterRow
              label="Lighting"
              options={filterOptions.lightingTypes}
              active={activeFilters.lighting ?? new Set()}
              onToggle={v => toggleFilter('lighting', v)}
            />
            <FilterRow
              label="Movement"
              options={filterOptions.movements}
              active={activeFilters.movement ?? new Set()}
              onToggle={v => toggleFilter('movement', v)}
            />
            <FilterRow
              label="Frame rate"
              options={filterOptions.frameRates}
              active={activeFilters.fps ?? new Set()}
              onToggle={v => toggleFilter('fps', v)}
            />
            <FilterRow
              label="Tags"
              options={filterOptions.tags}
              active={activeFilters.tag ?? new Set()}
              onToggle={v => toggleFilter('tag', v)}
            />
          </div>
        )}

        {(keyword || totalActiveFilters > 0) && !loading && (
          <p className="text-xs text-white/25 mb-4">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
        )}

        {loading ? (
          <div className="text-center py-24 text-white/20">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-white/30">
            <p className="text-lg mb-2">{keyword || totalActiveFilters > 0 ? 'No matches' : 'No shots yet'}</p>
            <p className="text-sm mb-6">{keyword || totalActiveFilters > 0 ? 'Try different filters.' : 'Analyze your first shot to get started.'}</p>
            {!keyword && totalActiveFilters === 0 && (
              <Link href="/submit" className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50">
                Analyze a Shot
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((shot) => {
              const projectNames = shotProjects[shot.id] ?? []
              const isSelected = selected.has(shot.id)
              const bd = shot.breakdowns?.[0]
              const camera = strVal(bd?.camera_specs, 'camera')
              const lens = strVal(bd?.camera_specs, 'lens')
              const aiTool = strVal(bd?.ai_tools, 'platform')
              const lighting = strVal(bd?.lighting, 'type')
              const movement = strVal(bd?.camera_movement, 'type')
              const tags = bd?.tags?.slice(0, 4) ?? []

              return (
                <div key={shot.id} className="relative group">
                  {selectMode ? (
                    <button
                      onClick={() => toggleSelect(shot.id)}
                      className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 transition ${
                        isSelected ? 'bg-white border-white' : 'border-white/40 bg-black/40 hover:border-white'
                      }`}
                    />
                  ) : (
                    <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <div className="relative group/rerun">
                        <button
                          onClick={async (e) => {
                            e.preventDefault()
                            setRetrying(prev => new Set([...prev, shot.id]))
                            try {
                              await fetch('/api/analyze', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ shotId: shot.id }),
                              })
                              const { data } = await supabase
                                .from('shots')
                                .select('*, breakdowns(camera_specs, ai_tools, lighting, camera_movement, vfx, tags, recreation_steps)')
                                .eq('id', shot.id)
                                .single()
                              if (data) setShots(prev => prev.map(s => s.id === shot.id ? (data as Shot) : s))
                            } finally {
                              setRetrying(prev => { const n = new Set(prev); n.delete(shot.id); return n })
                            }
                          }}
                          disabled={retrying.has(shot.id)}
                          className="w-7 h-7 rounded-full bg-black/60 text-white/40 hover:text-white hover:bg-black/80 transition flex items-center justify-center text-xs disabled:opacity-40"
                        >
                          {retrying.has(shot.id) ? '…' : '↺'}
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-white/70 text-xs whitespace-nowrap opacity-0 group-hover/rerun:opacity-100 transition">
                          Rerun
                        </span>
                      </div>
                      <div className="relative group/del">
                        <button
                          onClick={(e) => { e.preventDefault(); deleteShot(shot.id) }}
                          className="w-7 h-7 rounded-full bg-black/60 text-white/40 hover:text-red-400 hover:bg-black/80 transition flex items-center justify-center text-xs"
                        >
                          ✕
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-0.5 rounded-md bg-zinc-800 text-white/70 text-xs whitespace-nowrap opacity-0 group-hover/del:opacity-100 transition">
                          Bye
                        </span>
                      </div>
                    </div>
                  )}
                  <Link href={selectMode ? '#' : `/shot/${shot.id}`} onClick={selectMode ? (e) => { e.preventDefault(); toggleSelect(shot.id) } : undefined}>
                    <div className={`border rounded-2xl overflow-hidden transition cursor-pointer ${
                      isSelected ? 'border-white' : 'border-white/10 hover:border-white/30'
                    }`}>
                      <div
                        className="aspect-video bg-white/5 flex items-center justify-center relative overflow-hidden"
                        onMouseEnter={() => setHoveringId(shot.id)}
                        onMouseLeave={() => setHoveringId(null)}
                      >
                        {shot.thumbnail_url ? (
                          <img src={shot.thumbnail_url} alt={shot.title} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <span className="text-white/10 text-sm">No preview</span>
                        )}
                        {hoveringId === shot.id && shot.platform === 'youtube' && shot.source_url && ytId(shot.source_url) && (() => {
                          const start = tcSecs(shot.start_time)
                          const end = tcSecs(shot.end_time)
                          const endParam = end > start ? `&end=${end}` : ''
                          return (
                            <iframe
                              src={`https://www.youtube-nocookie.com/embed/${ytId(shot.source_url)}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&start=${start}${endParam}`}
                              className="absolute inset-0 w-full h-full pointer-events-none"
                              allow="autoplay; encrypted-media"
                            />
                          )
                        })()}
                        {hoveringId === shot.id && shot.platform === 'instagram' && shot.source_url && (() => {
                          const igMatch = shot.source_url.match(/instagram\.com\/(p|reel|tv)\/([^/?]+)/)
                          if (!igMatch) return null
                          const [, igType, shortcode] = igMatch
                          const embedType = igType === 'reel' ? 'reel' : 'p'
                          return (
                            <iframe
                              src={`https://www.instagram.com/${embedType}/${shortcode}/embed/`}
                              className="absolute inset-0 w-full h-full border-0 pointer-events-none"
                              allow="autoplay; encrypted-media"
                            />
                          )
                        })()}
                        {shot.start_time && (
                          <span className="absolute bottom-2 right-2 text-xs bg-black/60 text-white/70 px-1.5 py-0.5 rounded z-10">
                            {shot.start_time}{shot.end_time ? ` – ${shot.end_time}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="font-medium mb-2 group-hover:text-white/80 transition truncate">{shot.title}</h3>
                        {(camera || lens || aiTool || lighting || movement) && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {camera && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{camera}</span>}
                            {lens && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{lens}</span>}
                            {movement && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{movement}</span>}
                            {aiTool && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{aiTool}</span>}
                            {lighting && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{lighting}</span>}
                          </div>
                        )}
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {tags.map(t => (
                              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-white/3 text-white/25 border border-white/8">{t}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap items-center">
                          {shot.platform && (
                            <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.platform}</span>
                          )}
                          <span className={`text-xs px-2 py-1 rounded-full capitalize ${shot.status === 'analyzed' ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/40'}`}>{shot.status}</span>
                          {projectNames.map(name => (
                            <span key={name} className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/60">{name}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
