import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'

export default async function ShotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: shot } = await supabase
    .from('shots')
    .select('*')
    .eq('id', id)
    .single()

  if (!shot) return notFound()

  const { data: breakdown } = await supabase
    .from('breakdowns')
    .select('*')
    .eq('shot_id', id)
    .single()

  const ai = breakdown?.ai_tools
  const cam = breakdown?.camera_specs
  const lighting = breakdown?.lighting
  const vfx = breakdown?.vfx as string[] | null
  const steps = breakdown?.recreation_steps as { step: number; title: string; description: string }[] | null

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">ShotBreakdown</Link>
        <Link href="/library" className="text-sm text-white/50 hover:text-white transition">← Library</Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">

        {/* Thumbnail */}
        <div className="aspect-video bg-white/5 rounded-2xl mb-8 overflow-hidden flex items-center justify-center">
          {shot.thumbnail_url ? (
            <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover" />
          ) : (
            <span className="text-white/20">Shot preview</span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: breakdown */}
          <div className="lg:col-span-2 space-y-8">

            <div>
              <h1 className="text-2xl font-bold mb-1">{shot.title || 'Untitled shot'}</h1>
              <div className="flex gap-2 mt-2 flex-wrap">
                {shot.platform && <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.platform}</span>}
                {shot.start_time && shot.end_time && <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40">{shot.start_time} – {shot.end_time}</span>}
                <span className={`text-xs px-2 py-1 rounded-full ${shot.status === 'analyzed' ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/30'}`}>
                  {shot.status === 'analyzed' ? 'Breakdown ready' : 'Analyzing...'}
                </span>
              </div>
            </div>

            {!breakdown ? (
              <div className="border border-white/10 rounded-xl p-8 text-center text-white/30">
                <p className="mb-1">Breakdown is being generated</p>
                <p className="text-sm">Refresh in a few seconds.</p>
              </div>
            ) : (
              <>
                {/* AI Tools */}
                {ai && (
                  <section>
                    <h2 className="text-sm text-white/30 uppercase tracking-widest mb-4">AI Tools</h2>
                    <div className="border border-white/10 rounded-xl p-5 space-y-3">
                      {ai.platform && <div className="flex justify-between"><span className="text-white/50 text-sm">Platform</span><span className="text-sm font-medium">{ai.platform}</span></div>}
                      {ai.model && <div className="flex justify-between"><span className="text-white/50 text-sm">Model</span><span className="text-sm font-medium">{ai.model}</span></div>}
                      {ai.prompt && (
                        <div className="border-t border-white/5 pt-3">
                          <span className="text-white/50 text-sm block mb-2">Prompt</span>
                          <p className="text-sm bg-white/5 rounded-lg p-3 leading-relaxed">{ai.prompt}</p>
                        </div>
                      )}
                      {ai.steps?.length > 0 && (
                        <div className="border-t border-white/5 pt-3">
                          <span className="text-white/50 text-sm block mb-2">Steps</span>
                          <ol className="text-sm space-y-1.5 list-decimal list-inside text-white/70">
                            {ai.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                          </ol>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Camera & Lens */}
                {cam && (
                  <section>
                    <h2 className="text-sm text-white/30 uppercase tracking-widest mb-4">Camera & Lens</h2>
                    <div className="border border-white/10 rounded-xl p-5 grid grid-cols-2 gap-4">
                      {Object.entries(cam).map(([key, val]) => val ? (
                        <div key={key}>
                          <span className="text-white/30 text-xs block capitalize">{key.replace('_', ' ')}</span>
                          <span className="text-sm font-medium">{String(val)}</span>
                        </div>
                      ) : null)}
                    </div>
                  </section>
                )}

                {/* Lighting */}
                {lighting && (
                  <section>
                    <h2 className="text-sm text-white/30 uppercase tracking-widest mb-4">Lighting</h2>
                    <div className="border border-white/10 rounded-xl p-5 space-y-3">
                      {Object.entries(lighting).map(([key, val]) => val ? (
                        <div key={key} className="flex justify-between gap-4">
                          <span className="text-white/50 text-sm capitalize shrink-0">{key.replace('_', ' ')}</span>
                          <span className="text-sm text-right">{String(val)}</span>
                        </div>
                      ) : null)}
                      <div className="border-t border-white/5 pt-3">
                        <span className="text-white/30 text-xs block mb-2">Lighting diagram</span>
                        <div className="aspect-video bg-white/5 rounded-lg flex items-center justify-center">
                          <span className="text-white/20 text-xs">Diagram coming soon</span>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Recreation steps */}
                {(steps?.length ?? 0) > 0 && (
                  <section>
                    <h2 className="text-sm text-white/30 uppercase tracking-widest mb-4">How to Recreate</h2>
                    <div className="border border-white/10 rounded-xl p-5 space-y-4">
                      {(steps ?? []).map((item) => (
                        <div key={item.step} className="flex gap-4">
                          <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{item.step}</div>
                          <div>
                            <p className="font-medium text-sm mb-0.5">{item.title}</p>
                            <p className="text-sm text-white/50">{item.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {(vfx?.length ?? 0) > 0 && (
              <div className="border border-white/10 rounded-xl p-5">
                <h3 className="font-semibold mb-3">VFX</h3>
                <ul className="text-sm text-white/70 space-y-1.5">
                  {(vfx ?? []).map((v, i) => <li key={i}>• {v}</li>)}
                </ul>
              </div>
            )}

            {shot.source_url && (
              <div className="border border-white/10 rounded-xl p-5">
                <h3 className="font-semibold mb-3">Source</h3>
                <a href={shot.source_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-white/50 hover:text-white transition break-all">
                  {shot.platform === 'youtube' ? 'Watch on YouTube →' : shot.source_url}
                </a>
              </div>
            )}

            <div className="border border-white/10 rounded-xl p-5 text-center">
              <p className="text-sm text-white/50 mb-3">Want full breakdowns?</p>
              <button className="w-full bg-white text-black py-2.5 rounded-full text-sm font-medium hover:bg-white/90 transition">
                Upgrade to Pro
              </button>
              <p className="text-xs text-white/20 mt-2">You have 8 free views left</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
