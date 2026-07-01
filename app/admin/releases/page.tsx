'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'reachmaioka@gmail.com'
const TODAY = '2026-07-01'

type ReleaseType = 'film' | 'show' | 'music_video'
type SortKey = 'title' | 'type' | 'date' | 'buzz'
type SortDir = 'asc' | 'desc'
type Confidence = 'confirmed' | 'estimated' | 'unknown'
type SuggestedClip = { title: string; startTime: string; endTime: string; focus: string }

type Release = {
  id: string
  title: string
  artist?: string
  type: ReleaseType
  genre: string
  category: string
  releaseDate: string
  buzz: number
  buzzDelta?: number  // positive = up vs prior month, negative = down, 0 = flat
  description: string
  sourceUrl?: string
  isEstimated: boolean
  confirmedSource?: string
}

type DrawerShot = {
  id: string
  title: string
  thumbnail_url: string | null
  platform: string
  is_curated: boolean
  collection_id: string | null
  start_time: string | null
  end_time: string | null
  breakdowns: {
    camera_specs: Record<string, string> | null
    lighting: Record<string, string> | null
    camera_movement: Record<string, string> | null
  }[]
}

const TYPE_LABEL: Record<ReleaseType, string> = {
  film: 'Film',
  show: 'TV Show',
  music_video: 'Music Video',
}

function getFallbackUrl(release: Release): string {
  const q = release.type === 'show'
    ? `${release.title} TV series`
    : `${release.title} ${new Date(release.releaseDate + 'T12:00:00').getFullYear()} film`
  return `https://www.imdb.com/find?q=${encodeURIComponent(q)}`
}

