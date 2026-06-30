import Link from 'next/link'
import NavBar from './_components/NavBar'
import LandingGallery from './_components/LandingGallery'

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar cta={{ href: '/submit', label: 'Analyze a Shot' }} />

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-28 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-tight">
          Learn how any shot<br />was made.
        </h1>
        <p className="text-lg text-white/60 mb-4 max-w-xl mx-auto">
          AI tools, camera specs, lighting setups, VFX breakdowns, and step-by-step recreation guides — all in one place.
        </p>
        <p className="text-sm text-white/25 mb-10 max-w-md mx-auto">
          Our best guess ¯\_(ツ)_/¯ — but it's a place to start.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/featured" className="bg-white text-black px-6 py-3 rounded-full font-medium hover:bg-white/90 transition">
            Browse Featured
          </Link>
          <Link href="/submit" className="border border-white/20 px-6 py-3 rounded-full text-white/80 hover:border-white/40 hover:text-white transition">
            Analyze a Shot
          </Link>
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-5xl mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
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

      {/* Recent breakdowns gallery */}
      <LandingGallery />
    </main>
  )
}
