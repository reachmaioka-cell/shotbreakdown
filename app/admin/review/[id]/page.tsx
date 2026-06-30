'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

type Breakdown = {
  ai_tools: Record<string, unknown> | null
  camera_specs: Record<string, unknown> | null
  lighting: Record<string, unknown> | null
  vfx: string[] | null
  recreation_steps: { step: number; title: string; description: string }[] | null
}

type Shot = { id: string; title: string; thumbnail_url: string | null; platform: string; start_time: string | null; end_time: string | null }

type ChatMessage = { role: 'user' | 'assistant'; content: string }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-white/3 border-b border-white/5">
        <p className="text-xs text-white/30 uppercase tracking-widest">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function KV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v && !Array.isArray(v) && typeof v !== 'object')
  if (!entries.length) return <p className="text-white/20 text-sm">No data</p>
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <p className="text-xs text-white/30 capitalize">{k.replace(/_/g, ' ')}</p>
          <p className="text-sm text-white/80">{String(v)}</p>
        </div>
      ))}
    </div>
  )
}

export default function ReviewPage() {
  const { id } = useParams() as { id: string }
  const [shot, setShot] = useState<Shot | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const load = async () => {
      const { data: s } = await supabase.from('shots').select('*').eq('id', id).single()
      if (!s) { setNotFound(true); return }
      setShot(s)
      const { data: b } = await supabase.from('breakdowns').select('*').eq('shot_id', id).single()
      if (b) setBreakdown(b)
    }
    load()
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || sending) return
    const instruction = input.trim()
    setInput('')
    setSending(true)

    setMessages(prev => [...prev, { role: 'user', content: instruction }])

    try {
      const res = await fetch('/api/edit-breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId: id, instruction }),
      })
      const data = await res.json()
      if (data.breakdown) {
        setBreakdown(data.breakdown)
        setMessages(prev => [...prev, { role: 'assistant', content: 'Breakdown updated ✓' }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error ?? 'Something went wrong'}` }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error — try again.' }])
    }

    setSending(false)
    inputRef.current?.focus()
  }

  if (notFound) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Shot not found.</p>
    </main>
  )

  if (!shot) return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Loading...</p>
    </main>
  )

  const cam = breakdown?.camera_specs as Record<string, unknown> | null
  const ai = breakdown?.ai_tools as Record<string, unknown> | null
  const lighting = breakdown?.lighting as Record<string, unknown> | null
  const vfx = breakdown?.vfx as string[] | null
  const steps = breakdown?.recreation_steps as { step: number; title: string; description: string }[] | null

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between shrink-0">
        <Link href="/admin" className="text-sm text-white/40 hover:text-white transition">← Admin</Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/20 bg-white/5 px-3 py-1 rounded-full">Review</span>
          <Link href={`/shot/${id}`} className="text-xs text-white/40 hover:text-white transition">View live →</Link>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">

        {/* Left: breakdown */}
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 border-r border-white/10">
          {/* Shot header */}
          <div>
            {shot.thumbnail_url && (
              <div className="aspect-video rounded-xl overflow-hidden mb-4">
                <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover" />
              </div>
            )}
            <h1 className="text-xl font-bold">{shot.title}</h1>
            <div className="flex gap-2 mt-2">
              <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.platform}</span>
              {shot.start_time && shot.end_time && (
                <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40">{shot.start_time} – {shot.end_time}</span>
              )}
            </div>
          </div>

          {!breakdown ? (
            <div className="border border-white/10 rounded-xl p-8 text-center text-white/20">
              <p className="text-sm">No breakdown yet — still analyzing.</p>
            </div>
          ) : (
            <>
              {cam && (
                <Section title="Camera & Lens">
                  <KV data={cam} />
                </Section>
              )}

              {ai && (
                <Section title="AI Tools">
                  <KV data={ai} />
                  {Array.isArray(ai.steps) && (ai.steps as string[]).length > 0 && (
                    <div className="mt-3 border-t border-white/5 pt-3">
                      <p className="text-xs text-white/30 mb-2">Steps</p>
                      <ol className="text-sm space-y-1 list-decimal list-inside text-white/60">
                        {(ai.steps as string[]).map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    </div>
                  )}
                </Section>
              )}

              {lighting && (
                <Section title="Lighting">
                  <KV data={lighting} />
                </Section>
              )}

              {(vfx?.length ?? 0) > 0 && (
                <Section title="VFX">
                  <ul className="text-sm space-y-1 text-white/60">
                    {(vfx ?? []).map((v, i) => <li key={i}>• {v}</li>)}
                  </ul>
                </Section>
              )}

              {(steps?.length ?? 0) > 0 && (
                <Section title="How to Recreate">
                  <div className="space-y-4">
                    {(steps ?? []).map(item => (
                      <div key={item.step} className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{item.step}</div>
                        <div>
                          <p className="text-sm font-medium mb-0.5">{item.title}</p>
                          <p className="text-sm text-white/50">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Right: chat */}
        <div className="w-96 flex flex-col shrink-0">
          <div className="px-5 py-4 border-b border-white/10 shrink-0">
            <p className="text-sm font-medium">Edit breakdown</p>
            <p className="text-xs text-white/30 mt-0.5">Tell me what to fix and I'll update it.</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <p className="text-xs text-white/20 mb-4">Examples:</p>
                <div className="space-y-2">
                  {[
                    'The camera was ARRI Alexa Mini LF, not a Sony',
                    'This was shot handheld, not on a gimbal',
                    'The lighting was motivated by a window — natural light',
                    'Add a recreation step for the color grade',
                  ].map(ex => (
                    <button
                      key={ex}
                      onClick={() => setInput(ex)}
                      className="block w-full text-left text-xs text-white/30 hover:text-white/60 transition px-3 py-2 rounded-lg hover:bg-white/5"
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                  m.role === 'user'
                    ? 'bg-white text-black'
                    : m.content.startsWith('Error') || m.content.startsWith('Network')
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-white/5 text-white/70'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white/5 px-3 py-2 rounded-xl">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-4 border-t border-white/10 shrink-0">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }}
                placeholder="What needs fixing?"
                rows={2}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition resize-none"
              />
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className="bg-white text-black px-4 rounded-xl text-sm font-medium hover:bg-white/90 transition disabled:opacity-30 shrink-0"
              >
                Send
              </button>
            </div>
            <p className="text-xs text-white/15 mt-2">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      </div>
    </main>
  )
}
