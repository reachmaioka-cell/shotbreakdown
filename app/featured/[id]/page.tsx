'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

type Collection = {
  id: string
  title: string
  cover_url: string | null
  type: string | null
  description: string | null
}

type Shot = {
  id: string
  title: string
  thumbnail_url: string | null
  platform: string
  source_url: string | null
  start_time: string | null
  end_time: string | null
  breakdowns: { camera_specs: Record<string, string> | null; lighting: Record<string, string> | null; camera_movement: Record<string, string> | null }[]
}

type Project = { id: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  film: 'Film', show: 'TV Show', music_video: 'Music Video', other: 'Other',
}

export default function CollectionPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [user, setUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingShot, setSavingShot] = useState<string | null>(null)
  const [savingTo, setSavingTo] = useState<string | null>(null)
  const [projectMenuFor, setProjectMenuFor] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const currentUser = session?.user ?? null
      setUser(currentUser)

      const [{ data: col }, { data: s }, { data: p }, { data: saved }] = await Promise.all([
        supabase.from('collections').select('*').eq('id', id).single(),
        supabase.from('shots')
          .select('id, title, thumbnail_url, platform, source_url, start_time, end_time, breakdowns(camera_specs, lighting, camera_movement)')
          .eq('collection_id', id)
          .eq('status', 'analyzed')
          .order('created_at', { ascending: true }),
        supabase.from('projects').select('id, name').order('name'),
        currentUser
          ? supabase.from('saved_shots').select('shot_id').eq('user_id', currentUser.id)
          : Promise.resolve({ data: [] }),
      ])
      if (!col) { setNotFound(true); setLoading(false); return }
      setCollection(col)
      setShots((s ?? []) as Shot[])
      if (p) setProjects(p)
      if (saved) setSavedIds(new Set((saved as { shot_id: string }[]).map(r => r.shot_id)))
      setLoading(false)
    }
    load()
  }, [id])

  // Close the save/project menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-save-menu]')) setProjectMenuFor(null)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const toggleSave = async (shotId: string) => {
    if (!user) return
    setSavingShot(shotId)
    if (savedIds.has(shotId)) {
      await supabase.from('saved_shots').delete().eq('user_id', user.id).eq('shot_id', shotId)
      setSavedIds(prev => { const n = new Set(prev); n.delete(shotId); return n })
    } else {
      await supabase.from('saved_shots').insert({ user_id: user.id, shot_id: shotId })
      setSavedIds(prev => new Set([...prev, shotId]))
    }
    setSavingShot(null)
  }

  const saveToProject = async (shotId: string, projectId: string) => {
    setSavingTo(shotId)
    await supabase.from('project_shots').upsert({ project_id: projectId, shot_id: shotId }, { onConflict: 'project_id,shot_id' })
    setSavingTo(null)
    setProjectMenuFor(null)
  }

  if (notFound) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Collection not found.</p>
    </main>
  )

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />

      <div className="max-w-6xl mx-auto px-6 py-12">
        <button onClick={() => router.back()} className="text-sm text-white/40 hover:text-white transition mb-8 flex items-center gap-1">
          ← Featured
        </button>

        {loading ? (
          <div className="text-center py-32 text-white/20">Loading...</div>
        ) : collection && (
          <>
            {/* Header */}
            <div className="flex gap-8 mb-12 items-start">
              {collection.cover_url && (
                <div className="w-56 shrink-0 aspect-video rounded-xl overflow-hidden bg-white/5">
                  <img src={collection.cover_url} alt={collection.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="pt-2">
                {collection.type && (
                  <p className="text-xs text-white/30 uppercase tracking-widest mb-2">{TYPE_LABEL[collection.type] ?? collection.type}</p>
                )}
                <h1 className="text-4xl font-bold mb-3">{collection.title}</h1>
                {collection.description && (
                  <p className="text-white/50 text-sm leading-relaxed max-w-lg">{collection.description}</p>
                )}
                <p className="text-xs text-white/25 mt-4">{shots.length} shot breakdown{shots.length !== 1 ? 's' : ''}</p>
                {!user && (
                  <Link href="/auth" className="text-xs text-white/30 hover:text-white transition underline underline-offset-2 mt-2 inline-block">
                    Sign in to save shots to your library
                  </Link>
                )}
              </div>
            </div>

            {/* Shots grid */}
            {shots.length === 0 ? (
              <div className="text-center py-24 text-white/20">
                <p>No breakdowns added to this collection yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {shots.map(shot => {
                  const bd = shot.breakdowns?.[0]
                  const camera = bd?.camera_specs?.camera ?? ''
                  const lighting = bd?.lighting?.type ?? ''
                  const movement = bd?.camera_movement?.type ?? ''
                  const isSaved = savedIds.has(shot.id)
                  return (
                    <div key={shot.id} className="group border border-white/10 rounded-2xl overflow-hidden hover:border-white/30 transition">
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
                          <h3 className="font-medium mb-2 truncate group-hover:text-white/80 transition">{shot.title}</h3>
                        </Link>
                        <div className="flex flex-wrap gap-1">
                          {camera && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">{camera}</span>}
                          {lighting && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{lighting}</span>}
                          {movement && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 capitalize">{movement}</span>}
                          {shot.start_time && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/30">{shot.start_time}{shot.end_time ? ` – ${shot.end_time}` : ''}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 pt-2 mt-2 border-t border-white/5">
                          {user ? (
                            <div className="relative" data-save-menu>
                              <button
                                onClick={() => setProjectMenuFor(projectMenuFor === shot.id ? null : shot.id)}
                                disabled={savingShot === shot.id}
                                className={`text-xs px-2 py-1 rounded-lg transition hover:bg-white/5 ${
                                  isSaved ? 'text-white/70 hover:text-white/40' : 'text-white/40 hover:text-white'
                                }`}
                              >
                                {savingShot === shot.id ? '...' : isSaved ? '✓ Saved ▾' : '+ Save ▾'}
                              </button>
                              {projectMenuFor === shot.id && (
                                <div className="absolute left-0 bottom-8 bg-zinc-900 border border-white/10 rounded-xl py-1 w-52 z-10 shadow-xl">
                                  <button
                                    onClick={async () => { await toggleSave(shot.id); setProjectMenuFor(null) }}
                                    className={`w-full text-left px-4 py-2.5 text-sm transition border-b border-white/5 ${
                                      isSaved ? 'text-white/40 hover:bg-white/5' : 'text-white/80 hover:bg-white/5'
                                    }`}
                                  >
                                    {isSaved ? 'Remove from Library' : '+ My Library'}
                                  </button>
                                  {projects.length > 0 && (
                                    <>
                                      <p className="text-xs text-white/20 px-4 pt-2 pb-1">Add to project</p>
                                      {projects.map(p => (
                                        <button
                                          key={p.id}
                                          disabled={savingTo === shot.id}
                                          onClick={async () => { await saveToProject(shot.id, p.id); setProjectMenuFor(null) }}
                                          className="w-full text-left px-4 py-2.5 text-sm text-white/60 hover:bg-white/5 transition disabled:opacity-40"
                                        >
                                          {p.name}
                                        </button>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <Link href="/auth" className="text-xs text-white/30 hover:text-white transition px-2 py-1 rounded-lg hover:bg-white/5">
                              Sign in to save
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
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
