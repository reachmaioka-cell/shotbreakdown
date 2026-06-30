'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

type Project = { id: string; name: string; description: string | null; created_at: string }

export default function ProjectsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    supabase.from('projects').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) setProjects(data)
    })
  }, [])

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

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar links={[
        { href: '/featured', label: 'Featured' },
        { href: '/research', label: 'Research' },
        { href: '/library', label: 'Library' },
      ]} cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Projects</h1>
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
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-transparent text-lg font-medium placeholder:text-white/20 focus:outline-none mb-3"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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

        {/* Projects list */}
        {projects.length === 0 && !creating ? (
          <div className="text-center py-24 text-white/20">
            <p className="text-lg mb-1">No projects yet</p>
            <p className="text-sm">Create one to start collecting references.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <div className="flex items-center justify-between px-5 py-4 rounded-xl hover:bg-white/5 transition group">
                  <div>
                    <p className="font-medium group-hover:text-white/80 transition">{project.name}</p>
                    {project.description && <p className="text-sm text-white/30 mt-0.5">{project.description}</p>}
                  </div>
                  <span className="text-white/20 text-sm group-hover:text-white/40 transition">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
