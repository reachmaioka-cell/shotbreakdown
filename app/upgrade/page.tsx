'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

type PlanId = 'monthly' | 'annual' | 'team' | 'lifetime'
type BillingCycle = 'monthly' | 'annual'

const PLANS: {
  id: PlanId
  name: string
  price: string
  subtext: string
  billing: BillingCycle | 'once'
  badge?: string
  features: string[]
  cta: string
  highlight?: boolean
}[] = [
  {
    id: 'monthly',
    name: 'Pro',
    price: '$19.99',
    subtext: 'per month',
    billing: 'monthly',
    features: [
      'Unlimited shot analyses',
      'YouTube, TikTok, Instagram & uploads',
      'Camera, lens, lighting & VFX breakdown',
      'Step-by-step recreation guides',
      'Gemini video analysis for clip ranges',
      'Projects & library organization',
      'Up to 3 devices',
    ],
    cta: 'Get Pro Monthly',
  },
  {
    id: 'annual',
    name: 'Pro Annual',
    price: '$14.99',
    subtext: '$179.99 billed annually',
    billing: 'annual',
    badge: 'Save 25%',
    highlight: true,
    features: [
      'Everything in Pro Monthly',
      'Up to 3 devices',
      '2 months free vs monthly',
    ],
    cta: 'Get Pro Annual',
  },
  {
    id: 'team',
    name: 'Team',
    price: '$49.99',
    subtext: 'per month',
    billing: 'monthly',
    features: [
      'Everything in Pro',
      'Up to 5 team members',
      'Shared team library',
      'Unlimited devices',
      'Priority support',
    ],
    cta: 'Get Team',
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: '$299.99',
    subtext: 'one-time payment',
    billing: 'once',
    badge: 'Limited',
    features: [
      'Everything in Pro, forever',
      'All future updates included',
      'Up to 3 devices',
      'Never pay again',
    ],
    cta: 'Get Lifetime Access',
  },
]

export default function UpgradePage() {
  const [user, setUser] = useState<User | null>(null)
  const [currentPlan, setCurrentPlan] = useState<string | null>(null)
  const [loading, setLoading] = useState<PlanId | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const { data } = await supabase
          .from('profiles')
          .select('plan')
          .eq('id', session.user.id)
          .single()
        setCurrentPlan(data?.plan ?? null)
      }
    })
  }, [])

  const handleCheckout = async (planId: PlanId) => {
    if (!user) { window.location.href = '/auth?next=/upgrade'; return }
    setLoading(planId)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planId }),
    })
    const { url, error } = await res.json()
    if (url) window.location.href = url
    else { console.error(error); setLoading(null) }
  }

  const handlePortal = async () => {
    setLoading('monthly')
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url } = await res.json()
    if (url) window.location.href = url
    else setLoading(null)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-3">Pricing</p>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Break down any shot, at any scale</h1>
          <p className="text-white/50 text-lg max-w-lg mx-auto">
            Start free with 10 analyses. Upgrade for unlimited access.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrentPlan = currentPlan === plan.id
            const isLoadingThis = loading === plan.id

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-6 border transition ${
                  plan.highlight
                    ? 'border-white bg-white/5'
                    : 'border-white/10'
                }`}
              >
                {plan.badge && (
                  <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1 rounded-full ${
                    plan.badge === 'Limited' ? 'bg-amber-500 text-black' : 'bg-white text-black'
                  }`}>
                    {plan.badge}
                  </span>
                )}

                <div className="mb-6">
                  <p className="text-xs text-white/40 font-medium uppercase tracking-widest mb-2">{plan.name}</p>
                  <div className="flex items-end gap-1 mb-1">
                    <span className="text-3xl font-bold">{plan.price}</span>
                  </div>
                  <p className="text-xs text-white/30">{plan.subtext}</p>
                </div>

                <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white/70">
                      <span className="text-green-400 shrink-0 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrentPlan ? (
                  <div className="space-y-2">
                    <div className="w-full bg-green-500/10 text-green-400 py-2.5 rounded-full text-sm font-medium text-center">
                      ✓ Current plan
                    </div>
                    <button
                      onClick={handlePortal}
                      className="w-full border border-white/10 text-white/40 py-2.5 rounded-full text-xs hover:border-white/30 hover:text-white/70 transition"
                    >
                      Manage
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleCheckout(plan.id)}
                    disabled={!!loading}
                    className={`w-full py-2.5 rounded-full text-sm font-medium transition disabled:opacity-40 ${
                      plan.highlight
                        ? 'bg-white text-black hover:bg-white/90'
                        : 'border border-white/20 text-white hover:border-white/50 hover:bg-white/5'
                    }`}
                  >
                    {isLoadingThis ? 'Loading...' : plan.cta}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-xs text-white/20 mt-8">
          All plans include a 10-analysis free trial. Cancel subscriptions anytime.
        </p>
      </div>
    </main>
  )
}
