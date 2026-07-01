'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'reachmaioka@gmail.com'
const TYPES = ['film', 'show', 'music_video', 'other']
const TYPE_LABEL: Record<string, string> = {
  film: 'Film', show: 'TV Show', music_video: 'Music Video', other: 'Other',
}

type Collection = {
  id: string
  title: string
  cover_url: string | null
  type: string | null
  description: string | null
  is_featured: boolean
  created_at: string
}

type Shot = {
  id: string
  title: string
  thumbnail_url: string | null
  collection_id: string | null
  status: string
}

export default function CollectionsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [collections, setCollections] = useState<Collection[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)

  // Create form
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCover, setNewCover] = useState('')
  const [newType, setNewType] = useState('film')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // Assign shots
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from('collections').select('*').order('created_at', { ascending: false }),
      supabase.from('shots').select('id, title, thumbnail_url, collection_id, status').eq('status', 'analyzed').order('created_at', { ascending: false }),
    ])
    if (c) setCollections(c)
    if (s) setShots(s)
    setLoading(false)
  }

  const createCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setSaving(true)
    const { data } = await supabase.from('collections')
      .insert({ title: newTitle.trim(), cover_url: newCover.trim() || null, type: newType, description: newDesc.trim() || null })
      .select().single()
    if (data) setCollections(prev => [data, ...prev])
    setNewTitle(''); setNewCover(''); setNewDesc(''); setCreating(false)
    setSaving(false)
  }

  const toggleFeatured = async (col: Collection) => {
    await supabase.from('collections').update({ is_featured: !col.is_featured }).eq('id', col.id)
    setCollections(prev => prev.map(c => c.id === col.id ? { ...c, is_featured: !c.is_featured } : c))
  }

  const deleteCollection = async (id: string) => {
    await supabase.from('shots').update({ collection_id: null }).eq('collection_id', id)
    await supabase.from('collections').delete().eq('id', id)
    setCollections(prev => prev.filter(c => c.id !== id))
    setShots(prev => prev.map(s => s.collection_id === id ? { ...s, collection_id: null } : s))
  }

  const assignShot = async (shotId: string, collectionId: string | null) => {
    await supabase.from('shots').update({ collection_id: collectionId }).eq('id', shotId)
    setShots(prev => prev.map(s => s.id === shotId ? { ...s, collection_id: collectionId } : s))
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

  const unassigned = shots.filter(s => !s.collection_id)

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/admin" className="text-sm text-white/40 hover:text-white transition">← Admin</Link>
        <span className="text-white/15">|</span>
        <span className="text-sm font-medium">Featured Collections</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* Create */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Collections</h2>
            <button
              onClick={() => setCreating(!creating)}
              className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition"
            >
              + New Collection
            </button>
          </div>

          {creating && (
            <form onSubmit={createCollection} className="border border-white/10 rounded-2xl p-6 mb-6 space-y-4">
              <input
                autoFocus
                type="text"
                placeholder="Title (e.g. Blade Runner 2049)"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
              />
              <div className="flex gap-3">
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/70 focus:outline-none transition cursor-pointer"
                >
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
                <input
                  type="url"
                  placeholder="Cover image URL (poster, thumbnail...)"
                  value={newCover}
                  onChange={e => setNewCover(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
                />
              </div>
              {newCover && (
                <img src={newCover} alt="Cover preview" className="h-32 rounded-xl object-cover border border-white/10" />
              )}
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
              />
              <div className="flex gap-3">
                <button type="submit" disabled={!newTitle.trim() || saving}
                  className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition disabled:opacity-30">
                  {saving ? 'Creating...' : 'Create'}
                </button>
                <button type="button" onClick={() => setCreating(false)} className="text-sm text-white/30 hover:text-white transition">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Collections list */}
          {loading ? (
            <p className="text-white/20 text-sm">Loading...</p>
          ) : collections.length === 0 ? (
            <p className="text-white/20 text-sm">No collections yet.</p>
          ) : (
            <div className="space-y-3">
              {collections.map(col => {
                const colShots = shots.filter(s => s.collection_id === col.id)
                const isExpanded = expandedId === col.id
                return (
                  <div key={col.id} className="border border-white/10 rounded-2xl overflow-hidden">
                    {/* Collection header */}
                    <div className="flex items-center gap-4 px-5 py-4">
                      {col.cover_url ? (
                        <img src={col.cover_url} alt={col.title} className="w-12 h-16 object-cover rounded-lg shrink-0" />
                      ) : (
                        <div className="w-12 h-16 bg-white/5 rounded-lg shrink-0 flex items-center justify-center">
                          <span className="text-white/10 text-xs">No img</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-medium truncate">{col.title}</p>
                          {col.is_featured && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">★ Featured</span>}
                        </div>
                        <p className="text-xs text-white/30">{TYPE_LABEL[col.type ?? ''] ?? col.type} · {colShots.length} shot{colShots.length !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : col.id)}
                          className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/40 hover:border-white/30 hover:text-white transition"
                        >
                          {isExpanded ? 'Close' : 'Assign shots'}
                        </button>
                        <button
                          onClick={() => toggleFeatured(col)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition ${
                            col.is_featured
                              ? 'border-amber-500/30 text-amber-400 bg-amber-500/10 hover:text-amber-400/60'
                              : 'border-white/10 text-white/30 hover:border-white/30 hover:text-white/60'
                          }`}
                        >
                          {col.is_featured ? '★ Featured' : '☆ Feature'}
                        </button>
                        <Link href={`/featured/${col.id}`} className="text-xs text-white/30 hover:text-white transition px-2">
                          View →
                        </Link>
                        <button
                          onClick={() => deleteCollection(col.id)}
                          className="text-xs text-white/20 hover:text-red-400 transition px-2"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Shot assignment panel */}
                    {isExpanded && (
                      <div className="border-t border-white/10 p-5">
                        {/* Shots in this collection */}
                        {colShots.length > 0 && (
                          <div className="mb-5">
                            <p className="text-xs text-white/25 uppercase tracking-widest mb-3">In this collection</p>
                            <div className="space-y-1">
                              {colShots.map(shot => (
                                <div key={shot.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/3">
                                  {shot.thumbnail_url && (
                                    <img src={shot.thumbnail_url} alt={shot.title} className="w-12 h-7 object-cover rounded shrink-0" />
                                  )}
                                  <p className="text-sm flex-1 truncate text-white/70">{shot.title}</p>
                                  <button
                                    onClick={() => assignShot(shot.id, null)}
                                    className="text-xs text-white/25 hover:text-red-400 transition shrink-0"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Unassigned shots */}
                        {unassigned.length > 0 && (
                          <div>
                            <p className="text-xs text-white/25 uppercase tracking-widest mb-3">Add from unassigned shots</p>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {unassigned.map(shot => (
                                <div key={shot.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/3">
                                  {shot.thumbnail_url && (
                                    <img src={shot.thumbnail_url} alt={shot.title} className="w-12 h-7 object-cover rounded shrink-0" />
                                  )}
                                  <p className="text-sm flex-1 truncate text-white/50">{shot.title}</p>
                                  <button
                                    onClick={() => assignShot(shot.id, col.id)}
                                    className="text-xs text-white/40 hover:text-white transition shrink-0 px-3 py-1 rounded-full border border-white/10 hover:border-white/30"
                                  >
                                    + Add
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {colShots.length === 0 && unassigned.length === 0 && (
                          <p className="text-sm text-white/20">All shots are assigned to other collections.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
