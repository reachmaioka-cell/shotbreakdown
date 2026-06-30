'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import {
  CAMERA_CATALOG, LENS_CATALOG, AI_CATALOG, LIGHTING_CATALOG,
  type GearCategory, type GearSection,
} from '@/lib/gear'

type Shot = {
  id: string
  title: string
  platform: string
  status: string
  thumbnail_url: string | null
  source_url: string | null
  created_at: string
  likes: number
}

type SortOption = 'newest' | 'oldest' | 'a-z' | 'popular' | 'for-you'

// Build a preference map from the user's viewed shot IDs
function buildPreferences(
  viewedIds: string[],
  bdMap: Record<string, RawBreakdown>,
): Map<string, number> {
  const prefs = new Map<string, number>()
  for (const id of viewedIds) {
    const b = bdMap[id]
    if (!b) continue
    for (const val of [b.camera_specs?.camera, b.ai_tools?.platform, b.lighting?.type]) {
      if (val?.trim()) prefs.set(val.trim(), (prefs.get(val.trim()) ?? 0) + 1)
    }
  }
  return prefs
}

function scoreForYou(b: RawBreakdown | undefined, prefs: Map<string, number>): number {
  if (!b) return 0
  let score = 0
  for (const val of [b.camera_specs?.camera, b.ai_tools?.platform, b.lighting?.type]) {
    if (val?.trim()) score += prefs.get(val.trim()) ?? 0
  }
  return score
}

type RawBreakdown = {
  shot_id: string
  camera_specs: Record<string, string> | null
  ai_tools: Record<string, string> | null
  lighting: Record<string, string> | null
}

type Project = { id: string; name: string }
type FilterKey = 'camera' | 'lens' | 'ai' | 'lighting'
type Filters = Record<FilterKey, Set<string>>

const emptyFilters = (): Filters => ({
  camera: new Set(), lens: new Set(), ai: new Set(), lighting: new Set(),
})

// Loose match: does the breakdown value loosely include the catalog option?
function looseMatch(breakdownVal: string | undefined | null, option: string): boolean {
  if (!breakdownVal) return false
  const bv = breakdownVal.toLowerCase()
  const opt = option.toLowerCase()
  // Strip parenthetical range from lens options like "Wide (16–24mm)" → also try "wide"
  const optBase = opt.replace(/\s*\(.*\)/, '').trim()
  return bv.includes(opt) || bv.includes(optBase) || opt.includes(bv)
}

function matchesFilter(b: RawBreakdown | undefined, key: FilterKey, selected: Set<string>): boolean {
  if (selected.size === 0) return true
  if (!b) return false
  for (const val of selected) {
    if (key === 'camera' && looseMatch(b.camera_specs?.camera, val)) return true
    if (key === 'lens' && looseMatch(b.camera_specs?.lens, val)) return true
    if (key === 'ai' && looseMatch(b.ai_tools?.platform, val)) return true
    if (key === 'lighting' && looseMatch(b.lighting?.type, val)) return true
  }
  return false
}

// Count how many shots in the archive match a given catalog option
function countForOption(
  shots: Shot[],
  bdMap: Record<string, RawBreakdown>,
  key: FilterKey,
  option: string,
): number {
  return shots.filter(s => {
    const b = bdMap[s.id]
    if (!b) return false
    if (key === 'camera') return looseMatch(b.camera_specs?.camera, option)
    if (key === 'lens') return looseMatch(b.camera_specs?.lens, option)
    if (key === 'ai') return looseMatch(b.ai_tools?.platform, option)
    if (key === 'lighting') return looseMatch(b.lighting?.type, option)
    return false
  }).length
}

// ── Filter panel sub-components ──────────────────────────────────────────────

