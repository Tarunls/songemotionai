"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, LogOut, Music, Volume2, Disc3, SlidersHorizontal, X } from "lucide-react";
import Fog from "./Fog";

/* ── Types ── */
interface LyricLine { timeMs: number; text: string; }
interface SpotifyTrack {
  id: string; name: string; artist: string; album: string;
  durationMs: number; progressMs: number; isPlaying: boolean;
}

/* ── Parse LRC format into millisecond-precision objects ── */
function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const match = raw.match(/\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/);
    if (match) {
      const text = match[3].trim();
      if (text) {
        const mins = parseInt(match[1]);
        const secs = parseFloat(match[2]);
        const timeMs = Math.round((mins * 60 + secs) * 1000);
        lines.push({ timeMs, text });
      }
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

/* ── 5-Slider Dimensions ── */
const DIMENSIONS = [
  { key: "user_intensity", label: "Intensity", low: "Calm", high: "Explosive" },
  { key: "user_mood",      label: "Mood",      low: "Melancholy", high: "Euphoric" },
  { key: "user_groove",    label: "Groove",     low: "Stiff", high: "Bouncy" },
  { key: "user_tone",      label: "Tone",       low: "Dark", high: "Bright" },
  { key: "user_texture",   label: "Texture",    low: "Minimal", high: "Complex" },
] as const;

/* ── Lyrics Visualizer (runs entirely in milliseconds) ── */
function LyricsVisualizer({ lyrics, progressMs }: { lyrics: LyricLine[]; progressMs: number }) {
  if (lyrics.length === 0) {
    return (
      <div className="text-center opacity-30 text-sm tracking-[0.3em] uppercase">
        No synced lyrics available
      </div>
    );
  }

  // STRICT sequential line selection: find the last line whose timeMs <= progressMs
  let activeIdx = 0;
  for (let i = 0; i < lyrics.length; i++) {
    if (progressMs >= lyrics[i].timeMs) activeIdx = i;
    else break;
  }

  // Visible window: 2 past, current, 4 future
  const wStart = Math.max(0, activeIdx - 2);
  const wEnd = Math.min(lyrics.length, activeIdx + 5);
  const visible = lyrics.slice(wStart, wEnd);

  return (
    <div className="relative flex flex-col items-center justify-center gap-6 select-none pointer-events-none">
      <AnimatePresence mode="popLayout">
        {visible.map((l) => {
          const idx = lyrics.indexOf(l);
          const isActive = idx === activeIdx;
          const isPast = idx < activeIdx;
          const isFuture = idx > activeIdx;
          const dist = Math.abs(idx - activeIdx);

          let targetOpacity = 0;
          let targetY = 0;
          let targetBlur = 0;
          let targetScale = 1;

          if (isActive) {
            targetOpacity = 1;
            targetY = 0;
            targetBlur = 0;
            targetScale = 1;
          } else if (isPast) {
            // Wispy dissolve exit
            targetOpacity = 0;
            targetY = -20 - (dist * 10);
            targetBlur = 8 + (dist * 2);
            targetScale = 1.05;
          } else if (isFuture) {
            // Ethereal emerging
            targetOpacity = Math.max(0.05, 0.3 - dist * 0.05);
            targetY = 10 + (dist * 5);
            targetBlur = 3 + dist;
            targetScale = 0.95 - (dist * 0.02);
          }

          return (
            <motion.div
              key={`line-${idx}`}
              layout
              initial={{ opacity: 0, y: 20, filter: "blur(10px)", scale: 0.9 }}
              animate={{
                opacity: targetOpacity,
                y: targetY,
                filter: `blur(${targetBlur}px)`,
                scale: targetScale,
              }}
              exit={{ opacity: 0, y: -40, filter: "blur(12px)", scale: 1.1 }}
              transition={{ 
                duration: isActive ? 1.0 : 1.2, 
                ease: isActive ? [0.2, 0.65, 0.3, 0.9] : "easeOut" 
              }}
              className="text-center"
            >
              <span 
                className={`inline-block tracking-wide font-light transition-all duration-1000 ${
                  isActive 
                    ? "text-2xl md:text-4xl text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]" 
                    : "text-lg md:text-2xl text-white/50"
                }`}
              >
                {l.text}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Page ── */
export default function Home() {
  const { data: session, status } = useSession();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [volume, setVolume] = useState(50);
  const [valence, setValence] = useState(0.5);
  const [arousal, setArousal] = useState(0.5);

  // Spotify real-time state
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastTrackId = useRef<string | null>(null);

  // Authoritative progress anchor from Spotify polls
  const anchorProgressMs = useRef(0);
  const anchorTimestamp = useRef(Date.now());
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // ML Sliders modal
  const [showSliders, setShowSliders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fingerprint, setFingerprint] = useState({
    user_intensity: 50, user_mood: 50, user_groove: 50, user_tone: 50, user_texture: 50,
  });

  // Mouse tracking
  useEffect(() => {
    const handler = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  // Fetch synced lyrics via our FastAPI backend (/api/lyrics → LRCLIB)
  const fetchLyrics = useCallback(async (trackName: string, artistName: string, durationMs: number) => {
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      const params = new URLSearchParams({
        track_name: trackName,
        artist_name: artistName,
        duration_ms: String(durationMs),
      });
      const res = await fetch(`${backendUrl}/api/lyrics?${params}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.synced && data.lyrics) {
          setLyrics(parseLRC(data.lyrics));
          return;
        }
      }
    } catch (e) { console.error("Lyrics fetch error:", e); }
    setLyrics([]);
  }, []);

  // Poll Spotify every 2s — sets the authoritative anchor
  useEffect(() => {
    if (status !== "authenticated" || !(session as any)?.accessToken) return;
    const poll = async () => {
      try {
        const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: `Bearer ${(session as any).accessToken}` },
        });
        if (res.status === 200) {
          const data = await res.json();
          if (data?.item) {
            const t: SpotifyTrack = {
              id: data.item.id,
              name: data.item.name,
              artist: data.item.artists?.map((a: any) => a.name).join(", ") || "Unknown",
              album: data.item.album?.name || "Unknown",
              durationMs: data.item.duration_ms,
              progressMs: data.progress_ms || 0,
              isPlaying: data.is_playing || false,
            };
            setTrack(t);
            setIsPlaying(t.isPlaying);
            // Reset the anchor to Spotify's authoritative position
            anchorProgressMs.current = t.progressMs;
            anchorTimestamp.current = Date.now();

            if (t.id !== lastTrackId.current) {
              lastTrackId.current = t.id;
              fetchLyrics(t.name, t.artist.split(",")[0].trim(), t.durationMs);
            }
          }
        } else if (res.status === 204) {
          setTrack(null);
          setIsPlaying(false);
        }
      } catch (e) { console.error("Spotify poll error:", e); }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [status, session, fetchLyrics]);

  // Smooth client-side interpolation: anchor + elapsed since last poll
  // This ONLY reads from the anchor, never writes back — so no double counting
  useEffect(() => {
    const id = setInterval(() => {
      if (isPlayingRef.current) {
        const elapsed = Date.now() - anchorTimestamp.current;
        setProgressMs(anchorProgressMs.current + elapsed);
      }
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Fetch emotion from backend when track changes
  useEffect(() => {
    if (status !== "authenticated" || !track) return;
    const fetchEmotion = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
        const res = await fetch(`${backendUrl}/analyze?track_id=${track.id}`);
        const data = await res.json();
        setValence(data.valence); setArousal(data.arousal);
      } catch { /* silent */ }
    };
    fetchEmotion();
  }, [track?.id, status]);

  // Submit fingerprint
  const submitFingerprint = async () => {
    setIsSubmitting(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      await fetch(`${backendUrl}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: track?.id || "unknown", ...fingerprint }),
      });
    } catch { /* silent */ }
    setIsSubmitting(false);
    setShowSliders(false);
  };

  const progressSec = progressMs / 1000; // kept for time display formatting only
  const durationSec = (track?.durationMs || 1) / 1000;
  const progressPct = Math.min((progressMs / (track?.durationMs || 1)) * 100, 100);

  /* ── Loading ── */
  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center uppercase tracking-widest opacity-50 text-white">Calibrating...</div>;
  }

  /* ── Unauthenticated ── */
  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-12 text-white">
        <Fog valence={0.5} arousal={0.3} mousePos={mousePos} />
        <motion.h1 initial={{ opacity: 0, filter: "blur(10px)" }} animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 2 }} className="text-5xl md:text-8xl tracking-tighter mix-blend-difference text-white z-10">
          Global Emotion Map
        </motion.h1>
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 1 }}
          onClick={() => signIn("spotify")}
          className="px-8 py-4 rounded-full border border-white hover:bg-white hover:text-black transition-colors flex items-center space-x-3 uppercase tracking-widest text-sm mix-blend-difference z-10">
          <LogIn size={18} /><span>Synchronize Spotify</span>
        </motion.button>
      </div>
    );
  }

  /* ── Authenticated Dashboard ── */
  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col text-white">
      <Fog valence={valence} arousal={arousal} mousePos={mousePos} />

      {/* ── Header ── */}
      <header className="relative z-10 flex items-center justify-between px-8 pt-6 pb-4">
        <div className="flex items-center space-x-4">
          {track ? (
            <>
              <Disc3 size={18} className={`opacity-60 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
              <div className="flex flex-col">
                <span className="text-xs opacity-50 uppercase tracking-[0.25em]">{track.artist}</span>
                <span className="text-sm font-semibold tracking-widest uppercase">{track.name}</span>
                <span className="text-[10px] opacity-40 uppercase tracking-widest mt-0.5">{track.album}</span>
              </div>
            </>
          ) : (
            <>
              <Music size={18} className="opacity-40" />
              <span className="text-sm opacity-40 tracking-widest uppercase">Play something on Spotify</span>
            </>
          )}
        </div>
        <div className="flex items-center space-x-5">
          <span className="text-xs opacity-50 tracking-[0.3em] uppercase">{session.user?.name || "DISUNITE"}</span>
          <button onClick={() => signOut()} className="opacity-30 hover:opacity-100 transition-opacity">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Lyrics (Center) ── */}
      <div className="flex-1 flex items-center justify-center z-10 px-8">
        <div className="w-full max-w-2xl">
          {track ? (
            <LyricsVisualizer lyrics={lyrics} progressMs={progressMs} />
          ) : (
            <div className="text-center opacity-20 text-xl tracking-[0.3em] uppercase font-light">
              Waiting for playback...
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Controls ── */}
      <div className="relative z-20 px-8 pb-8 pt-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Progress bar (read-only, driven by Spotify) */}
          <div className="space-y-1.5">
            <input type="range" min="0" max="100" step="0.1" value={progressPct}
              readOnly className="w-full pointer-events-none" />
            <div className="flex justify-between text-[10px] opacity-40 tracking-widest uppercase font-mono">
              <span>{fmtTime(progressSec)}</span>
              <span>{fmtTime(durationSec)}</span>
            </div>
          </div>
          {/* Volume */}
          <div className="flex items-center space-x-3 max-w-[200px]">
            <Volume2 size={14} className="opacity-50 shrink-0" />
            <input type="range" min="0" max="100" step="1" value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value))} className="flex-1" />
            <span className="text-[10px] opacity-40 tracking-widest font-mono w-8 text-right">{volume}</span>
          </div>
        </div>
      </div>

      {/* ── Equalizer FAB (bottom-right) ── */}
      <button
        onClick={() => setShowSliders(true)}
        className="fixed bottom-8 right-8 z-30 w-12 h-12 rounded-full border border-white/30 bg-white/5 backdrop-blur-md 
          flex items-center justify-center hover:bg-white/15 hover:border-white/60 transition-all sync-btn"
      >
        <SlidersHorizontal size={18} className="opacity-70" />
      </button>

      {/* ── Glassmorphic Slider Modal ── */}
      <AnimatePresence>
        {showSliders && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 flex items-center justify-center"
            onClick={() => setShowSliders(false)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="relative z-50 w-full max-w-md mx-4 rounded-2xl border border-white/15 bg-white/5 backdrop-blur-xl p-8 shadow-2xl"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center space-x-3">
                  <SlidersHorizontal size={16} className="opacity-60" />
                  <span className="text-xs tracking-[0.3em] uppercase opacity-60">Emotional Fingerprint</span>
                </div>
                <button onClick={() => setShowSliders(false)} className="opacity-40 hover:opacity-100 transition-opacity">
                  <X size={18} />
                </button>
              </div>

              {/* 5 ML Sliders */}
              <div className="space-y-6">
                {DIMENSIONS.map((dim) => (
                  <div key={dim.key}>
                    <div className="flex justify-between text-[10px] uppercase tracking-widest mb-2 opacity-50">
                      <span>{dim.low}</span>
                      <span className="opacity-100 font-semibold">{dim.label} — {fingerprint[dim.key as keyof typeof fingerprint]}</span>
                      <span>{dim.high}</span>
                    </div>
                    <input
                      type="range" min="0" max="100" step="1"
                      value={fingerprint[dim.key as keyof typeof fingerprint]}
                      onChange={(e) => setFingerprint(prev => ({ ...prev, [dim.key]: parseInt(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>

              {/* Submit */}
              <button
                onClick={submitFingerprint}
                disabled={isSubmitting || !track}
                className="w-full mt-8 py-3 rounded-full border border-white/40 hover:border-white hover:bg-white hover:text-black 
                  transition-all uppercase tracking-[0.2em] text-[11px] font-medium bg-white/5 
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Synchronizing..." : !track ? "Play a Track First" : "Synchronize to Spotify"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
