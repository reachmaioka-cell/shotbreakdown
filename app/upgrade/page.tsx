'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

export default function UpgradePage() {
  const [user, setUser] = useState<User | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const { data } = await supabase
          .from('profiles')
          .select('is_pro')
          .eq('id', session.user.id)
          .single()
        setIsPro(data?.is_pro ?? false)
      }
    })
  }, [])

  const handleCheckout = async () => {
    if (!user) { window.location.href = '/auth'; return }
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.location.href = url
    else setLoading(false)
  }

  const handlePortal = async () => {
    setLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.location.href = url
    else setLoading(false)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-lg mx-auto px-6 py-24 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-4">Pro</p>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Unlimited breakdowns</h1>
        <p className="text-white/50 mb-12 text-lg">
          Get full access to AI-powered shot analysis — camera, lighting, VFX, color grade, and recreation steps — with no limits.
        </p>

        <div className="border border-white/10 rounded-2xl p-8 mb-6 text-left">
          <div className="flex items-end gap-2 mb-8">
            <span className="text-5xl font-bold">$14.99</span>
            <span className="text-white/40 mb-1.5">/ month</span>
          </div>

          <ul className="space-y-3 mb-8">
            {[
              'Unlimited shot analyses',
              'YouTube, TikTok, Instagram & uploads',
              'Camera, lens, lighting & VFX breakdown',
              'Step-by-step recreation guides',
              'Gemini video analysis for clip ranges',
              'Projects & library organization',
            ].map(f => (
              <li key={f} className="flex items-center gap-3 text-sm text-white/80">
                <span className="text-green-400 shrink-0">✓</span>
                {f}
              </li>
            ))}
          </ul>

          {isPro ? (
            <div className="space-y-3">
              <div className="w-full bg-green-500/10 text-green-400 py-3 rounded-full text-sm font-medium text-center">
                ✓ You're on Pro
              </div>
              <button
                onClick={handlePortal}
                disabled={loading}
                className="w-full border border-white/10 text-white/50 py-3 rounded-full text-sm hover:border-white/30 hover:text-white transition disabled:opacity-40"
              >
                {loading ? 'Loading...' : 'Manage subscription'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full bg-white text-black py-3.5 rounded-full font-semibold text-sm hover:bg-white/90 transition disabled:opacity-40"
            >
              {loading ? 'Loading...' : user ? 'Get Pro' : 'Sign in to get Pro'}
            </button>
          )}
        </div>

        <p className="text-xs text-white/20">Cancel anytime. Billed monthly.</p>
      </div>
    </main>
  )
}
