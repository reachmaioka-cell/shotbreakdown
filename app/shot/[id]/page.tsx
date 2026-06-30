'use client'

import { useState, useEffect, useRef } from 'react'
import { type ReactNode } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'
import NavBar from '@/app/_components/NavBar'
import type { User } from '@supabase/supabase-js'

const FREE_LIMIT = 10
const DISCIPLINES = ['Director', 'DP', 'Gaffer', 'Editor', 'Colorist', 'VFX Artist', 'Producer']

// Safe string coercion for unknown values from Supabase JSON fields
const s = (v: unknown): string => (v == null ? '' : String(v))

type Shot = {
  id: string; title: string; platform: string; status: string
  thumbnail_url: string | null; source_url: string | null
  start_time: string | null; end_time: string | null
  focus: string | null; discipline: string | null
}
type Breakdown = {
  ai_tools: Record<string, unknown> | null
  camera_specs: Record<string, unknown> | null
  lighting: Record<string, unknown> | null
  camera_movement: Record<string, unknown> | null
  vfx: string[] | null; tags: string[] | null
  recreation_steps: { step: number; title: string; description: string }[] | null
  color_grade: Record<string, unknown> | null
  production_design: Record<string, unknown> | null
  editing: Record<string, unknown> | null
}

type SectionKey = 'camera_specs' | 'camera_movement' | 'lighting' | 'vfx' | 'color_grade' | 'production_design' | 'editing'
const ALL_SECTION_KEYS: SectionKey[] = ['camera_specs', 'camera_movement', 'lighting', 'vfx', 'color_grade', 'production_design', 'editing']
const SECTION_LABELS: Record<SectionKey, string> = {
  camera_specs: 'Camera & Lens', camera_movement: 'Camera Movement', lighting: 'Lighting',
  vfx: 'VFX', color_grade: 'Color Grade', production_design: 'Production Design', editing: 'Editing',
}
const ROLE_PRIMARY: Record<string, SectionKey[]> = {
  'Director':   ['camera_specs', 'lighting', 'camera_movement', 'color_grade'],
  'DP':         ['camera_specs', 'camera_movement', 'lighting'],
  'Gaffer':     ['lighting', 'camera_specs'],
  'Editor':     ['editing', 'camera_movement'],
  'Colorist':   ['color_grade', 'camera_specs'],
  'VFX Artist': ['vfx', 'production_design'],
  'Producer':   ['camera_specs', 'lighting'],
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseTimecodeToSecs(t: string | null): number {
  if (!t) return 0
  const [m, s] = t.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}
function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  return m ? m[1] : null
}

// ─── Instagram embed ──────────────────────────────────────────────────────────