function CameraPanel({
  catalog, counts, selected, onToggle,
}: {
  catalog: GearCategory[]
  counts: Record<string, number>
  selected: Set<string>
  onToggle: (val: string) => void
}) {
  return (
    <div className="space-y-5">
      {catalog.map(cat => (
        <div key={cat.type}>
          <p className="text-xs text-white/20 uppercase tracking-widest mb-2">{cat.type}</p>
          {cat.brands.map(brand => (
            <div key={brand.brand} className="mb-3">
              <p className="text-xs text-white/35 font-medium mb-1 ml-1">{brand.brand}</p>
              <div className="space-y-0.5">
                {brand.models.map(model => {
                  const count = counts[model] ?? 0
                  const isSelected = selected.has(model)
                  return (
                    <button
                      key={model}
                      onClick={() => onToggle(model)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition ${
                        isSelected
                          ? 'bg-white text-black font-medium'
                          : count > 0
                            ? 'hover:bg-white/5 text-white/70'
                            : 'hover:bg-white/3 text-white/25'
                      }`}
                    >
                      <span className="truncate">{model.replace(/^(ARRI|RED|Sony|Canon|Panasonic|Fujifilm|Nikon|Apple|DJI|GoPro|Samsung|Blackmagic|Panavision) /, '')}</span>
                      <span className={`text-xs tabular-nums ml-3 shrink-0 ${isSelected ? 'text-black/40' : count > 0 ? 'text-white/30' : 'text-white/10'}`}>
                        {count > 0 ? count : '—'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function FlatPanel({
  catalog, counts, selected, onToggle,
}: {
  catalog: GearSection[]
  counts: Record<string, number>
  selected: Set<string>
  onToggle: (val: string) => void
}) {
  return (
    <div className="space-y-5">
      {catalog.map(section => (
        <div key={section.type}>
          <p className="text-xs text-white/20 uppercase tracking-widest mb-2">{section.type}</p>
          <div className="space-y-0.5">
            {section.options.map(opt => {
              const count = counts[opt] ?? 0
              const isSelected = selected.has(opt)
              return (
                <button
                  key={opt}
                  onClick={() => onToggle(opt)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left transition ${
                    isSelected
                      ? 'bg-white text-black font-medium'
                      : count > 0
                        ? 'hover:bg-white/5 text-white/70'
                        : 'hover:bg-white/3 text-white/25'
                  }`}
                >
                  <span>{opt}</span>
                  <span className={`text-xs tabular-nums ml-3 shrink-0 ${isSelected ? 'text-black/40' : count > 0 ? 'text-white/30' : 'text-white/10'}`}>
                    {count > 0 ? count : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ResearchPage() {
  const [shots, setShots] = useState<Shot[]>([])
  const [breakdownMap, setBreakdownMap] = useState<Record<string, RawBreakdown>>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters())
  const [openCategory, setOpenCategory] = useState<FilterKey | null>(null)
  const [sort, setSort] = useState<SortOption>('newest')
  const [viewedIds, setViewedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [projectMenuFor, setProjectMenuFor] = useState<string | null>(null)
  const [savingTo, setSavingTo] = useState<string | null>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      const [{ data: s }, { data: b }, { data: p }] = await Promise.all([
        supabase.from('shots').select('*').eq('status', 'analyzed').order('created_at', { ascending: false }),
        supabase.from('breakdowns').select('shot_id, camera_specs, ai_tools, lighting'),
        supabase.from('projects').select('id, name').order('name'),
      ])
      if (s) setShots(s)
      if (b) {
        const map: Record<string, RawBreakdown> = {}
        for (const row of b as RawBreakdown[]) map[row.shot_id] = row
        setBreakdownMap(map)
      }
      if (p) setProjects(p)
      setLoading(false)
    }
    load()
    // Load view history from localStorage for "For You" scoring
    try {
      const stored = JSON.parse(localStorage.getItem('sb_viewed') ?? '[]') as string[]
      setViewedIds(stored)
    } catch { /* ignore */ }
  }, [])

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) {
        setOpenCategory(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const kw = keyword.toLowerCase().trim()

  // Counts per option from all shots (not filtered — shows full catalog potential)
  const cameraCounts = useMemo(() => {
    const c: Record<string, number> = {}
    CAMERA_CATALOG.flatMap(cat => cat.brands.flatMap(b => b.models)).forEach(m => {
      c[m] = countForOption(shots, breakdownMap, 'camera', m)
    })
    return c
  }, [shots, breakdownMap])

  const lensCounts = useMemo(() => {
    const c: Record<string, number> = {}
    LENS_CATALOG.flatMap(s => s.options).forEach(o => {
      c[o] = countForOption(shots, breakdownMap, 'lens', o)
    })
    return c
  }, [shots, breakdownMap])

  const aiCounts = useMemo(() => {
    const c: Record<string, number> = {}
    AI_CATALOG.flatMap(s => s.options).forEach(o => {
      c[o] = countForOption(shots, breakdownMap, 'ai', o)
    })
    return c
  }, [shots, breakdownMap])

  const lightingCounts = useMemo(() => {
    const c: Record<string, number> = {}
    LIGHTING_CATALOG.flatMap(s => s.options).forEach(o => {
      c[o] = countForOption(shots, breakdownMap, 'lighting', o)
    })
    return c
  }, [shots, breakdownMap])

  const preferences = useMemo(
    () => buildPreferences(viewedIds, breakdownMap),
    [viewedIds, breakdownMap],
  )

  const filtered = useMemo(() => {
    let list = shots.filter(shot => {
      const b = breakdownMap[shot.id]
      if (kw) {
        const text = [shot.title, shot.platform, b?.camera_specs?.camera, b?.camera_specs?.lens, b?.ai_tools?.platform, b?.lighting?.type].filter(Boolean).join(' ').toLowerCase()
        if (!text.includes(kw)) return false
      }
      if (!matchesFilter(b, 'camera', filters.camera)) return false
      if (!matchesFilter(b, 'lens', filters.lens)) return false
      if (!matchesFilter(b, 'ai', filters.ai)) return false
      if (!matchesFilter(b, 'lighting', filters.lighting)) return false
      return true
    })
    if (sort === 'oldest') list = [...list].reverse()
    else if (sort === 'a-z') list = [...list].sort((a, b) => a.title.localeCompare(b.title))
    else if (sort === 'popular') list = [...list].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    else if (sort === 'for-you') {
      if (preferences.size > 0) {
        list = [...list].sort((a, b) =>
          scoreForYou(breakdownMap[b.id], preferences) - scoreForYou(breakdownMap[a.id], preferences)
        )
      }
      // if no history yet, leave as newest (default order)
    }
    return list
  }, [shots, breakdownMap, kw, filters, sort, preferences])

  const toggleFilter = (cat: FilterKey, value: string) => {
    setFilters(prev => {
      const next = { ...prev, [cat]: new Set(prev[cat]) }
      next[cat].has(value) ? next[cat].delete(value) : next[cat].add(value)
      return next
    })
  }

  const activeChips = useMemo(() => {
    const LABELS: Record<FilterKey, string> = { camera: 'Camera', lens: 'Lens', ai: 'AI', lighting: 'Lighting' }
    const chips: { cat: FilterKey; label: string; value: string }[] = []
    for (const cat of Object.keys(filters) as FilterKey[]) {
      for (const v of filters[cat]) chips.push({ cat, label: LABELS[cat], value: v })
    }
    return chips
  }, [filters])

  const saveToProject = async (shotId: string, projectId: string) => {
    setSavingTo(shotId)
    await supabase.from('project_shots').upsert({ project_id: projectId, shot_id: shotId }, { onConflict: 'project_id,shot_id' })
    setSavingTo(null)
    setProjectMenuFor(null)
  }

  const FILTER_TABS: { key: FilterKey; label: string }[] = [
    { key: 'camera', label: 'Camera' },
    { key: 'lens', label: 'Lens' },
    { key: 'ai', label: 'AI Tools' },
    { key: 'lighting', label: 'Lighting' },
  ]

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Research</h1>
          <p className="text-white/40 text-sm">Discover shots by gear, technique, or AI tool. Find references you haven't seen yet.</p>
        </div>

        {/* ── Filter bar ────────────────────────────────────────────────── */}
        <div ref={filterBarRef} className="mb-8 space-y-3">

          {/* Keyword */}
          <input
            type="text"
            placeholder="Search by title, director, style..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
          />

          {/* Category buttons */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-white/25 mr-1">Filter by</span>
            {FILTER_TABS.map(({ key, label }) => {
              const count = filters[key].size
              const isOpen = openCategory === key
              return (
                <button
                  key={key}
                  onClick={() => setOpenCategory(isOpen ? null : key)}
                  className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border transition ${
                    count > 0 || isOpen
                      ? 'border-white text-white bg-white/5'
                      : 'border-white/10 text-white/50 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className="bg-white text-black text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                      {count}
                    </span>
                  )}
                  <span className="text-white/20 text-xs">{isOpen ? '▲' : '▼'}</span>
                </button>
              )
            })}
            {activeChips.length > 0 && (
              <button onClick={() => setFilters(emptyFilters())} className="text-xs text-white/30 hover:text-white transition ml-1">
                Clear all
              </button>
            )}
          </div>

          {/* Expanded catalog panel */}
          {openCategory && (
            <div className="border border-white/10 rounded-2xl overflow-hidden bg-zinc-950">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <p className="text-xs text-white/30 uppercase tracking-widest">
                  {FILTER_TABS.find(t => t.key === openCategory)?.label}
                </p>
                <p className="text-xs text-white/20">
                  — = not yet in archive &nbsp;·&nbsp; numbers = clips available
                </p>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto">
                {openCategory === 'camera' && (
                  <CameraPanel
                    catalog={CAMERA_CATALOG}
                    counts={cameraCounts}
                    selected={filters.camera}
                    onToggle={v => toggleFilter('camera', v)}
                  />
                )}
                {openCategory === 'lens' && (
                  <FlatPanel
                    catalog={LENS_CATALOG}
                    counts={lensCounts}
                    selected={filters.lens}
                    onToggle={v => toggleFilter('lens', v)}
                  />
                )}
                {openCategory === 'ai' && (
                  <FlatPanel
                    catalog={AI_CATALOG}
                    counts={aiCounts}
                    selected={filters.ai}
                    onToggle={v => toggleFilter('ai', v)}
                  />
                )}
                {openCategory === 'lighting' && (
                  <FlatPanel
                    catalog={LIGHTING_CATALOG}
                    counts={lightingCounts}
                    selected={filters.lighting}
                    onToggle={v => toggleFilter('lighting', v)}
                  />
                )}
              </div>
            </div>
          )}

          {/* Active chips */}
          {activeChips.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {activeChips.map(({ cat, label, value }) => (
                <button
                  key={`${cat}:${value}`}
                  onClick={() => toggleFilter(cat, value)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/10 text-white/70 hover:bg-white/15 transition"
                >
                  <span className="text-white/30">{label}:</span>
                  {/* Strip brand prefix for cameras */}
                  {value.replace(/^(ARRI|RED|Sony|Canon|Panasonic|Fujifilm|Nikon|Apple|DJI|GoPro|Samsung|Blackmagic|Panavision) /, '')}
                  <span className="text-white/40 ml-0.5">×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm text-white/40">
            {loading ? '' : `${filtered.length} ${filtered.length === 1 ? 'clip' : 'clips'} in archive`}
          </p>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as typeof sort)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/60 focus:outline-none cursor-pointer"
          >
            <option value="for-you">For You</option>
            <option value="popular">Popular</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="a-z">A → Z</option>
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-center py-24 text-white/20">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-white/30">
            <p className="text-lg mb-2">{activeChips.length || kw ? 'No clips in archive yet for this filter' : 'Archive is empty'}</p>
            <p className="text-sm text-white/20 mb-6 max-w-sm mx-auto">
              {activeChips.length || kw
                ? 'The catalog is ready — clips will appear here as the archive grows.'
                : 'Analyses will populate the archive as they\'re submitted.'}
            </p>
            <Link href="/submit" className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50">
              Analyze a Shot
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(shot => {
              const b = breakdownMap[shot.id]
              return (
                <div key={shot.id} className="group border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition">
                  <Link href={`/shot/${shot.id}`}>
                    <div className="aspect-video bg-white/5 flex items-center justify-center">
                      {shot.thumbnail_url ? (
                        <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300" />
                      ) : (
                        <span className="text-white/10 text-sm">No preview</span>
                      )}
                    </div>
                  </Link>
                  <div className="p-4">
                    <Link href={`/shot/${shot.id}`}>
                      <h3 className="font-medium mb-2.5 group-hover:text-white/80 transition truncate">{shot.title}</h3>
                    </Link>
                    <div className="space-y-1 mb-3 min-h-[40px]">
                      {b?.camera_specs?.camera && (
                        <p className="text-xs text-white/50"><span className="text-white/20">Camera </span>{b.camera_specs.camera}</p>
                      )}
                      {b?.camera_specs?.lens && (
                        <p className="text-xs text-white/50"><span className="text-white/20">Lens </span>{b.camera_specs.lens}</p>
                      )}
                      {b?.ai_tools?.platform && (
                        <p className="text-xs text-white/50"><span className="text-white/20">AI </span>{b.ai_tools.platform}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 pt-2 border-t border-white/5">
                      <div className="relative">
                        <button
                          onClick={() => setProjectMenuFor(projectMenuFor === shot.id ? null : shot.id)}
                          className="text-xs text-white/40 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/5"
                        >
                          {savingTo === shot.id ? 'Saving...' : '+ Project'}
                        </button>
                        {projectMenuFor === shot.id && (
                          <div className="absolute left-0 bottom-8 bg-zinc-900 border border-white/10 rounded-xl py-1 w-48 z-10 shadow-xl">
                            {projects.length === 0 ? (
                              <p className="text-xs text-white/30 px-4 py-3">No projects yet</p>
                            ) : projects.map(p => (
                              <button key={p.id} onClick={() => saveToProject(shot.id, p.id)}
                                className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/5 transition">
                                {p.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {shot.source_url && (
                        <a href={shot.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-white/40 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/5">
                          Source →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
