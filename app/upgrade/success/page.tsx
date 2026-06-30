import Link from 'next/link'
import NavBar from '@/app/_components/NavBar'

export default function SuccessPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar />
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-6">
        <div className="text-5xl mb-6">✓</div>
        <h1 className="text-3xl font-bold mb-3">You're on Pro</h1>
        <p className="text-white/50 mb-10 max-w-sm">
          Unlimited breakdowns, unlocked. Start analyzing shots.
        </p>
        <Link
          href="/submit"
          className="bg-white text-black px-8 py-3.5 rounded-full font-semibold text-sm hover:bg-white/90 transition"
        >
          Analyze a shot
        </Link>
      </div>
    </main>
  )
}