function InstagramEmbed({ url, thumbnailUrl }: { url: string; thumbnailUrl: string | null }) {
  const [active, setActive] = useState(false)
  const match = url.match(/instagram\.com\/(p|reel|tv)\/([^/?]+)/)
  if (!match) return null
  const [, type, shortcode] = match
  const isReel = type === 'reel'
  const embedType = isReel ? 'reel' : 'p'
  const embedUrl = `https://www.instagram.com/${embedType}/${shortcode}/embed/`

  // Reels are 9:16 portrait; posts are ~4:5
  const wrapStyle: React.CSSProperties = isReel
    ? { height: 'min(70vh, 600px)', aspectRatio: '9/16' }
    : { width: '100%', maxWidth: 480, aspectRatio: '4/5' }

  if (active) {
    return (
      <div style={wrapStyle} className="relative overflow-hidden">
        <iframe src={embedUrl} className="w-full h-full border-0" allow="autoplay; encrypted-media" allowFullScreen />
      </div>
    )
  }

  return (
    <div
      style={wrapStyle}
      className="relative overflow-hidden cursor-pointer group"
      onClick={() => setActive(true)}
      onMouseEnter={() => setActive(true)}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="Instagram post" className="w-full h-full object-contain" />
      ) : (
        <div className="w-full h-full bg-white/5 flex items-center justify-center">
          <svg className="w-8 h-8 text-white/20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
        <div className="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
          <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── YouTube embed ────────────────────────────────────────────────────────────

type YTPlayer = {
  seekTo(s: number, a: boolean): void
  playVideo(): void; pauseVideo(): void; getCurrentTime(): number; destroy(): void
}
declare global {
  interface Window {
    YT?: { Player: new (el: string | HTMLElement, opts: object) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

function YoutubeEmbed({ url, startTime, endTime, onReady }: {
  url: string; startTime: string | null; endTime: string | null
  onReady?: (playClip: () => void) => void
}) {
  const containerId = useRef(`yt-${Math.random().toString(36).slice(2, 9)}`)
  const playerRef = useRef<YTPlayer | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const videoId = extractYoutubeId(url)
  const startSecs = parseTimecodeToSecs(startTime)
  const endSecs = parseTimecodeToSecs(endTime)

  useEffect(() => {
    if (!videoId) return
    const init = () => {
      playerRef.current = new window.YT!.Player(containerId.current, {
        videoId, width: '100%', height: '100%',
        playerVars: { start: startSecs, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            onReadyRef.current?.(() => {
              playerRef.current?.seekTo(startSecs, true)
              playerRef.current?.playVideo()
            })
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === 1) {
              if (tickRef.current) clearInterval(tickRef.current)
              tickRef.current = setInterval(() => {
                const t = playerRef.current?.getCurrentTime() ?? 0
                if (endSecs > startSecs && t >= endSecs) {
                  playerRef.current?.pauseVideo()
                  clearInterval(tickRef.current!); tickRef.current = null
                }
              }, 200)
            } else {
              if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
            }
          },
        },
      })
    }
    if (window.YT?.Player) {
      init()
    } else {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prev?.(); init() }
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script')
        s.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(s)
      }
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      playerRef.current?.destroy()
    }
  }, [videoId, startSecs, endSecs])

  if (!videoId) return null
  return <div id={containerId.current} className="w-full h-full" />
}

// ─── Lighting diagram ─────────────────────────────────────────────────────────

const LIGHT_POS: Record<string, [number, number]> = {
  'left': [32, 115], 'right': [288, 115],
  'front-left': [72, 182], 'front-right': [248, 182],
  'overhead': [160, 38], 'top': [160, 38],
  'behind': [160, 38], 'back-left': [72, 48], 'back-right': [248, 48],
}
function LightingDiagram({ lighting }: { lighting: Record<string, unknown> }) {
  const kp = String(lighting.key_light_position ?? '')
  const fp = String(lighting.fill_position ?? '')
  const bp = String(lighting.backlight_position ?? '')
  if (!(kp in LIGHT_POS)) return null
  const subX = 160, subY = 115, camX = 160, camY = 205
  const [kx, ky] = LIGHT_POS[kp]!
  const [fx, fy] = LIGHT_POS[fp] ?? [-99, -99]
  const [bx, by] = LIGHT_POS[bp] ?? [-99, -99]
  const showFill = fp in LIGHT_POS && fp !== 'none'
  const showBack = bp in LIGHT_POS && bp !== 'none'
  return (
    <svg viewBox="0 0 320 230" className="w-full max-w-[200px] mx-auto opacity-70" aria-label="Lighting diagram">
      <rect x="18" y="18" width="284" height="200" rx="6" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      <line x1={kx} y1={ky} x2={subX} y2={subY} stroke="rgba(255,220,100,0.25)" strokeWidth="1.5" strokeDasharray="5,3" />
      {showFill && <line x1={fx} y1={fy} x2={subX} y2={subY} stroke="rgba(150,200,255,0.2)" strokeWidth="1" strokeDasharray="5,3" />}
      {showBack && <line x1={bx} y1={by} x2={subX} y2={subY} stroke="rgba(200,160,255,0.15)" strokeWidth="1" strokeDasharray="5,3" />}
      <line x1={camX} y1={camY - 10} x2={subX} y2={subY + 14} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle cx={subX} cy={subY} r="16" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
      <text x={subX} y={subY + 4} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="sans-serif">Subject</text>
      <polygon points={`${camX},${camY - 9} ${camX - 8},${camY + 6} ${camX + 8},${camY + 6}`} fill="rgba(255,255,255,0.45)" />
      <text x={camX} y={camY + 18} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="sans-serif">Camera</text>
      <circle cx={kx} cy={ky} r="11" fill="rgba(255,220,100,0.12)" stroke="rgba(255,220,100,0.55)" strokeWidth="1.5" />
      <text x={kx} y={ky + 22} textAnchor="middle" fill="rgba(255,220,100,0.55)" fontSize="8" fontFamily="sans-serif">Key</text>
      {showFill && <><circle cx={fx} cy={fy} r="9" fill="rgba(150,200,255,0.1)" stroke="rgba(150,200,255,0.45)" strokeWidth="1.5" /><text x={fx} y={fy + 20} textAnchor="middle" fill="rgba(150,200,255,0.45)" fontSize="8" fontFamily="sans-serif">Fill</text></>}
      {showBack && <><circle cx={bx} cy={by} r="8" fill="rgba(200,160,255,0.1)" stroke="rgba(200,160,255,0.4)" strokeWidth="1.5" /><text x={bx} y={by + 20} textAnchor="middle" fill="rgba(200,160,255,0.4)" fontSize="8" fontFamily="sans-serif">Back</text></>}
    </svg>
  )
}

// ─── Section components ───────────────────────────────────────────────────────

function Card({ children }: { children: ReactNode }) {
  return <div className="border border-white/10 rounded-xl p-5">{children}</div>
}
function SectionWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xs text-white/25 uppercase tracking-widest mb-3">{label}</h2>
      {children}
    </section>
  )
}

