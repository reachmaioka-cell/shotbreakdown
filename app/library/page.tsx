import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const TECHNIQUES = ['All', 'AI Generated', 'VFX', 'Real Camera', 'Mixed', 'Animation']
const TOOLS = ['All', 'Higgsfield', 'Runway', 'Kling', 'Midjourney', 'After Effects', 'Unreal Engine']

export default async function LibraryPage() {
  const { data: shots } = await supabase
    .from('shots')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">ShotBreakdown</Link>
        <Link href="/submit" className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition">
          Submit a Shot
        </Link>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-6">Shot Library</h1>

          <input
            type="text"
            placeholder="Search by technique, tool, lens, style..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition mb-6"
          />

          <div className="mb-3">
            <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Technique</p>
            <div className="flex flex-wrap gap-2">
              {TECHNIQUES.map((t) => (
                <button key={t} className="text-sm px-4 py-1.5 rounded-full border border-white/10 text-white/50 hover:border-white/30 hover:text-white transition">
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Tool</p>
            <div className="flex flex-wrap gap-2">
              {TOOLS.map((t) => (
                <button key={t} className="text-sm px-4 py-1.5 rounded-full border border-white/10 text-white/50 hover:border-white/30 hover:text-white transition">
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!shots || shots.length === 0 ? (
          <div className="text-center py-24 text-white/30">
            <p className="text-lg mb-2">No shots yet</p>
            <p className="text-sm mb-6">Be the first to submit one.</p>
            <Link href="/submit" className="text-sm border border-white/20 px-5 py-2.5 rounded-full hover:border-white/40 transition text-white/50">
              Submit a Shot
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shots.map((shot) => (
              <Link key={shot.id} href={`/shot/${shot.id}`}>
                <div className="group border border-white/10 rounded-2xl overflow-hidden hover:border-white/30 transition cursor-pointer">
                  <div className="aspect-video bg-white/5 flex items-center justify-center">
                    {shot.thumbnail_url ? (
                      <img src={shot.thumbnail_url} alt={shot.title} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-white/10 text-sm">No preview</span>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium mb-2 group-hover:text-white/80 transition">{shot.title}</h3>
                    <div className="flex gap-2">
                      {shot.platform && (
                        <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.platform}</span>
                      )}
                      <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/40 capitalize">{shot.status}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