function formatAsOf(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ─── SEED DATA (Jul–Sep 2026) ─────────────────────────────────────────────────
// Dates marked isEstimated:false are confirmed from reputable sources.
// isEstimated:true = editorial research / trade publication rumour — subject to change.

const SEED_RELEASES: Release[] = [

  // ── ALREADY RELEASED (shown amber) ──────────────────────────────────────────

  {
    id: 'bruno-mars-i-just-might',
    title: 'I Just Might',
    artist: 'Bruno Mars',
    type: 'music_video',
    genre: 'R&B / Pop / Funk',
    category: 'Single',
    releaseDate: '2026-01-09',
    buzz: 7.2,
    buzzDelta: -0.8,
    description: 'Lead single from The Romantic. Directed by Daniel Ramos & Mars. Retro 1970s-inspired soundstage with multiple versions of Mars in a green suit. Debuted #1 on the Hot 100.',
    isEstimated: false,
    confirmedSource: 'https://hypebeast.com/2026/1/bruno-mars-i-just-might-single-the-romantic-new-album-music-video-release-info',
    sourceUrl: 'https://www.youtube.com/watch?v=mrV8kK5t0V8',
  },
  {
    id: 'stray-kids-run-it',
    title: 'RUN IT',
    artist: 'Stray Kids',
    type: 'music_video',
    genre: 'K-Pop / Hip-Hop',
    category: 'Pre-release Single',
    releaseDate: '2026-06-24',
    buzz: 6.3,
    buzzDelta: +2.8,
    description: 'JYP Entertainment. Pre-release single for THIS & THAT album (Aug 7). Directed by Sam Son. Members perform among black-and-white-clad dancers. Trending #1 worldwide on YouTube at release. In-house production by 3RACHA (Bang Chan, Changbin, Han).',
    isEstimated: false,
    confirmedSource: 'https://www.soompi.com/article/1849326wpp/watch-stray-kids-announces-comeback-date-and-world-tour-with-mv-teaser-for-pre-release-single-run-it',
    sourceUrl: 'https://www.youtube.com/watch?v=Q7IFjVUUb_E',
  },
  {
    id: 'the-bear-s5',
    title: 'The Bear — Season 5 (Final)',
    type: 'show',
    genre: 'Drama / Dark Comedy',
    category: 'Prestige TV',
    releaseDate: '2026-06-25',
    buzz: 9.1,
    buzzDelta: +2.4,
    description: 'FX/Hulu series finale. All 8 episodes dropped June 25. Signature handheld single-takes and natural-light kitchen sequences.',
    isEstimated: false,
    confirmedSource: 'https://collider.com/fx-hulu-the-bear-final-season-5-release-date-june-25-2026/',
  },
  {
    id: 'house-dragon-s3',
    title: 'House of the Dragon — Season 3',
    type: 'show',
    genre: 'Fantasy / Drama',
    category: 'Franchise',
    releaseDate: '2026-06-21',
    buzz: 9.7,
    buzzDelta: +3.1,
    description: 'HBO. Premiered June 21, weekly through Aug 9 finale. Dragon VFX compositing; practical flame rigs. Fabian Wagner cinematography.',
    isEstimated: false,
    confirmedSource: 'https://variety.com/2026/tv/news/house-of-the-dragon-season-3-release-date-hbo-1236731400/',
  },
  {
    id: 'pinkpantheress-stateside',
    title: 'Stateside (Remix)',
    artist: 'PinkPantheress & Zara Larsson',
    type: 'music_video',
    genre: 'Pop / Dance',
    category: 'Collab',
    releaseDate: '2026-01-15',
    buzz: 3.7,
    description: 'Charlotte Rutherford-directed remix video. PinkPantheress and Larsson act as mannequins in a storefront display themed around their respective 2025 LPs.',
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Stateside_(song)',
    sourceUrl: 'https://www.youtube.com/watch?v=lIxQe1R5hs0',
  },
  {
    id: 'taylor-swift-opalite',
    title: 'Opalite',
    artist: 'Taylor Swift',
    type: 'music_video',
    genre: 'Pop / Indie',
    category: 'Single',
    releaseDate: '2026-02-06',
    buzz: 9.6,
    buzzDelta: -1.4,
    description: 'Written and directed by Swift. Cinematography by Rodrigo Prieto. 1990s rom-com aesthetic shot on film — stars Swift opposite Domhnall Gleeson, with Greta Lee, Jodie Turner-Smith, Lewis Capaldi. Originally Apple Music / Spotify exclusive before YouTube two days later.',
    isEstimated: false,
    confirmedSource: 'https://www.rollingstone.com/music/music-news/taylor-swift-opalite-music-video-1235511440/',
    sourceUrl: 'https://www.youtube.com/watch?v=1FVF-9KQiPo',
  },
  {
    id: 'bts-swim',
    title: 'SWIM',
    artist: 'BTS',
    type: 'music_video',
    genre: 'K-Pop / Pop',
    category: 'Comeback',
    releaseDate: '2026-03-20',
    buzz: 14.5,
    buzzDelta: -2.1,
    description: 'Title track from Arirang (5th album) — first full-group release after military service. Directed by Tanu Muiño. Filmed in Lisbon against the ocean on a working sailing ship, with Lili Reinhart co-starring. #1 in 70 countries within an hour.',
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Swim_(BTS_song)',
    sourceUrl: 'https://www.youtube.com/watch?v=b4iVv91Z6lY',
  },
  {
    id: 'sabrina-carpenter-house-tour',
    title: 'House Tour',
    artist: 'Sabrina Carpenter',
    type: 'music_video',
    genre: 'Pop',
    category: 'Single',
    releaseDate: '2026-04-06',
    buzz: 7.8,
    buzzDelta: -1.5,
    description: 'Co-directed by Carpenter and Margaret Qualley. Heist comedy set in a lavish LA mansion — Qualley and Madelyn Cline co-star. Cinematic lighting, wide-lens comedy framing, and period-inflected costume design.',
    isEstimated: false,
    confirmedSource: 'https://www.rollingstone.com/music/music-news/sabrina-carpenter-house-tour-music-video-margaret-qualley-1235542151/',
    sourceUrl: 'https://www.youtube.com/watch?v=KWoTyfPsqbE',
  },
  {
    id: 'slayyyter-dance',
    title: 'DANCE...',
    artist: 'Slayyyter',
    type: 'music_video',
    genre: 'Hyperpop / Dance',
    category: 'Single',
    releaseDate: '2026-01-16',
    buzz: 2.4,
    description: "Lead single from WOR$T GIRL IN AMERICA. Y2K-inspired CGI-heavy visual. Heavy colour grading and VFX compositing.",
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Dance...',
    sourceUrl: 'https://www.youtube.com/watch?v=0W-N1DqpmiM',
  },
  {
    id: 'olivia-rodrigo-drop-dead',
    title: 'drop dead',
    artist: 'Olivia Rodrigo',
    type: 'music_video',
    genre: 'Pop / Alt-Rock',
    category: 'Single',
    releaseDate: '2026-04-17',
    buzz: 9.4,
    buzzDelta: -1.2,
    description: 'Directed by Petra Collins. Filmed at the Palace of Versailles. High-contrast aesthetic; also released in exclusive DSP-specific versions for Spotify and Apple Music.',
    isEstimated: false,
    confirmedSource: 'https://variety.com/2026/music/news/olivia-rodrigo-new-single-drop-dead-release-1236710540/',
    sourceUrl: 'https://www.youtube.com/watch?v=78wrful9cVU',
  },
  {
    id: 'aespa-wda',
    title: 'WDA (Whole Different Animal)',
    artist: 'aespa feat. G-DRAGON',
    type: 'music_video',
    genre: 'K-Pop / Hip-Hop',
    category: 'Pre-release Single',
    releaseDate: '2026-05-11',
    buzz: 5.9,
    buzzDelta: -0.3,
    description: 'SM Entertainment. Pre-release single from album Lemonade (May 29). MV concept: digital/reality boundary blurs — replica members multiply across an eerie landscape. G-Dragon co-wrote and performed his own verse.',
    isEstimated: false,
    confirmedSource: 'https://www.billboard.com/music/music-news/aespa-new-single-wda-whole-different-animal-feat-g-dragon-1236244919/',
    sourceUrl: 'https://www.youtube.com/watch?v=iTJSbJtS8MU',
  },
  {
    id: 'gaga-doechii-runway',
    title: 'RUNWAY',
    artist: 'Lady Gaga & Doechii',
    type: 'music_video',
    genre: 'Pop / Hip-Hop',
    category: 'Collab',
    releaseDate: '2026-04-27',
    buzz: 12.1,
    buzzDelta: -2.8,
    description: 'Directed by Parris Goebel. High-fashion choreography for The Devil Wears Prada 2 soundtrack. Premiered April 27; song released April 10.',
    isEstimated: false,
    confirmedSource: 'https://variety.com/2026/film/news/lady-gaga-doechii-runway-music-video-sass-high-fashion-1236726548/',
    sourceUrl: 'https://www.youtube.com/watch?v=XXIX2WnfbpE',
  },

  // ── JULY 2026 ────────────────────────────────────────────────────────────────

  {
    id: 'xmen-97-s2',
    title: "X-Men '97 — Season 2",
    type: 'show',
    genre: 'Animation / Superhero',
    category: 'Franchise',
    releaseDate: '2026-07-01',
    buzz: 4.8,
    buzzDelta: +1.9,
    description: "Disney+. Nine-episode second season premiered July 1. Retro cel-shading with contemporary storyboard direction.",
    isEstimated: false,
    confirmedSource: 'https://www.marvel.com/articles/tv-shows/x-men-97-season-2-trailer-july-1-2026-release-date-disney-plus',
  },
  {
    id: 'silo-s3',
    title: 'Silo — Season 3',
    type: 'show',
    genre: 'Sci-Fi / Drama',
    category: 'Prestige TV',
    releaseDate: '2026-07-03',
    buzz: 3.2,
    description: 'Apple TV+. 10-episode season premiering July 3, weekly through September 4. Visually dense underground production design.',
    isEstimated: false,
    confirmedSource: 'https://www.apple.com/tv-pr/news/2026/04/apples-globally-acclaimed-drama-silo-starring-and-executive-produced-by-rebecca-ferguson-returns-for-season-three-on-july-3-2026/',
  },
  {
    id: 'moana-live-action',
    title: 'Moana',
    type: 'film',
    genre: 'Live-Action / Musical',
    category: 'Family',
    releaseDate: '2026-07-10',
    buzz: 6.7,
    description: "Disney live-action. Dwayne Johnson returns as Maui; Catherine Laga'aia as Moana. Directed by Thomas Kail. IMAX release.",
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Moana_(2026_film)',
  },
  {
    id: 'the-odyssey',
    title: 'The Odyssey',
    type: 'film',
    genre: 'Epic / Fantasy',
    category: 'Prestige',
    releaseDate: '2026-07-17',
    buzz: 8.4,
    buzzDelta: +4.2,
    description: "Christopher Nolan. Matt Damon as Odysseus, Anne Hathaway as Penelope. Shot entirely on IMAX 70mm. London premiere July 6.",
    isEstimated: false,
    confirmedSource: 'https://www.odysseymovie.com/',
  },
  {
    id: 'charli-xcx-ss26',
    title: 'SS26',
    artist: 'Charli XCX',
    type: 'music_video',
    genre: 'Pop / Electronic',
    category: 'Single',
    releaseDate: '2026-07-24',
    buzz: 5.8,
    buzzDelta: +2.1,
    description: "Lead single from 'Music, Fashion, Film' album (Jul 24). Directed by Aidan Zamiri. Runway-fashion aesthetic, high-energy editorial pacing.",
    isEstimated: false,
    confirmedSource: 'https://www.rollingstone.com/music/music-news/charli-xcx-new-album-music-fashion-film-1235570567/',
    sourceUrl: 'https://www.youtube.com/watch?v=twLhSqabby0',
  },
  {
    id: 'spider-man-brand-new-day',
    title: 'Spider-Man: Brand New Day',
    type: 'film',
    genre: 'Superhero / Action',
    category: 'Franchise',
    releaseDate: '2026-07-31',
    buzz: 11.2,
    buzzDelta: +5.7,
    description: "Sony/Marvel. Tom Holland, Zendaya, Sadie Sink. Directed by Destin Daniel Cretton. NYC practical location photography, Arri 65 acquisition.",
    isEstimated: false,
    confirmedSource: 'https://www.landmarkcinemas.com/movie-news/spider-man-brand-new-day-to-release-in-july-2026',
  },

  // ── AUGUST 2026 ──────────────────────────────────────────────────────────────

  {
    id: 'stray-kids-this-and-that',
    title: 'THIS & THAT',
    artist: 'Stray Kids',
    type: 'music_video',
    genre: 'K-Pop / Hip-Hop',
    category: 'Album Title Track',
    releaseDate: '2026-08-07',
    buzz: 5.8,
    buzzDelta: +1.6,
    description: 'JYP Entertainment. First full-length album era of 2026 — 8 tracks. Title track MV expected at 1 PM KST. RUN IT World Tour launches alongside it. Produced by 3RACHA.',
    isEstimated: false,
    confirmedSource: 'https://www.koreatimes.co.kr/entertainment/k-pop/20260622/stray-kids-to-drop-new-album-in-august-announces-new-world-tour',
  },
  {
    id: 'ted-lasso-s4',
    title: 'Ted Lasso — Season 4',
    type: 'show',
    genre: 'Comedy / Drama',
    category: 'Prestige TV',
    releaseDate: '2026-08-05',
    buzz: 6.4,
    buzzDelta: +3.2,
    description: 'Apple TV+. Long-awaited return after 3-year hiatus. Ted coaches a women\'s second-division side. Warm naturalistic lighting, handheld intimacy; Hannah Waddingham and Brett Goldstein return.',
    isEstimated: false,
    confirmedSource: 'https://www.apple.com/tv-pr/news/2026/04/apple-tvs-emmy-award-winning-global-smash-hit-series-ted-lasso-returns-for-season-four-on-wednesday-august-5/',
  },
  {
    id: 'one-hundred-years-s2',
    title: 'One Hundred Years of Solitude — Part 2',
    type: 'show',
    genre: 'Drama / Magical Realism',
    category: 'Prestige TV',
    releaseDate: '2026-08-05',
    buzz: 5.2,
    buzzDelta: +1.8,
    description: 'Netflix. Final 7 episodes of the García Márquez adaptation. Directed by Laura Mora and Carlos Moreno. Cinematographers Paulo Pérez and María Sarasvati. Stunning magical-realism visual language shot entirely in Colombia.',
    isEstimated: false,
    confirmedSource: 'https://www.netflix.com/tudum/articles/one-hundred-years-of-solitude-release-date-news-cast-trailer',
  },
  {
    id: 'reacher-s4',
    title: 'Reacher — Season 4',
    type: 'show',
    genre: 'Action / Thriller',
    category: 'Streaming',
    releaseDate: '2026-08-12',
    buzz: 4.8,
    buzzDelta: +0.9,
    description: 'Prime Video. Based on Gone Tomorrow — Reacher in NYC during a terrorist threat. First 3 episodes Aug 12, weekly thereafter. Practical stunt work and blunt action cinematography.',
    isEstimated: false,
    confirmedSource: 'https://www.aboutamazon.com/news/entertainment/prime-video-reacher-how-to-watch',
  },
  {
    id: 'lanterns',
    title: 'Lanterns',
    type: 'show',
    genre: 'Sci-Fi / Mystery / Drama',
    category: 'Franchise',
    releaseDate: '2026-08-16',
    buzz: 7.6,
    buzzDelta: +2.1,
    description: 'HBO. DC series — Kyle Chandler as Hal Jordan, Aaron Pierre as John Stewart. Run by Ozark\'s Chris Mundy; produced by Damon Lindelof. True Detective–style murder mystery aesthetic. 8 episodes.',
    isEstimated: false,
    confirmedSource: 'https://deadline.com/2026/03/lanterns-trailer-release-date-hbo-dc-studios-hal-jordan-1236744039/',
  },
  {
    id: 'coyote-vs-acme',
    title: 'Coyote vs. Acme',
    type: 'film',
    genre: 'Live-Action / Animation / Comedy',
    category: 'Family',
    releaseDate: '2026-08-28',
    buzz: 4.2,
    buzzDelta: +2.3,
    description: 'Ketchup Entertainment/WB. Will Forte, Lana Condor, John Cena. Wile E. Coyote sues Acme in live-action hybrid. Notable for the WB tax write-off saga; cinematography blends practical and animated compositing.',
    isEstimated: false,
    confirmedSource: 'https://variety.com/2025/film/news/coyote-vs-acme-release-date-1236471190/',
  },

  // ── ESTIMATED AUG 2026 ───────────────────────────────────────────────────────

  {
    id: 'evil-dead-burn',
    title: 'Evil Dead: Burn',
    type: 'film',
    genre: 'Horror',
    category: 'Horror',
    releaseDate: '2026-08-14',
    buzz: 2.9,
    description: 'Evil Dead franchise continuation. Practical effects-heavy production. Reported August window — no studio date confirmed.',
    isEstimated: true,
  },
  {
    id: 'the-substance-2',
    title: 'The Substance: Part Two',
    type: 'film',
    genre: 'Body Horror / Drama',
    category: 'Prestige',
    releaseDate: '2026-09-01',
    buzz: 6.8,
    description: "Coralie Fargeat follow-up rumoured for fall 2026. Hyper-saturated practical body-horror FX palette.",
    isEstimated: true,
  },
  {
    id: 'frank-ocean-kiki-boy',
    title: 'KIKI BOY',
    artist: 'Frank Ocean',
    type: 'music_video',
    genre: 'R&B / Art Pop',
    category: 'Album Era',
    releaseDate: '2026-09-01',
    buzz: 15.0,
    buzzDelta: +6.3,
    description: 'Confirmed 2026 album era — billboards appeared. No official single or video date set yet. Estimated based on active promo cycle.',
    isEstimated: true,
  },
  {
    id: 'practical-magic-2',
    title: 'Practical Magic 2',
    type: 'film',
    genre: 'Fantasy / Drama / Comedy',
    category: 'Prestige',
    releaseDate: '2026-09-11',
    buzz: 5.6,
    buzzDelta: +1.4,
    description: "Directed by Susanne Bier. Sandra Bullock and Nicole Kidman return 25 years on, with Joey King and Maisie Williams as new Owens women. Warm witchcraft aesthetic, period-blended production design.",
    isEstimated: false,
    confirmedSource: 'https://deadline.com/2026/06/practical-magic-2-trailer-sandra-bullock-nicole-kidman-1236865843/',
  },
  {
    id: 'clayface',
    title: 'Clayface',
    type: 'film',
    genre: 'Horror / Superhero',
    category: 'Franchise',
    releaseDate: '2026-10-23',
    buzz: 5.8,
    buzzDelta: +1.9,
    description: 'DC/WB. Directed by James Watkins; screenplay by Mike Flanagan & Hossein Amini. Tom Rhys Harries as Matt Hagen. Horror-inflected DC entry, deliberately dark and visceral. Note: pushed from Sep 11 to Oct 23 for Halloween window.',
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Clayface_(film)',
  },
  {
    id: 'newjeans-comeback',
    title: 'NewJeans — New Era',
    artist: 'NewJeans',
    type: 'music_video',
    genre: 'K-Pop / Pop',
    category: 'Comeback',
    releaseDate: '2026-10-01',
    buzz: 8.4,
    buzzDelta: +4.2,
    description: 'ADOR/HYBE. Three members (Haerin, Hyein, Hanni) confirmed return; Minji in discussions; Danielle in legal dispute. ADOR confirmed Copenhagen preproduction trip for "new musical narrative." No confirmed date — analyst consensus puts comeback Oct–Nov 2026. Estimated.',
    isEstimated: true,
  },
  {
    id: 'dune-part-three',
    title: 'Dune: Part Three',
    type: 'film',
    genre: 'Sci-Fi / Epic',
    category: 'Prestige',
    releaseDate: '2026-12-18',
    buzz: 10.5,
    buzzDelta: +3.8,
    description: "Villeneuve's trilogy closer. Timothée Chalamet, Zendaya. Warner Bros. theatrical Dec 18 worldwide. Greig Fraser DP. Note: outside the Jul–Sep window.",
    isEstimated: false,
    confirmedSource: 'https://en.wikipedia.org/wiki/Dune:_Part_Three',
  },
]

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function BuzzBar({ value, delta }: { value: number; delta?: number }) {
  const max = 15
  const pct = Math.min((value / max) * 100, 100)
  const color = value >= 10 ? 'bg-white' : value >= 6 ? 'bg-white/60' : 'bg-white/30'
  const trendUp = delta != null && delta > 0.5
  const trendDown = delta != null && delta < -0.5
  const trendLabel = delta != null
    ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}M vs last month`
    : 'Trend: no prior month data'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-white/40 tabular-nums w-9 text-right shrink-0">{value}M</span>
      </div>
      {(trendUp || trendDown) && (
        <div title={trendLabel} className="flex items-center gap-1">
          <span className={`text-[10px] font-medium ${trendUp ? 'text-emerald-400/80' : 'text-red-400/70'}`}>
            {trendUp ? '↑' : '↓'}
          </span>
          <span className={`text-[10px] tabular-nums ${trendUp ? 'text-emerald-400/60' : 'text-red-400/50'}`}>
            {delta != null && Math.abs(delta).toFixed(1)}M
          </span>
        </div>
      )}
    </div>
  )
}

function SortHeader({ label, sortKey, active, dir, onClick }: {
  label: string; sortKey: SortKey; active: boolean; dir: SortDir; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 text-xs uppercase tracking-widest transition ${active ? 'text-white' : 'text-white/20 hover:text-white/50'}`}
    >
      {label}
      <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-0'}`}>
        {dir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  )
}

