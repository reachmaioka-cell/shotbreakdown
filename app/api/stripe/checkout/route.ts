import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

const PRICE_IDS: Record<string, string> = {
  monthly:  process.env.STRIPE_PRICE_MONTHLY!,
  annual:   process.env.STRIPE_PRICE_ANNUAL!,
  team:     process.env.STRIPE_PRICE_TEAM!,
  lifetime: process.env.STRIPE_PRICE_LIFETIME!,
}

const LIFETIME_PLANS = new Set(['lifetime'])
const TEAM_PLANS = new Set(['team'])

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { plan = 'monthly' } = await request.json()
  const priceId = PRICE_IDS[plan]
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  let customerId = profile?.stripe_customer_id as string | undefined
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabase.from('profiles').upsert({ id: user.id, stripe_customer_id: customerId })
  }

  const origin = request.headers.get('origin') ?? 'https://shotbreakdown.vercel.app'
  const isLifetime = LIFETIME_PLANS.has(plan)

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: isLifetime ? 'payment' : 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/upgrade/success?plan=${plan}`,
    cancel_url: `${origin}/upgrade`,
    metadata: { supabase_user_id: user.id, plan },
    ...(TEAM_PLANS.has(plan) && {
      subscription_data: { metadata: { plan: 'team' } },
    }),
  })

  return NextResponse.json({ url: session.url })
}
