'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

type NavLink = { href: string; label: string }

interface NavBarProps {
  links?: NavLink[]
  cta?: { href: string; label: string }
}

const DEFAULT_LINKS: NavLink[] = [
  { href: '/featured', label: 'Featured' },
  { href: '/research', label: 'Research' },
  { href: '/projects', label: 'Projects' },
  { href: '/library', label: 'Library' },
]

const DEFAULT_CTA = { href: '/submit', label: 'Analyze a Shot' }

export default function NavBar({ links = DEFAULT_LINKS, cta = DEFAULT_CTA }: NavBarProps) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const signOut = async () => {
    setMenuOpen(false)
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <Link href="/" className="text-xl font-bold tracking-tight">ShotBreakdown</Link>
      <div className="flex gap-4 items-center">
        {links.map(l => (
          <Link key={l.href} href={l.href} className="text-sm text-white/50 hover:text-white transition">
            {l.label}
          </Link>
        ))}
        {cta && (
          <Link href={cta.href} className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition">
            {cta.label}
          </Link>
        )}
        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              title={user.email}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-medium hover:bg-white/20 transition"
            >
              {user.email?.charAt(0).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 bg-zinc-900 border border-white/10 rounded-xl py-1 w-48 z-50 shadow-xl">
                <p className="px-4 py-2 text-xs text-white/30 truncate">{user.email}</p>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={signOut}
                  className="w-full text-left px-4 py-2 text-sm text-white/70 hover:bg-white/5 transition"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/auth" className="text-sm text-white/50 hover:text-white transition">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  )
}
