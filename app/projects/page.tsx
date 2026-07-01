'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

type Project = { id: string; name: string; description: string | null; created_at: string }
type ProjectShot = { project_id: string; shot_id: string; created_at: string; shots: { thumbnail_url: string | null } | null }
type ProjectMeta = { thumbnail: string | null; count: number; lastUpdated: string }
type ViewMode = 'grid' | 'list'
type SortMode = 'updated' | 'a-z' | 'z-a'

export default function ProjectsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectMeta, setProjectMeta] = useState<Record<string, ProjectMeta>>({})
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortMode>('updated')
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    loadProjects()
  }, [])

  const loadProjects = async () => {
    const [{ data: p }, { data: ps }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('project_shots').select('project_id, shot_id, created_at, shots(thumbnail_url)').order('created_at', { ascending: true }),
    ])
    if (p) setProjects(p)
    if (ps) {
      const meta: Record<string, ProjectMeta> = {}
      for (const row of ps as unknown as ProjectShot[]) {
        const existing = meta[row.project_id]
        if (!existing) {
          meta[row.project_id] = {
            thumbnail: row.shots?.thumbnail_url ?? null,
            count: 1,
            lastUpdated: row.created_at,
          }
        } else {
          existing.count++
          if (row.created_at > existing.lastUpdated) existing.lastUpdated = row.created_at
        }
      }
      setProjectMeta(meta)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    const { data } = await supabase.from('projects')
      .insert({ name: name.trim(), description: description.trim() || null, user_id: user?.id ?? null })
      .select().single()
    if (data) {
      setProjects([data, ...projects])
      setName('')
      setDescription('')
      setCreating(false)
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const kw = keyword.toLowerCase().trim()
    let list = kw ? projects.filter(p => p.name.toLowerCase().includes(kw) || p.description?.toLowerCase().includes(kw)) : [...projects]
    if (sort === 'a-z') list = list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'z-a') list = list.sort((a, b) => b.name.localeCompare(a.name))
    else list = list.sort((a, b) => {
      const aUp = projectMeta[a.id]?.lastUpdated ?? a.created_at
      const bUp = projectMeta[b.id]?.lastUpdated ?? b.created_at
      return bUp.localeCompare(aUp)
    })
    return list
  }, [projects, projectMeta, keyword, sort])

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />

      <div className="max-w-5xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">My Projects</h1>
          <button
            onClick={() => setCreating(true)}
            className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition"
          >
            New project
          </button>
        </div>

        {/* New project form */}
        {creating && (
          <form onSubmit={handleCreate} className="border border-white/10 rounded-2xl p-6 mb-6">
            <input
              autoFocus
              type="text"
              placeholder="Project name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-transparent text-lg font-medium placeholder:text-white/20 focus:outline-none mb-3"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-transparent text-sm text-white/50 placeholder:text-white/20 focus:outline-none mb-5"
            />
            <div className="flex gap-3">
              <button type="submit" disabled={!name.trim() || loading}
                className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition disabled:opacity-30">
                {loading ? 'Creating...' : 'Create project'}
              </button>
              <button type="button" onClick={() => setCreating(false)}
                className="text-sm text-white/30 hover:text-white transition px-4 py-2">
                Cancel
              </button>
            </div>
          </form>
        )}

        {projects.length === 0 && !creating ? (
          <div className="text-center py-24 text-white/20">
            <p className="text-lg mb-1">No projects yet</p>
            <p className="text-sm">Create one to start collecting references.</p>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex gap-3 mb-6 flex-wrap items-center">
              <input
                type="text"
                placeholder="Search projects..."
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                className="flex-1 min-w-48 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
              />
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortMode)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/70 focus:outline-none transition cursor-pointer"
              >
                <option value="updated">Recent</option>
                <option value="a-z">A → Z</option>
                <option value="z-a">Z → A</option>
              </select>
              <div className="flex border border-white/10 rounded-xl overflow-hidden">
                <button
                  onClick={() => setView('grid')}
                  className={`px-3 py-2.5 text-sm transition ${view === 'grid' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white'}`}
                  title="Grid view"
                >
                  ⊞
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`px-3 py-2.5 text-sm transition border-l border-white/10 ${view === 'list' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white'}`}
                  title="List view"
                >
                  ☰
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="text-white/20 text-sm py-12 text-center">No projects match "{keyword}"</p>
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {filtered.map(project => {
                  const meta = projectMeta[project.id]
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="group border border-white/10 rounded-2xl overflow-hidden hover:border-white/25 transition cursor-pointer">
                        <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                          {meta?.thumbnail ? (
                            <img
                              src={meta.thumbnail}
                              alt={project.name}
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300"
                            />
                          ) : (
                            <span className="text-white/10 text-2xl">◻</span>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="font-medium text-sm truncate group-hover:text-white/80 transition">{project.name}</p>
                          <p className="text-xs text-white/25 mt-0.5">
                            {meta?.count ? `${meta.count} clip${meta.count !== 1 ? 's' : ''}` : 'Empty'}
                          </p>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map(project => {
                  const meta = projectMeta[project.id]
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 transition group cursor-pointer">
                        <div className="w-14 h-9 rounded-lg bg-white/5 overflow-hidden shrink-0">
                          {meta?.thumbnail ? (
                            <img src={meta.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-white/10 text-sm">◻</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm group-hover:text-white/80 transition truncate">{project.name}</p>
                          {project.description && <p className="text-xs text-white/30 truncate mt-0.5">{project.description}</p>}
                        </div>
                        <p className="text-xs text-white/20 shrink-0">
                          {meta?.count ? `${meta.count} clip${meta.count !== 1 ? 's' : ''}` : 'Empty'}
                        </p>
                        <span className="text-white/20 text-sm group-hover:text-white/40 transition">→</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
