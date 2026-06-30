import { stripe } from '@/lib/stripe'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const getCustomerId = (obj: Stripe.Subscription | Stripe.Checkout.Session) =>
    typeof obj.customer === 'string' ? obj.customer : obj.customer?.id ?? ''

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.supabase_user_id
      const plan = session.metadata?.plan ?? 'monthly'
      if (userId) {
        await supabase.from('profiles').upsert({
          id: userId,
          is_pro: true,
          plan,
          stripe_customer_id: getCustomerId(session),
        })
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = getCustomerId(sub)
      const isPro = sub.status === 'active' || sub.status === 'trialing'
      const plan = sub.metadata?.plan ?? 'monthly'
      await supabase
        .from('profiles')
        .update({ is_pro: isPro, ...(isPro && { plan }) })
        .eq('stripe_customer_id', customerId)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = getCustomerId(sub)
      await supabase
        .from('profiles')
        .update({ is_pro: false, plan: null })
        .eq('stripe_customer_id', customerId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
