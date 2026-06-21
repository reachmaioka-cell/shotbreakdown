import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">ShotBreakdown</span>
        <div className="flex gap-4 items-center">
          <Link href="/library" className="text-sm text-white/60 hover:text-white transition">Library</Link>
          <Link href="/submit" className="text-sm bg-white text-black px-4 py-2 rounded-full font-medium hover:bg-white/90 transition">Submit a Shot</Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-32 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-tight">
          Learn how any shot<br />was made.
        </h1>
        <p className="text-lg text-white/60 mb-10 max-w-xl mx-auto">
          AI tools, camera specs, lighting setups, VFX breakdowns, and step-by-step recreation guides — all in one place.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/library" className="bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition">
            Browse Library
          </Link>
          <Link href="/submit" className="border border-white/20 px-6 py-3 rounded-full text-white/80 hover:border-white/40 hover:text-white transition">
            Submit a Shot
          </Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-32 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: 'AI Tools', desc: 'Higgsfield, Runway, Kling — exact models, prompts, and settings used.' },
          { title: 'Camera & Lenses', desc: 'Camera body, lens, focal length, aperture, shutter speed, ISO.' },
          { title: 'Lighting & VFX', desc: 'Lighting diagrams, equipment list, VFX breakdown, and recreation steps.' },
        ].map((item) => (
          <div key={item.title} className="border border-white/10 rounded-2xl p-6">
            <h3 className="font-semibold mb-2">{item.title}</h3>
            <p className="text-sm text-white/50">{item.desc}</p>
          </div>
        ))}
      </section>
    </main>
  )
}