function CameraSection({ data }: { data: Record<string, unknown> }) {
  const specs: [string, string][] = [
    ['Aperture', s(data.aperture)],
    ['Shutter', s(data.shutter)],
    ['ISO', s(data.iso)],
    ['FPS', s(data.frame_rate)],
  ].filter(([, v]) => v) as [string, string][]
  return (
    <SectionWrap label="Camera & Lens">
      <Card>
        <p className="text-xl font-semibold leading-tight mb-1">{s(data.camera)}</p>
        <p className="text-base text-white/50 mb-4">{s(data.lens)}</p>
        {specs.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-4 border-t border-white/[0.06]">
            {specs.map(([label, val]) => (
              <div key={label} className="bg-white/[0.04] rounded-lg px-3 py-2">
                <p className="text-xs text-white/25 mb-0.5">{label}</p>
                <p className="text-sm font-medium">{val}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </SectionWrap>
  )
}

function MovementSection({ data }: { data: Record<string, unknown> }) {
  return (
    <SectionWrap label="Camera Movement">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <span className="font-semibold capitalize">{s(data.type)}</span>
          {!!data.speed && <span className="text-xs text-white/30 px-2 py-0.5 rounded-full border border-white/10 capitalize">{s(data.speed)}</span>}
        </div>
        {!!data.notes && <p className="text-sm text-white/50 leading-relaxed">{s(data.notes)}</p>}
      </Card>
    </SectionWrap>
  )
}

function LightingSection({ data }: { data: Record<string, unknown> }) {
  const lights: { label: string; value: string; color: string }[] = [
    { label: 'Key', value: s(data.key_light), color: 'text-amber-400/70' },
    { label: 'Fill', value: s(data.fill), color: 'text-blue-300/60' },
    { label: 'Back', value: s(data.backlight), color: 'text-purple-300/60' },
  ].filter(({ value }) => value && value !== 'none' && value !== 'null')
  return (
    <SectionWrap label="Lighting">
      <div className="border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <LightingDiagram lighting={data} />
        </div>
        <div className="border-t border-white/[0.06] p-5 space-y-3">
          {lights.map(({ label, value, color }) => (
            <div key={label} className="flex gap-3">
              <span className={`text-xs font-semibold uppercase tracking-widest w-8 shrink-0 pt-0.5 ${color}`}>{label}</span>
              <p className="text-sm text-white/70 leading-snug">{value}</p>
            </div>
          ))}
          {!!data.notes && <p className="text-xs text-white/35 pt-3 border-t border-white/[0.06] leading-relaxed">{s(data.notes)}</p>}
        </div>
      </div>
    </SectionWrap>
  )
}

function VFXSection({ items }: { items: string[] }) {
  return (
    <SectionWrap label="VFX">
      <Card>
        <div className="space-y-4">
          {items.map((v, i) => {
            const dashIdx = v.indexOf(' — ')
            const title = dashIdx > -1 ? v.slice(0, dashIdx) : v
            const detail = dashIdx > -1 ? v.slice(dashIdx + 3) : ''
            return (
              <div key={i} className="flex gap-3">
                <span className="text-white/20 text-xs pt-0.5 shrink-0 font-mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p className="text-sm font-medium text-white/80 mb-0.5">{title}</p>
                  {detail && <p className="text-xs text-white/45 leading-relaxed">{detail}</p>}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </SectionWrap>
  )
}

function ColorGradeSection({ data }: { data: Record<string, unknown> }) {
  const tones: [string, string][] = [
    ['Shadows', s(data.shadows)],
    ['Midtones', s(data.midtones)],
    ['Highlights', s(data.highlights)],
  ].filter(([, v]) => v) as [string, string][]
  return (
    <SectionWrap label="Color Grade">
      <Card>
        <p className="text-lg font-semibold mb-0.5">{s(data.style)}</p>
        {!!data.log_profile && <p className="text-sm text-white/35 mb-4">{s(data.log_profile)}</p>}
        {tones.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/[0.06] mb-4">
            {tones.map(([label, val]) => (
              <div key={label} className="bg-white/[0.04] rounded-lg p-3">
                <p className="text-xs text-white/25 mb-1">{label}</p>
                <p className="text-xs text-white/65 leading-snug">{val}</p>
              </div>
            ))}
          </div>
        )}
        {!!data.lut_reference && <p className="text-xs text-white/40 mb-2"><span className="text-white/20">LUT: </span>{s(data.lut_reference)}</p>}
        {!!data.notes && <p className="text-xs text-white/35 border-t border-white/[0.06] pt-3 leading-relaxed">{s(data.notes)}</p>}
      </Card>
    </SectionWrap>
  )
}

function ProductionSection({ data }: { data: Record<string, unknown> }) {
  const keyElements = Array.isArray(data.key_elements) ? (data.key_elements as string[]) : []
  const hasGreenScreen = data.green_screen && !s(data.green_screen).toLowerCase().startsWith('no')
  return (
    <SectionWrap label="Production Design">
      <Card>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {!!data.set_type && <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-white/45 capitalize">{s(data.set_type)}</span>}
          {!!hasGreenScreen && <span className="text-xs px-2.5 py-1 rounded-full border border-green-500/20 text-green-400/60">Green screen</span>}
        </div>
        {!!data.description && <p className="text-sm text-white/65 mb-3 leading-relaxed">{s(data.description)}</p>}
        {!!data.color_palette && <p className="text-xs text-white/40 mb-3"><span className="text-white/20">Palette: </span>{s(data.color_palette)}</p>}
        {keyElements.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-3 border-t border-white/[0.06]">
            {keyElements.map((e, i) => <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-white/[0.04] text-white/40">{e}</span>)}
          </div>
        )}
        {!!data.notes && <p className="text-xs text-white/35 mt-3 pt-3 border-t border-white/[0.06] leading-relaxed">{s(data.notes)}</p>}
      </Card>
    </SectionWrap>
  )
}

function EditingSection({ data }: { data: Record<string, unknown> }) {
  return (
    <SectionWrap label="Editing">
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {!!data.cut_type && <span className="font-medium text-sm capitalize">{s(data.cut_type)}</span>}
          {!!data.pacing && <span className="text-xs text-white/30 px-2 py-0.5 rounded-full border border-white/10 capitalize">{s(data.pacing)}</span>}
        </div>
        <div className="space-y-2 text-sm">
          {!!data.rhythm && <p className="text-white/40 text-xs mb-2">{s(data.rhythm)}</p>}
          {!!data.in_point && <p><span className="text-white/25">In: </span><span className="text-white/65">{s(data.in_point)}</span></p>}
          {!!data.out_point && <p><span className="text-white/25">Out: </span><span className="text-white/65">{s(data.out_point)}</span></p>}
        </div>
        {!!data.notes && <p className="text-xs text-white/35 mt-3 pt-3 border-t border-white/[0.06] leading-relaxed">{s(data.notes)}</p>}
      </Card>
    </SectionWrap>
  )
}

function StepsSection({ steps, role }: { steps: { step: number; title: string; description: string }[]; role: string }) {
  return (
    <SectionWrap label={role && role !== 'All' ? `How to Recreate — ${role}` : 'How to Recreate'}>
      <Card>
        <div className="space-y-4">
          {steps.map((item) => (
            <div key={item.step} className="flex gap-4">
              <div className="w-6 h-6 rounded-full bg-white/[0.07] flex items-center justify-center text-xs font-medium shrink-0 mt-0.5 text-white/30">
                {item.step}
              </div>
              <div>
                <p className="font-medium text-sm mb-0.5">{item.title}</p>
                <p className="text-sm text-white/50 leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </SectionWrap>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ShotPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const [shot, setShot] = useState<Shot | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [usageCount, setUsageCount] = useState(0)
  const [aiExpanded, setAiExpanded] = useState(false)
  const [showReanalyzeForm, setShowReanalyzeForm] = useState(false)
  const [reanalyzeDisciplines, setReanalyzeDisciplines] = useState<Set<string>>(new Set())
  const [reanalyzeFocus, setReanalyzeFocus] = useState('')
  const [reanalyzeError, setReanalyzeError] = useState('')
  const [activeRole, setActiveRole] = useState<string>('All')
  const [showSecondary, setShowSecondary] = useState(false)
  const playClipRef = useRef<(() => void) | null>(null)
  const [playerReady, setPlayerReady] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sb_role')
    if (saved) setActiveRole(saved)
  }, [])

  const setRole = (role: string) => {
    setActiveRole(role)
    setShowSecondary(false)
    localStorage.setItem('sb_role', role)
  }

  const loadData = async () => {
    const { data: s } = await supabase.from('shots').select('*').eq('id', id).single()
    if (!s) { setNotFound(true); return }
    setShot(s)
    try {
      const prev = JSON.parse(localStorage.getItem('sb_viewed') ?? '[]') as string[]
      if (!prev.includes(id)) localStorage.setItem('sb_viewed', JSON.stringify([id, ...prev].slice(0, 100)))
    } catch { /* ignore */ }
    const { data: b } = await supabase.from('breakdowns').select('*').eq('shot_id', id).single()
    setBreakdown(b ?? null)
  }

  useEffect(() => { loadData() }, [id])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const { count } = await supabase.from('shots').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id)
        setUsageCount(count ?? 0)
      }
    })
  }, [])

  const resetAnalyzing = async () => {
    await supabase.from('shots').update({ status: 'analyzed' }).eq('id', id)
    setReanalyzeError('')
    setShowReanalyzeForm(false)
    await loadData()
  }

  useEffect(() => {
    if (!shot || shot.status === 'analyzed') return
    let attempts = 0
    const MAX_ATTEMPTS = 30
    const interval = setInterval(async () => {
      attempts++
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval)
        setReanalyzeError('Analysis timed out — please try again.')
        setShot(prev => prev ? { ...prev, status: 'analyzed' } : null)
        await loadData()
        return
      }
      const { data: s } = await supabase.from('shots').select('*').eq('id', id).single()
      if (!s) return
      setShot(s)
      if (s.status === 'analyzed') {
        const { data: b } = await supabase.from('breakdowns').select('*').eq('shot_id', id).single()
        if (b) setBreakdown(b)
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [shot?.status, id])

  const reanalyze = () => {
    setReanalyzeError('')
    const discipline = reanalyzeDisciplines.size > 0 ? Array.from(reanalyzeDisciplines).join(', ') : null
    const focus = reanalyzeFocus.trim() || null
    setShot(prev => prev ? { ...prev, status: 'pending', discipline, focus } : null)
    setShowReanalyzeForm(false)
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shotId: id, discipline, focus }),
    }).then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setReanalyzeError(body?.error ?? 'Re-analysis failed — please try again.')
      }
      await loadData()
    }).catch(() => {
      setReanalyzeError('Connection error — please try again.')
      loadData()
    })
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
  const lighting = breakdown?.lighting as Record<string, unknown> | null
  const movement = breakdown?.camera_movement as Record<string, unknown> | null
  const vfx = breakdown?.vfx as string[] | null
  const tags = breakdown?.tags as string[] | null
  const steps = breakdown?.recreation_steps as { step: number; title: string; description: string }[] | null
  const colorGrade = breakdown?.color_grade as Record<string, unknown> | null
  const productionDesign = breakdown?.production_design as Record<string, unknown> | null
  const editing = breakdown?.editing as Record<string, unknown> | null
  const ai = breakdown?.ai_tools as Record<string, unknown> | null
  const atLimit = usageCount >= FREE_LIMIT

  const sectionAvailable: Record<SectionKey, boolean> = {
    camera_specs: !!cam,
    camera_movement: !!(movement && Object.values(movement).some(v => v)),
    lighting: !!lighting,
    vfx: !!(vfx?.length),
    color_grade: !!colorGrade,
    production_design: !!productionDesign,
    editing: !!editing,
  }
  const availableKeys = ALL_SECTION_KEYS.filter(k => sectionAvailable[k])
  const primaryKeys = activeRole === 'All'
    ? availableKeys
    : (ROLE_PRIMARY[activeRole] ?? availableKeys).filter(k => sectionAvailable[k])
  const secondaryKeys = availableKeys.filter(k => !primaryKeys.includes(k))

  function renderSection(key: SectionKey) {
    switch (key) {
      case 'camera_specs':       return cam ? <CameraSection key={key} data={cam} /> : null
      case 'camera_movement':    return movement ? <MovementSection key={key} data={movement} /> : null
      case 'lighting':           return lighting ? <LightingSection key={key} data={lighting} /> : null
      case 'vfx':                return vfx?.length ? <VFXSection key={key} items={vfx} /> : null
      case 'color_grade':        return colorGrade ? <ColorGradeSection key={key} data={colorGrade} /> : null
      case 'production_design':  return productionDesign ? <ProductionSection key={key} data={productionDesign} /> : null
      case 'editing':            return editing ? <EditingSection key={key} data={editing} /> : null
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <NavBar links={[
        { href: '/research', label: 'Research' },
        { href: '/projects', label: 'Projects' },
        { href: '/library', label: '← Library' },
      ]} />

      <div className="max-w-5xl mx-auto px-6 py-12">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-white/40 hover:text-white transition mb-8">
          ← Back
        </button>

        {/* Video player */}
        <div className="bg-black rounded-2xl mb-3 overflow-hidden flex items-center justify-center">
          {shot.platform === 'youtube' && shot.source_url ? (
            <div className="w-full aspect-video">
              <YoutubeEmbed
                url={shot.source_url}
                startTime={shot.start_time}
                endTime={shot.end_time}
                onReady={fn => { playClipRef.current = fn; setPlayerReady(true) }}
              />
            </div>
          ) : shot.platform === 'instagram' && shot.source_url ? (
            <InstagramEmbed url={shot.source_url} thumbnailUrl={shot.thumbnail_url} />
          ) : shot.thumbnail_url ? (
            <img src={shot.thumbnail_url} alt={shot.title} className="max-w-full max-h-[70vh] object-contain" />
          ) : (
            <div className="w-full aspect-video flex items-center justify-center">
              <span className="text-white/20">No preview available</span>
            </div>
          )}
        </div>

        {/* Play clip button — outside iframe so clicks always register */}
        {playerReady && shot.start_time && (
          <div className="flex justify-center mb-8">
            <button
              onClick={() => playClipRef.current?.()}
              className="text-sm text-white/45 hover:text-white transition flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 hover:border-white/30"
            >
              ▶ Play {shot.start_time}{shot.end_time ? ` → ${shot.end_time}` : ''}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left: breakdown */}
          <div className="lg:col-span-2 space-y-8">

            {/* Title + status */}
            <div>
              <h1 className="text-2xl font-bold mb-2">{shot.title || 'Untitled shot'}</h1>
              {(tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(tags ?? []).map(t => (
                    <span key={t} className="text-xs px-2.5 py-1 rounded-full border border-white/8 text-white/30">{t}</span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap items-center">
                {shot.platform && <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/35 capitalize">{shot.platform}</span>}
                {shot.start_time && shot.end_time && <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/35">{shot.start_time} – {shot.end_time}</span>}
                <span className={`text-xs px-2 py-1 rounded-full ${shot.status === 'analyzed' ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/30'}`}>
                  {shot.status === 'analyzed' ? 'Breakdown ready' : 'Analyzing...'}
                </span>
                {reanalyzeError && <span className="text-xs text-red-400">{reanalyzeError}</span>}
              </div>
            </div>

            {/* Analyzing spinner */}
            {shot.status !== 'analyzed' && (
              <div className="border border-white/10 rounded-xl p-8 text-center text-white/30">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-sm mb-4">Generating breakdown — this page updates automatically.</p>
                <button onClick={resetAnalyzing} className="text-xs text-white/25 hover:text-white/60 transition underline underline-offset-2">
                  Taking too long? Reset
                </button>
              </div>
            )}

            {shot.status === 'analyzed' && !breakdown && (
              <div className="border border-white/10 rounded-xl p-8 text-center">
                <p className="text-sm text-white/30">No breakdown yet.</p>
              </div>
            )}

            {shot.status === 'analyzed' && breakdown && (
              <>
                {/* Role selector */}
                <div>
                  <p className="text-xs text-white/20 uppercase tracking-widest mb-3">Viewing as</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['All', ...DISCIPLINES].map(role => (
                      <button
                        key={role}
                        onClick={() => setRole(role)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${
                          activeRole === role
                            ? 'bg-white text-black border-white font-medium'
                            : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary sections */}
                <div className="space-y-6">
                  {primaryKeys.map(key => renderSection(key))}
                </div>

                {/* Recreation steps — always visible */}
                {(steps?.length ?? 0) > 0 && (
                  <StepsSection steps={steps!} role={activeRole} />
                )}

                {/* Secondary sections accordion */}
                {secondaryKeys.length > 0 && (
                  <div className="border-t border-white/[0.06] pt-2">
                    <button
                      onClick={() => setShowSecondary(v => !v)}
                      className="w-full flex items-center justify-between py-3 text-left group"
                    >
                      <span className="text-sm text-white/30 group-hover:text-white/55 transition">
                        {showSecondary
                          ? 'Collapse other departments'
                          : `${secondaryKeys.length} more: ${secondaryKeys.map(k => SECTION_LABELS[k]).join(', ')}`}
                      </span>
                      <span className="text-xs text-white/20 group-hover:text-white/40 transition ml-4 shrink-0">{showSecondary ? '↑' : '↓'}</span>
                    </button>
                    {showSecondary && (
                      <div className="space-y-6 mt-2">
                        {secondaryKeys.map(key => renderSection(key))}
                      </div>
                    )}
                  </div>
                )}

                {/* Re-analyze */}
                <div className="border-t border-white/5 pt-4">
                  {!showReanalyzeForm ? (
                    <button
                      onClick={() => {
                        setReanalyzeDisciplines(new Set(shot.discipline?.split(', ').filter(Boolean) ?? []))
                        setReanalyzeFocus(shot.focus ?? '')
                        setShowReanalyzeForm(true)
                      }}
                      className="text-xs text-white/25 hover:text-white/50 transition"
                    >
                      ↺ Re-analyze this shot
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-white/30">Your role</p>
                      <div className="flex flex-wrap gap-1.5">
                        {DISCIPLINES.map(d => (
                          <button key={d} type="button"
                            onClick={() => setReanalyzeDisciplines(prev => {
                              const next = new Set(prev)
                              next.has(d) ? next.delete(d) : next.add(d)
                              return next
                            })}
                            className={`text-xs px-2.5 py-1 rounded-full border transition ${
                              reanalyzeDisciplines.has(d) ? 'bg-white text-black border-white' : 'border-white/15 text-white/50 hover:border-white/40'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        placeholder="Focus note — e.g. how was the lighting done"
                        value={reanalyzeFocus}
                        onChange={e => setReanalyzeFocus(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
                      />
                      {reanalyzeError && <p className="text-xs text-red-400">{reanalyzeError}</p>}
                      <div className="flex gap-2">
                        <button onClick={reanalyze} className="text-xs bg-white text-black px-3 py-1.5 rounded-full font-medium hover:bg-white/90 transition">
                          ↺ Run
                        </button>
                        <button onClick={() => { setShowReanalyzeForm(false); setReanalyzeError('') }} className="text-xs text-white/30 hover:text-white transition px-3 py-1.5">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Recreation — collapsible */}
                {ai && (
                  <div className="border-t border-white/5 pt-2">
                    <button
                      onClick={() => setAiExpanded(v => !v)}
                      className="w-full flex items-center justify-between py-3 text-left group"
                    >
                      <span className="text-sm text-white/30 group-hover:text-white/55 transition">AI Recreation Guide</span>
                      <span className="text-xs text-white/20 group-hover:text-white/40 transition">{aiExpanded ? '↑' : '↓'}</span>
                    </button>
                    {aiExpanded && (
                      <div className="border border-white/10 rounded-xl p-5 space-y-3 mt-1">
                        {!!ai.platform && <div className="flex justify-between"><span className="text-white/35 text-sm">Platform</span><span className="text-sm">{s(ai.platform)}</span></div>}
                        {!!ai.model && <div className="flex justify-between"><span className="text-white/35 text-sm">Model</span><span className="text-sm">{s(ai.model)}</span></div>}
                        {!!ai.prompt && (
                          <div className="border-t border-white/5 pt-3">
                            <p className="text-xs text-white/30 mb-2">Prompt</p>
                            <p className="text-sm bg-white/5 rounded-lg p-3 leading-relaxed text-white/55">{s(ai.prompt)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {shot.source_url && (
              <div className="border border-white/10 rounded-xl p-5">
                <h3 className="text-xs text-white/25 uppercase tracking-widest mb-3">Source</h3>
                <a href={shot.source_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-white/50 hover:text-white transition">
                  {shot.platform === 'youtube' ? 'Watch on YouTube →' : shot.source_url}
                </a>
              </div>
            )}
            {shot.discipline && (
              <div className="border border-white/10 rounded-xl p-5">
                <h3 className="text-xs text-white/25 uppercase tracking-widest mb-3">Analyzed for</h3>
                <div className="flex flex-wrap gap-1.5">
                  {shot.discipline.split(', ').map(d => (
                    <span key={d} className="text-xs px-2 py-1 rounded-full bg-white/5 text-white/45">{d}</span>
                  ))}
                </div>
                {shot.focus && <p className="text-xs text-white/30 mt-2 italic">"{shot.focus}"</p>}
              </div>
            )}
            {user && (
              <div className="border border-white/10 rounded-xl p-5">
                {atLimit ? (
                  <>
                    <p className="text-sm font-semibold mb-1">Free limit reached</p>
                    <p className="text-xs text-white/40 mb-4">Upgrade for unlimited breakdowns.</p>
                    <Link href="/upgrade" className="block w-full bg-white text-black py-2.5 rounded-full text-sm font-medium hover:bg-white/90 transition text-center">
                      Upgrade to Pro
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-white/30 mb-1">{FREE_LIMIT - usageCount} of {FREE_LIMIT} free</p>
                    <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden mb-3">
                      <div className="h-full bg-white/30 rounded-full" style={{ width: `${(usageCount / FREE_LIMIT) * 100}%` }} />
                    </div>
                    <Link href="/upgrade" className="block w-full border border-white/10 text-white/35 py-2 rounded-full text-xs hover:border-white/25 hover:text-white/60 transition text-center">
                      Upgrade to Pro
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
