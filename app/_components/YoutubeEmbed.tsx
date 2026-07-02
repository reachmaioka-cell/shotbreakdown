'use client'

import { useEffect, useRef } from 'react'

export function parseTimecodeToSecs(t: string | null): number {
  if (!t) return 0
  const [m, s] = t.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

export function extractYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/)
  return m ? m[1] : null
}

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

// Plays a YouTube video scoped to a clip's start/end timecode — auto-pauses
// once playback reaches endTime, and exposes an imperative playClip() via
// onReady so a parent can drive playback from its own button/hover state.
export function YoutubeEmbed({ url, startTime, endTime, onReady }: {
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
          // Use the event's own target rather than playerRef.current — the
          // YT API guarantees the target passed here is fully ready to call
          // methods on, whereas the synchronous constructor return can still
          // be mid-initialization for a brief moment after onReady fires.
          onReady: (e: { target: YTPlayer }) => {
            playerRef.current = e.target
            onReadyRef.current?.(() => {
              e.target.seekTo(startSecs, true)
              e.target.playVideo()
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