// ─── CLIP DRAWER ─────────────────────────────────────────────────────────────

function ClipDrawer({
  release,
  sourceUrl,
  onClose,
  onSourceUrlSave,
}: {
  release: Release
  sourceUrl: string
  onClose: () => void
  onSourceUrlSave: (id: string, url: string) => void
}) {
  const [shots, setShots] = useState<DrawerShot[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmingFeature, setConfirmingFeature] = useState<string | null>(null)
  const [confirmingLibrary, setConfirmingLibrary] = useState<string | null>(null)
  const [shotStatus, setShotStatus] = useState<Record<string, Set<string>>>({})
  const [working, setWorking] = useState<string | null>(null)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState(sourceUrl)

  // Import & Analyze
  const [suggestedClips, setSuggestedClips] = useState<SuggestedClip[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [analyzingClips, setAnalyzingClips] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)

  const released = release.releaseDate <= TODAY

  useEffect(() => {
    if (!sourceUrl) { setLoading(false); return }
    supabase
      .from('shots')
      .select('id, title, thumbnail_url, platform, is_curated, collection_id, start_time, end_time, breakdowns(camera_specs, lighting, camera_movement)')
      .eq('status', 'analyzed')
      .eq('source_url', sourceUrl)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setShots((data ?? []) as DrawerShot[])
        setLoading(false)
      })
  }, [sourceUrl])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const ensureCollection = async (): Promise<string | null> => {
    if (collectionId) return collectionId
    const title = release.artist ? `${release.title} — ${release.artist}` : release.title
    const { data } = await supabase
      .from('collections')
      .insert({ title, type: release.type, description: release.description, is_featured: false })
      .select().single()
    if (!data) return null
    setCollectionId(data.id)
    return data.id
  }

  const addToFeatured = async (shot: DrawerShot) => {
    setWorking(shot.id + '-feature')
    const colId = await ensureCollection()
    if (!colId) { setWorking(null); return }
    await supabase.from('shots').update({ collection_id: colId }).eq('id', shot.id)
    setShots(prev => prev.map(s => s.id === shot.id ? { ...s, collection_id: colId } : s))
    setShotStatus(prev => {
      const next = new Set(prev[shot.id] ?? [])
      next.add('featured')
      return { ...prev, [shot.id]: next }
    })
    setConfirmingFeature(null)
    setWorking(null)
  }

  const addToLibrary = async (shot: DrawerShot) => {
    setWorking(shot.id + '-library')
    await supabase.from('shots').update({ is_curated: true }).eq('id', shot.id)
    setShots(prev => prev.map(s => s.id === shot.id ? { ...s, is_curated: true } : s))
    setShotStatus(prev => {
      const next = new Set(prev[shot.id] ?? [])
      next.add('in-library')
      return { ...prev, [shot.id]: next }
    })
    setConfirmingLibrary(null)
    setWorking(null)
  }

  const suggestClips = async () => {
    setSuggesting(true)
    setSuggestedClips([])
    try {
      const res = await fetch('/api/admin/suggest-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: release.title,
          artist: release.artist,
          type: release.type,
          genre: release.genre,
          description: release.description,
        }),
      })
      const data = await res.json()
      setSuggestedClips(data.clips ?? [])
    } finally {
      setSuggesting(false)
    }
  }

  const analyzeClip = async (clip: SuggestedClip) => {
    const effectiveUrl = sourceUrl
    if (!effectiveUrl) return
    const key = clip.title
    setAnalyzingClips(prev => new Set(prev).add(key))
    try {
      const { data: newShot } = await supabase
        .from('shots')
        .insert({
          title: `${release.title} — ${clip.title}`,
          source_url: effectiveUrl,
          platform: 'youtube',
          start_time: clip.startTime,
          end_time: clip.endTime,
          status: 'pending',
        })
        .select()
        .single()
      if (!newShot) return
      setShots(prev => [{ ...newShot, breakdowns: [] } as DrawerShot, ...prev])
      await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId: newShot.id, focus: clip.focus }),
      })
      const { data: analyzed } = await supabase
        .from('shots')
        .select('id, title, thumbnail_url, platform, is_curated, collection_id, start_time, end_time, breakdowns(camera_specs, lighting, camera_movement)')
        .eq('id', newShot.id)
        .single()
      if (analyzed) setShots(prev => prev.map(s => s.id === newShot.id ? analyzed as DrawerShot : s))
    } finally {
      setAnalyzingClips(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }

  const visible = shots.filter(s =>
    !search.trim() ||
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.platform.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[480px] bg-[#0a0a0a] border-l border-white/10 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className={`px-6 py-5 border-b border-white/10 shrink-0 ${released ? 'bg-amber-500/[0.04]' : ''}`}>
          <div className="flex items-start justify-between gap-4 mb-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className={`font-bold text-lg leading-snug ${released ? 'text-amber-100' : 'text-white'}`}>
                  {release.title}
                </h2>
                {released && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-500/15 text-amber-400 border border-amber-500/20 shrink-0">Out now</span>
                )}
              </div>
              <p className={`text-xs mt-0.5 ${released ? 'text-amber-300/50' : 'text-white/35'}`}>
                {release.artist ? `${release.artist} · ` : ''}{release.genre}
              </p>
            </div>
            <button onClick={onClose} className="text-white/30 hover:text-white transition text-lg leading-none shrink-0 mt-0.5">✕</button>
          </div>
          <p className="text-xs text-white/25 leading-relaxed mt-2">{release.description}</p>

          {/* Source URL */}
          <div className="mt-3">
            {editingUrl ? (
              <div className="flex gap-2 items-center">
                <input
                  autoFocus type="url" value={urlDraft}
                  onChange={e => setUrlDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onSourceUrlSave(release.id, urlDraft); setEditingUrl(false) }
                    if (e.key === 'Escape') { setUrlDraft(sourceUrl); setEditingUrl(false) }
                  }}
                  placeholder={release.type === 'music_video' ? 'Paste YouTube video URL...' : 'Paste IMDB or official page URL...'}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
                />
                <button onClick={() => { onSourceUrlSave(release.id, urlDraft); setEditingUrl(false) }}
                  className="text-xs text-white/50 hover:text-white transition px-2 py-1.5 border border-white/10 rounded-lg">
                  Save
                </button>
                <button onClick={() => { setUrlDraft(sourceUrl); setEditingUrl(false) }}
                  className="text-xs text-white/25 hover:text-white/50 transition">
                  Cancel
                </button>
              </div>
            ) : sourceUrl ? (
              <div className="flex items-center gap-3">
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-white/40 hover:text-white transition underline underline-offset-2 truncate flex-1">
                  ↗ {sourceUrl}
                </a>
                <button onClick={() => { setUrlDraft(sourceUrl); setEditingUrl(true) }}
                  className="text-xs text-white/20 hover:text-white/50 transition shrink-0">
                  Edit
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setUrlDraft(''); setEditingUrl(true) }}
                className="text-xs border border-dashed border-white/15 rounded-lg px-3 py-1.5 text-white/30 hover:border-white/30 hover:text-white/60 transition"
              >
                + Add {release.type === 'music_video' ? 'YouTube video URL' : 'source link'}
              </button>
            )}
          </div>

          {collectionId && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 inline-block" />
              Featured collection created —{' '}
              <Link href="/admin/collections" className="underline underline-offset-2 hover:text-amber-300 transition">
                Manage in Collections
              </Link>
            </div>
          )}
        </div>

        {/* Import & Analyze — only for released content with a known video URL */}
        {sourceUrl && released && (
          <div className="px-6 py-3 border-b border-white/8 shrink-0">
            <button
              onClick={() => { setShowImport(v => !v); if (!showImport && suggestedClips.length === 0) suggestClips() }}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-xs text-white/50 uppercase tracking-widest">Import & Analyze</span>
              <span className="text-white/20 text-xs">{showImport ? '▲' : '▼'}</span>
            </button>

            {showImport && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-white/25 leading-relaxed">
                  AI-suggested moments from this video worth breaking down. Click "Analyze" to download the clip and run a full cinematography breakdown.
                </p>

                {suggesting ? (
                  <p className="text-xs text-white/20 py-2">Generating suggestions...</p>
                ) : suggestedClips.length > 0 ? (
                  <div className="space-y-2">
                    {suggestedClips.map(clip => {
                      const isAnalyzing = analyzingClips.has(clip.title)
                      return (
                        <div key={clip.title} className="border border-white/8 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white/70 leading-snug">{clip.title}</p>
                              <p className="text-[10px] text-white/30 mt-0.5 tabular-nums">
                                {clip.startTime} – {clip.endTime}
                              </p>
                              <p className="text-[10px] text-white/25 mt-1 leading-snug">{clip.focus}</p>
                            </div>
                            <button
                              onClick={() => analyzeClip(clip)}
                              disabled={isAnalyzing}
                              className="text-[10px] shrink-0 px-2.5 py-1.5 rounded-lg border border-white/15 text-white/40 hover:border-white/30 hover:text-white/70 transition disabled:opacity-30 whitespace-nowrap"
                            >
                              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <button
                      onClick={suggestClips}
                      disabled={suggesting}
                      className="text-[10px] text-white/20 hover:text-white/50 transition disabled:opacity-30"
                    >
                      ↻ Refresh suggestions
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={suggestClips}
                    disabled={suggesting}
                    className="text-xs border border-dashed border-white/15 rounded-lg px-3 py-2 text-white/30 hover:border-white/30 hover:text-white/60 transition w-full disabled:opacity-30"
                  >
                    AI Suggest Clips
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="px-6 py-3 border-b border-white/8 shrink-0">
          <input type="text" placeholder="Search your analyzed shots..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition"
          />
          {!loading && (
            <p className="text-xs text-white/20 mt-2">
              {visible.length} shot{visible.length !== 1 ? 's' : ''} · add clips to this release's Featured entry or the Public Library
            </p>
          )}
        </div>

        {/* Shot list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading ? (
            <p className="text-white/20 text-sm text-center py-12">Loading shots...</p>
          ) : visible.length === 0 ? (
            <p className="text-white/20 text-sm text-center py-12">
              {search ? 'No shots match that search.' : sourceUrl ? 'No shots analyzed from this video yet. Use Import & Analyze above.' : 'Add a video URL above to start importing clips.'}
            </p>
          ) : visible.map(shot => {
            const bd = shot.breakdowns?.[0]
            const camera = bd?.camera_specs?.camera ?? ''
            const lighting = bd?.lighting?.type ?? ''
            const movement = bd?.camera_movement?.type ?? ''
            const done = shotStatus[shot.id] ?? new Set()
            const isConfirmingFeature = confirmingFeature === shot.id
            const isConfirmingLibrary = confirmingLibrary === shot.id

            return (
              <div key={shot.id} className="border border-white/8 rounded-xl overflow-hidden">
                <div className="flex gap-3 p-3">
                  <div className="shrink-0">
                    {shot.thumbnail_url ? (
                      <img src={shot.thumbnail_url} alt={shot.title} className="w-20 h-12 object-cover rounded-lg" />
                    ) : (
                      <div className="w-20 h-12 bg-white/5 rounded-lg flex items-center justify-center">
                        <span className="text-white/10 text-xs">No img</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/shot/${shot.id}`} target="_blank"
                      className="text-sm font-medium text-white/80 hover:text-white transition line-clamp-1">
                      {shot.title}
                    </Link>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {shot.start_time && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
                          {shot.start_time}{shot.end_time ? ` – ${shot.end_time}` : ''}
                        </span>
                      )}
                      {camera && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{camera}</span>}
                      {lighting && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 capitalize">{lighting}</span>}
                      {movement && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 capitalize">{movement}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex border-t border-white/8">
                  {/* Feature */}
                  <div className="flex-1 border-r border-white/8">
                    {shot.collection_id !== null || done.has('featured') ? (
                      <div className="px-3 py-2.5">
                        <span className="text-[10px] text-amber-400/70">★ In Featured</span>
                      </div>
                    ) : isConfirmingFeature ? (
                      <div className="px-3 py-2 flex items-center gap-2">
                        <button disabled={working === shot.id + '-feature'} onClick={() => addToFeatured(shot)}
                          className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-full hover:bg-amber-500/30 transition whitespace-nowrap disabled:opacity-40">
                          {working === shot.id + '-feature' ? 'Adding...' : 'Yes, add'}
                        </button>
                        <button onClick={() => setConfirmingFeature(null)} className="text-xs text-white/25 hover:text-white/50 transition">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setConfirmingFeature(shot.id); setConfirmingLibrary(null) }}
                        className="w-full px-3 py-2.5 text-left text-xs text-white/35 hover:text-white hover:bg-white/[0.03] transition">
                        + Add to Featured
                      </button>
                    )}
                  </div>
                  {/* Library */}
                  <div className="flex-1">
                    {shot.is_curated || done.has('in-library') ? (
                      <div className="px-3 py-2.5">
                        <span className="text-[10px] text-white/40">✓ In Library</span>
                      </div>
                    ) : isConfirmingLibrary ? (
                      <div className="px-3 py-2 flex items-center gap-2">
                        <button disabled={working === shot.id + '-library'} onClick={() => addToLibrary(shot)}
                          className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-full hover:bg-amber-500/30 transition whitespace-nowrap disabled:opacity-40">
                          {working === shot.id + '-library' ? 'Adding...' : 'Yes, add'}
                        </button>
                        <button onClick={() => setConfirmingLibrary(null)} className="text-xs text-white/25 hover:text-white/50 transition">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setConfirmingLibrary(shot.id); setConfirmingFeature(null) }}
                        className="w-full px-3 py-2.5 text-left text-xs text-white/35 hover:text-white hover:bg-white/[0.03] transition">
                        + Add to Library
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-white/8 shrink-0">
          <p className="text-xs text-white/15">
            Shots added to Featured will appear when users click this release on the Featured page.
            Library shots appear in the public Research page.
          </p>
        </div>
      </div>
    </>
  )
}

// ─── DATE CELL ────────────────────────────────────────────────────────────────

function DateCell({
  release,
  dateOverride,
  verifyStatus,
  verifyNote,
  onDateSave,
  onVerify,
}: {
  release: Release
  dateOverride: string | null
  verifyStatus: 'idle' | 'checking' | 'done'
  verifyNote: string | null
  onDateSave: (id: string, date: string) => void
  onVerify: (release: Release) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(dateOverride ?? release.releaseDate)
  const date = dateOverride ?? release.releaseDate
  const isEstimated = release.isEstimated && !dateOverride
  const released = date <= TODAY

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus type="date" value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onDateSave(release.id, draft); setEditing(false) }
            if (e.key === 'Escape') { setDraft(date); setEditing(false) }
          }}
          className="bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-white/40 transition w-32"
        />
        <div className="flex gap-2">
          <button onClick={() => { onDateSave(release.id, draft); setEditing(false) }}
            className="text-[10px] text-white/50 hover:text-white transition">Save</button>
          <button onClick={() => { setDraft(date); setEditing(false) }}
            className="text-[10px] text-white/20 hover:text-white/40 transition">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => setEditing(true)} className="text-left group">
        <span className={`text-xs tabular-nums group-hover:underline underline-offset-2 ${released ? 'text-amber-400/80' : 'text-white/40'}`}>
          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </button>
      {released && <span className="block text-[10px] text-amber-500/60 mt-0.5">Out now</span>}
      {!released && (
        <div className="flex items-center gap-1 mt-0.5">
          {isEstimated && <span className="text-[10px] text-white/25 italic">Est.</span>}
          <button
            onClick={() => onVerify(release)}
            disabled={verifyStatus === 'checking'}
            className="text-[10px] text-white/20 hover:text-white/50 transition disabled:opacity-30"
            title={verifyNote ?? 'Final check: search YouTube/web to confirm this hasn\'t actually released yet'}
          >
            {verifyStatus === 'checking' ? '...' : verifyStatus === 'done' ? '✓ Checked' : '↻ Verify'}
          </button>
        </div>
      )}
      {release.confirmedSource && !isEstimated && !dateOverride && (
        <a href={release.confirmedSource} target="_blank" rel="noopener noreferrer"
          className="block text-[10px] text-white/15 hover:text-white/40 transition mt-0.5" title="View source">
          ✓ Confirmed
        </a>
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function ReleasesPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | ReleaseType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showBuzzInfo, setShowBuzzInfo] = useState(false)
  const [activeRelease, setActiveRelease] = useState<Release | null>(null)
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({})
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({})
  const [verifyStatus, setVerifyStatus] = useState<Record<string, 'idle' | 'checking' | 'done'>>({})
  const [verifyNotes, setVerifyNotes] = useState<Record<string, string>>({})
  const [buzzOverrides, setBuzzOverrides] = useState<Record<string, { buzz: number; delta: number | null }>>({})
  const [researchStatus, setResearchStatus] = useState<Record<string, 'idle' | 'checking' | 'done'>>({})
  const [researchedAt, setResearchedAt] = useState<Record<string, number>>({})
  const [researchingAll, setResearchingAll] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
  }, [])

  const isReleased = (id: string, fallbackDate: string) => (dateOverrides[id] ?? fallbackDate) <= TODAY

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'buzz' ? 'desc' : 'asc') }
  }

  const closeDrawer = useCallback(() => setActiveRelease(null), [])
  const saveSourceUrl = useCallback((id: string, url: string) => setSourceUrls(prev => ({ ...prev, [id]: url.trim() })), [])
  const saveDateOverride = useCallback((id: string, date: string) => setDateOverrides(prev => ({ ...prev, [id]: date })), [])

  // Final verification step: live YouTube/web check, used as the last step of research.
  const verifyRelease = useCallback(async (release: Release, currentDateOverride?: string) => {
    setVerifyStatus(prev => ({ ...prev, [release.id]: 'checking' }))
    try {
      const res = await fetch('/api/admin/verify-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: release.title,
          artist: release.artist,
          type: release.type,
          currentDate: currentDateOverride ?? dateOverrides[release.id] ?? release.releaseDate,
        }),
      })
      const data: { date: string | null; confidence: Confidence; note: string; sourceUrl: string | null; released: boolean } = await res.json()
      if (data.date && data.confidence === 'confirmed') {
        setDateOverrides(prev => ({ ...prev, [release.id]: data.date! }))
      }
      if (data.sourceUrl && data.confidence === 'confirmed') {
        setSourceUrls(prev => ({ ...prev, [release.id]: data.sourceUrl! }))
      }
      if (data.note) {
        setVerifyNotes(prev => ({ ...prev, [release.id]: data.note }))
      }
    } finally {
      setVerifyStatus(prev => ({ ...prev, [release.id]: 'done' }))
    }
  }, [dateOverrides])

  const researchRelease = useCallback(async (release: Release) => {
    setResearchStatus(prev => ({ ...prev, [release.id]: 'checking' }))
    try {
      const res = await fetch('/api/admin/research-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: release.title,
          artist: release.artist,
          type: release.type,
          genre: release.genre,
          releaseDate: dateOverrides[release.id] ?? release.releaseDate,
          today: TODAY,
        }),
      })
      const data = await res.json()
      let latestDate = dateOverrides[release.id] ?? release.releaseDate
      if (data.date && data.dateConfidence === 'confirmed') {
        setDateOverrides(prev => ({ ...prev, [release.id]: data.date }))
        latestDate = data.date
      }
      if (data.buzzScore != null) {
        setBuzzOverrides(prev => ({ ...prev, [release.id]: { buzz: data.buzzScore, delta: data.buzzDelta ?? null } }))
      }
      // Video URL takes priority for music videos, otherwise use as source link
      const newUrl = data.videoUrl ?? data.sourceLinkUrl
      if (newUrl && !sourceUrls[release.id]) {
        setSourceUrls(prev => ({ ...prev, [release.id]: newUrl }))
      }
      // Final verification step: still shows as upcoming — confirm it hasn't
      // actually already released (live YouTube/web check) before trusting that.
      if (latestDate > TODAY) {
        await verifyRelease(release, latestDate)
      }
    } finally {
      setResearchStatus(prev => ({ ...prev, [release.id]: 'done' }))
      setResearchedAt(prev => ({ ...prev, [release.id]: Date.now() }))
    }
  }, [dateOverrides, sourceUrls, verifyRelease])

  const researchAll = useCallback(async () => {
    setResearchingAll(true)
    try {
      for (const release of SEED_RELEASES) {
        await researchRelease(release)
      }
    } finally {
      setResearchingAll(false)
    }
  }, [researchRelease])

  if (authLoading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Loading...</p>
    </div>
  )
  if (!user || user.email !== ADMIN_EMAIL) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-white/30">Access denied.</p>
    </div>
  )

  const filtered = SEED_RELEASES
    .filter(r => filter === 'all' || r.type === filter)
    .sort((a, b) => {
      const aDate = dateOverrides[a.id] ?? a.releaseDate
      const bDate = dateOverrides[b.id] ?? b.releaseDate
      let cmp = 0
      if (sortKey === 'title') cmp = a.title.localeCompare(b.title)
      if (sortKey === 'type') cmp = a.type.localeCompare(b.type)
      if (sortKey === 'date') cmp = aDate.localeCompare(bDate)
      if (sortKey === 'buzz') cmp = (buzzOverrides[a.id]?.buzz ?? a.buzz) - (buzzOverrides[b.id]?.buzz ?? b.buzz)
      return sortDir === 'asc' ? cmp : -cmp
    })

  const releasedCount = filtered.filter(r => isReleased(r.id, r.releaseDate)).length
  const estimatedCount = filtered.filter(r => r.isEstimated && !dateOverrides[r.id]).length

  return (
    <main className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <Link href="/admin" className="text-sm text-white/40 hover:text-white transition">← Admin</Link>
        <span className="text-white/15">|</span>
        <span className="text-sm font-medium">Upcoming / Current Releases</span>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">

        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Upcoming & Current Releases</h1>
          <p className="text-sm text-white/40">
            Films, shows, and music videos July – Sep 2026. Click a row to browse your clips and assign them to Featured or the Public Library.
            <span className="inline-flex items-center gap-1.5 ml-4 text-amber-400/70">
              <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/50" />
              Amber = released
            </span>
            {estimatedCount > 0 && (
              <span className="inline-flex items-center gap-1 ml-4 text-white/25 text-xs italic">
                {estimatedCount} estimated date{estimatedCount !== 1 ? 's' : ''} — click ↻ to auto-verify
              </span>
            )}
          </p>
        </div>

        {/* Buzz info */}
        <div className="border border-white/8 rounded-xl px-5 py-4 mb-6 bg-white/[0.02]">
          <button onClick={() => setShowBuzzInfo(v => !v)} className="flex items-center gap-2 w-full text-left">
            <span className="text-xs text-white/50 uppercase tracking-widest">What is "Buzz"?</span>
            <span className="text-white/20 text-xs ml-auto">{showBuzzInfo ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showBuzzInfo && (
            <div className="mt-3 pt-3 border-t border-white/8 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Social mentions', detail: 'Combined X, Instagram, TikTok — unique posts & reposts in the past 30 days' },
                { label: 'Search volume', detail: 'Google Trends interest over the last 30 days, normalised to a monthly million-mention equivalent' },
                { label: 'Trailer views', detail: 'Official trailer cumulative YouTube views converted to a proportional mention estimate' },
                { label: 'Press coverage', detail: 'Editorial articles and reviews across major entertainment and film trade publications' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-white/60 font-medium mb-1">{item.label}</p>
                  <p className="text-xs text-white/25 leading-relaxed">{item.detail}</p>
                </div>
              ))}
              <div className="col-span-2 sm:col-span-4 border-t border-white/8 pt-3 mt-1 flex flex-col gap-1">
                <p className="text-xs text-white/25">
                  <span className="text-emerald-400/70 font-medium">↑</span> / <span className="text-red-400/60 font-medium">↓</span> trend arrow = change vs the prior 30-day window (last month vs this month). Momentum is based on search interest velocity + social post volume. A rising score near a release date signals growing awareness; a falling score for recently-released titles signals the initial spike is normalising.
                </p>
                <p className="text-xs text-white/15">
                  Score in millions of estimated mention-equivalents. Sourced via editorial research, July 2026. TMDB API integration coming soon for live data.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-5">
          {(['all', 'film', 'show', 'music_video'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                filter === f ? 'bg-white/10 border-white/30 text-white' : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/60'
              }`}
            >
              {f === 'all' ? `All (${SEED_RELEASES.length})` : f === 'music_video' ? 'Music Videos' : `${TYPE_LABEL[f]}s`}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-white/20">{releasedCount} of {filtered.length} released</span>
            <button
              onClick={() => researchAll()}
              disabled={researchingAll}
              title="AI research: updates trending, buzz, and dates for all releases, finishing with a live YouTube/web check to confirm anything still listed as upcoming hasn't already come out"
              className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/30 hover:border-white/30 hover:text-white/60 transition disabled:opacity-30"
            >
              {researchingAll ? '⟳ Researching...' : '⟳ Research All'}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-[minmax(180px,1fr)_90px_150px_150px] gap-4 px-4 pb-2">
            <SortHeader label="Title" sortKey="title" active={sortKey === 'title'} dir={sortDir} onClick={() => toggleSort('title')} />
            <SortHeader label="Type" sortKey="type" active={sortKey === 'type'} dir={sortDir} onClick={() => toggleSort('type')} />
            <SortHeader label="Release" sortKey="date" active={sortKey === 'date'} dir={sortDir} onClick={() => toggleSort('date')} />
            <SortHeader label="Buzz" sortKey="buzz" active={sortKey === 'buzz'} dir={sortDir} onClick={() => toggleSort('buzz')} />
          </div>

          {filtered.map(release => {
            const released = isReleased(release.id, release.releaseDate)
            const isActive = activeRelease?.id === release.id
            const effectiveSourceUrl = sourceUrls[release.id] ?? release.sourceUrl ?? (release.type !== 'music_video' ? getFallbackUrl(release) : '')
            const effectiveBuzz = buzzOverrides[release.id]?.buzz ?? release.buzz
            const effectiveDelta = buzzOverrides[release.id]?.delta ?? release.buzzDelta
            const resStatus = researchStatus[release.id] ?? 'idle'

            return (
              <div
                key={release.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveRelease(isActive ? null : release)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActiveRelease(isActive ? null : release) }}
                className={`w-full cursor-pointer text-left grid grid-cols-[minmax(180px,1fr)_90px_150px_150px] gap-4 items-start px-4 py-3.5 rounded-xl border transition ${
                  isActive
                    ? released ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/30 bg-white/[0.06]'
                    : released ? 'border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]' : 'border-white/[0.06] hover:bg-white/[0.03]'
                }`}
              >
                {/* Title */}
                <div>
                  <div className="flex items-center gap-2">
                    {effectiveSourceUrl ? (
                      <a
                        href={effectiveSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className={`text-sm font-medium leading-snug hover:underline underline-offset-2 ${released ? 'text-amber-100' : 'text-white'}`}
                      >
                        {release.title}
                      </a>
                    ) : (
                      <span className={`text-sm font-medium leading-snug ${released ? 'text-amber-100' : 'text-white'}`}>
                        {release.title}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className={`text-xs ${released ? 'text-amber-300/50' : 'text-white/35'}`}>
                      {release.artist ? `${release.artist} · ${release.genre}` : release.genre}
                    </p>
                    <button
                      onClick={e => { e.stopPropagation(); researchRelease(release) }}
                      disabled={resStatus === 'checking'}
                      title="AI research: update trending, buzz, date & video link (finishes with a live YouTube/web verification check)"
                      className="text-[10px] text-white/15 hover:text-white/50 transition disabled:opacity-30 shrink-0"
                    >
                      {resStatus === 'checking' ? '⟳' : resStatus === 'done' ? '✓' : '⟳'}
                    </button>
                  </div>
                  {researchedAt[release.id] && (
                    <p className="text-[10px] text-white/15 mt-0.5">as of {formatAsOf(researchedAt[release.id])}</p>
                  )}
                </div>

                {/* Type */}
                <span className={`text-xs pt-0.5 ${released ? 'text-amber-400/60' : 'text-white/40'}`}>
                  {TYPE_LABEL[release.type]}
                </span>

                {/* Date — stop propagation so clicking inside doesn't toggle drawer */}
                <div onClick={e => e.stopPropagation()}>
                  <DateCell
                    release={release}
                    dateOverride={dateOverrides[release.id] ?? null}
                    verifyStatus={verifyStatus[release.id] ?? 'idle'}
                    verifyNote={verifyNotes[release.id] ?? null}
                    onDateSave={saveDateOverride}
                    onVerify={verifyRelease}
                  />
                </div>

                {/* Buzz */}
                <BuzzBar value={effectiveBuzz} delta={effectiveDelta} />
              </div>
            )
          })}
        </div>
      </div>

      {activeRelease && (
        <ClipDrawer
          release={activeRelease}
          sourceUrl={sourceUrls[activeRelease.id] ?? activeRelease.sourceUrl ?? (activeRelease.type !== 'music_video' ? getFallbackUrl(activeRelease) : '')}
          onClose={closeDrawer}
          onSourceUrlSave={saveSourceUrl}
        />
      )}
    </main>
  )
}
