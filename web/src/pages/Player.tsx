import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type HlsType from "hls.js";
import { api, urls } from "../api/client";
import type { MediaItem } from "../api/types";
import {
  IconArrowLeft,
  IconBack10,
  IconCC,
  IconExitFullscreen,
  IconFullscreen,
  IconFwd10,
  IconMute,
  IconPause,
  IconPlay,
  IconVolume,
} from "../components/Icons";
import { ErrorState, Spinner } from "../components/States";
import { usePlayer } from "../context/PlayerContext";
import { formatEpisode, formatTime, shouldOfferResume } from "../lib/format";

type Mode = "direct" | "hls";
const PROGRESS_INTERVAL_MS = 10_000;

export default function PlayerPage() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { pause: pauseAudio } = usePlayer();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);

  useEffect(() => {
    pauseAudio();
    let cancelled = false;
    setItem(null);
    setStartAt(null);
    api
      .item(id)
      .then((it) => {
        if (cancelled) return;
        setItem(it);
        const resume = sp.get("resume");
        const t = Number(sp.get("t"));
        if (Number.isFinite(t) && t > 0) setStartAt(t);
        else if (!shouldOfferResume(it) || resume === "0") setStartAt(0);
        else if (resume === "1") setStartAt(it.progress?.positionSec ?? 0);
        // otherwise leave null -> prompt
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate(`/media/${encodeURIComponent(id)}`);
  }, [navigate, id]);

  if (error)
    return (
      <div className="player-page center">
        <ErrorState error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  if (!item)
    return (
      <div className="player-page center">
        <Spinner />
      </div>
    );

  if (startAt === null) {
    return (
      <div className="player-page center">
        {item.hasThumbnail ? <img className="player-poster" src={urls.thumbnail(item.id, 1280)} alt="" /> : null}
        <div className="resume-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title">
          <div className="eyebrow">{item.series ? `${item.series.name} · ${formatEpisode(item.series)}` : "Continue watching"}</div>
          <h2 id="resume-title">{item.title}</h2>
          <p className="muted">
            You stopped at {formatTime(item.progress?.positionSec)} of {formatTime(item.durationSec)}.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" autoFocus onClick={() => setStartAt(item.progress?.positionSec ?? 0)}>
              <IconPlay size={18} /> Resume from {formatTime(item.progress?.positionSec)}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStartAt(0)}>
              Start over
            </button>
          </div>
          <button type="button" className="link-btn" onClick={goBack}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return <VideoPlayer item={item} startAt={startAt} onBack={goBack} />;
}

function VideoPlayer({ item, startAt, onBack }: { item: MediaItem; startAt: number; onBack: () => void }) {
  const mode: Mode = item.directPlayable ? "direct" : "hls";
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  // HLS transcodes are requested with ?start=<reqStart>. The contract doesn't pin down the
  // playlist timeline, so we detect it: a VOD playlist covering the whole file is
  // "absolute" (currentTime == media time, seek freely); a shorter/live playlist is
  // "relative" (media time = offset + currentTime, and seeking outside it restarts the
  // transcode at the new point).
  const [reqStart, setReqStart] = useState(mode === "hls" ? Math.floor(startAt) : 0);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const absoluteRef = useRef<boolean>(mode === "direct");

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(startAt);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subIdx, setSubIdx] = useState(-1);
  const [subMenu, setSubMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<number>();
  const toastTimer = useRef<number>();
  const lastSaved = useRef<number>(-1);
  // Don't report progress until playback has really started at the requested point;
  // otherwise a failed load would overwrite the saved resume position with 0.
  const startedRef = useRef(false);

  const duration = item.durationSec ?? (Number.isFinite(mediaDuration) ? mediaDuration : 0);
  const src = mode === "direct" ? urls.stream(item.id) : urls.hls(item.id, reqStart);

  const absTime = useCallback(() => offsetRef.current + (videoRef.current?.currentTime ?? 0), []);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 900);
  };

  // ---- progress reporting --------------------------------------------------
  const saveProgress = useCallback(
    (opts: { completed?: boolean; keepalive?: boolean } = {}) => {
      if (!startedRef.current && !opts.completed) return;
      const pos = Math.floor(absTime());
      if (!opts.completed && Math.abs(pos - lastSaved.current) < 1) return;
      lastSaved.current = pos;
      api.saveProgress(item.id, { positionSec: pos, ...(opts.completed ? { completed: true } : {}) }, !!opts.keepalive).catch(() => undefined);
    },
    [absTime, item.id],
  );

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => saveProgress(), PROGRESS_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [playing, saveProgress]);

  useEffect(() => {
    const onHide = () => saveProgress({ keepalive: true });
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVis);
      saveProgress({ keepalive: true }); // leaving the player route
    };
  }, [saveProgress]);

  // ---- source attach (direct / hls.js / native HLS) -------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    setFatal(null);
    setWaiting(true);

    const startPlayback = () => {
      v.play().catch(() => {
        /* autoplay blocked: user presses play */
      });
    };

    if (mode === "direct") {
      v.src = src;
      const onMeta = () => {
        if (startAt > 0 && Math.abs(v.currentTime - startAt) > 1) v.currentTime = startAt;
        startPlayback();
      };
      v.addEventListener("loadedmetadata", onMeta, { once: true });
      return () => {
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeAttribute("src");
        v.load();
      };
    }

    // Decide the timeline once the playlist duration is known.
    const settleTimeline = (playlistDuration: number, live: boolean) => {
      const full = item.durationSec ? playlistDuration >= item.durationSec * 0.9 : !live;
      absoluteRef.current = full && !live;
      const off = absoluteRef.current ? 0 : reqStart;
      offsetRef.current = off;
      setOffset(off);
    };
    const seekToStartIfAbsolute = () => {
      if (absoluteRef.current && reqStart > 0 && Math.abs(v.currentTime - reqStart) > 2) v.currentTime = reqStart;
    };

    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30, backBufferLength: 60 });
        hlsRef.current = hls;
        let settled = false;
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
          if (settled) return;
          settled = true;
          settleTimeline(data.details.totalduration, data.details.live);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setFatal("This video could not be played.");
        });
        v.addEventListener("loadedmetadata", seekToStartIfAbsolute, { once: true });
        hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
        hls.loadSource(src);
        hls.attachMedia(v);
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = src; // Safari / iOS native HLS
        v.addEventListener(
          "loadedmetadata",
          () => {
            settleTimeline(Number.isFinite(v.duration) ? v.duration : 0, !Number.isFinite(v.duration));
            seekToStartIfAbsolute();
            startPlayback();
          },
          { once: true },
        );
      } else {
        setFatal("Your browser cannot play HLS streams.");
      }
    });
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, mode]);

  // ---- subtitles -------------------------------------------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const apply = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i];
        if (tt) tt.mode = i === subIdx ? "showing" : "disabled";
      }
    };
    apply();
    v.textTracks.addEventListener?.("addtrack", apply);
    return () => v.textTracks.removeEventListener?.("addtrack", apply);
  }, [subIdx, src]);

  // Subtitle cues are in absolute media time; shift them for offset HLS streams.
  const onTrackLoad = (e: SyntheticEvent<HTMLTrackElement>) => {
    const track = e.currentTarget.track;
    const off = offsetRef.current;
    if (!off || !track.cues) return;
    for (let i = 0; i < track.cues.length; i++) {
      const c = track.cues[i];
      if (!c) continue;
      c.startTime = Math.max(0, c.startTime - off);
      c.endTime = Math.max(0, c.endTime - off);
    }
  };

  // ---- controls --------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekTo = useCallback(
    (target: number) => {
      const v = videoRef.current;
      if (!v) return;
      const t = Math.max(0, Math.min(duration > 0 ? duration - 1 : Infinity, target));
      setTime(t);
      if (mode === "direct") {
        v.currentTime = t;
        return;
      }
      if (absoluteRef.current) {
        v.currentTime = t; // server transcodes whichever segment is requested
        return;
      }
      const rel = t - offsetRef.current;
      const seekableEnd = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
      if (rel >= 0 && rel <= seekableEnd) v.currentTime = rel;
      else {
        // Outside the transcoded window: restart the transcode at the new point.
        saveProgress();
        setReqStart(Math.floor(t));
      }
    },
    [duration, mode, saveProgress],
  );

  const skip = useCallback(
    (d: number) => {
      seekTo(absTime() + d);
      flash(d > 0 ? `+${d}s` : `${d}s`);
    },
    [absTime, seekTo],
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [volume, muted]);

  const poke = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControlsVisible(false);
        setSubMenu(false);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    if (!playing) setControlsVisible(true);
    else poke();
  }, [playing, poke]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
      if (tag === "SELECT" || tag === "TEXTAREA") return;
      let handled = true;
      switch (e.key) {
        case " ":
        case "k":
          if (tag === "BUTTON") return; // let the focused button activate
          togglePlay();
          break;
        case "ArrowLeft":
        case "j":
          skip(-10);
          break;
        case "ArrowRight":
        case "l":
          skip(10);
          break;
        case "ArrowUp":
          setVolume((x) => Math.min(1, +(x + 0.1).toFixed(2)));
          setMuted(false);
          flash("Volume up");
          break;
        case "ArrowDown":
          setVolume((x) => Math.max(0, +(x - 0.1).toFixed(2)));
          flash("Volume down");
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          setMuted((m) => !m);
          break;
        case "c":
          if (item.subtitles.length) setSubIdx((i) => (i + 1 >= item.subtitles.length ? -1 : i + 1));
          break;
        case "Escape":
          if (!document.fullscreenElement) onBack();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        poke();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, skip, toggleFullscreen, poke, onBack, item.subtitles.length]);

  const shown = Math.min(time, duration || time);
  const pct = duration ? (shown / duration) * 100 : 0;
  const bufPct = duration ? Math.min(100, ((offset + bufferedEnd) / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      className={`player-page player ${controlsVisible ? "controls-on" : "controls-off"}`}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        crossOrigin="anonymous"
        preload="auto"
        poster={item.hasThumbnail ? urls.thumbnail(item.id, 1280) : undefined}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          saveProgress();
        }}
        onEnded={() => {
          setPlaying(false);
          saveProgress({ completed: true });
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => {
          setWaiting(false);
          startedRef.current = true;
        }}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(offsetRef.current + e.currentTarget.currentTime)}
        onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          setBufferedEnd(b.length ? b.end(b.length - 1) : 0);
        }}
        onError={() => {
          if (mode === "direct") setFatal("This file could not be played in the browser.");
        }}
      >
        {item.subtitles.map((s) => (
          <track
            key={`${s.id}-${src}`}
            kind="subtitles"
            src={urls.subtitle(item.id, s.id)}
            srcLang={s.language ?? undefined}
            label={s.label}
            onLoad={onTrackLoad}
          />
        ))}
      </video>

      {waiting && !fatal ? (
        <div className="player-center" aria-hidden="true">
          <span className="spinner large" />
        </div>
      ) : null}
      {!playing && !waiting && !fatal ? (
        <button type="button" className="player-bigplay" onClick={togglePlay} aria-label="Play">
          <IconPlay size={40} />
        </button>
      ) : null}
      {toast ? <div className="player-toast">{toast}</div> : null}
      {fatal ? (
        <div className="player-center">
          <div className="player-error">
            <strong>{fatal}</strong>
            {mode === "direct" ? <span className="muted">Codec: {item.videoCodec ?? "?"} / {item.audioCodec ?? "?"}</span> : null}
            <button type="button" className="btn btn-ghost" onClick={onBack}>
              Go back
            </button>
          </div>
        </div>
      ) : null}

      <div className="player-top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <IconArrowLeft size={22} />
        </button>
        <div className="player-heading">
          {item.series ? (
            <span className="eyebrow">
              {item.series.name} · {formatEpisode(item.series)}
            </span>
          ) : null}
          <strong>{item.title}</strong>
        </div>
        {mode === "hls" ? <span className="chip chip-warn">Transcoding</span> : null}
      </div>

      <div className="player-bottom">
        <div className="seek">
          <div className="seek-track" aria-hidden="true">
            <div className="seek-buffer" style={{ left: `${duration ? (offset / duration) * 100 : 0}%`, width: `${Math.max(0, bufPct - (duration ? (offset / duration) * 100 : 0))}%` }} />
            <div className="seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={shown}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
            onKeyDown={(e) => {
              // Arrow keys handled globally (10s steps).
              if (e.key.startsWith("Arrow")) e.preventDefault();
            }}
          />
        </div>
        <div className="player-controls">
          <div className="pc-left">
            <button type="button" className="icon-btn" onClick={togglePlay} aria-label={playing ? "Pause (space)" : "Play (space)"}>
              {playing ? <IconPause size={24} /> : <IconPlay size={24} />}
            </button>
            <button type="button" className="icon-btn" onClick={() => skip(-10)} aria-label="Back 10 seconds">
              <IconBack10 size={24} />
            </button>
            <button type="button" className="icon-btn" onClick={() => skip(10)} aria-label="Forward 10 seconds">
              <IconFwd10 size={24} />
            </button>
            <div className="volume">
              <button type="button" className="icon-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute (m)" : "Mute (m)"}>
                {muted || volume === 0 ? <IconMute size={22} /> : <IconVolume size={22} />}
              </button>
              <input
                type="range"
                className="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                aria-label="Volume"
                style={{ ["--fill" as string]: `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>
            <span className="time">
              {formatTime(shown)} <span className="muted">/ {formatTime(duration)}</span>
            </span>
          </div>
          <div className="pc-right">
            {item.subtitles.length > 0 ? (
              <div className="menu-wrap">
                <button
                  type="button"
                  className={`icon-btn ${subIdx >= 0 ? "active" : ""}`}
                  onClick={() => setSubMenu((s) => !s)}
                  aria-label="Subtitles (c)"
                  aria-expanded={subMenu}
                >
                  <IconCC size={22} />
                </button>
                {subMenu ? (
                  <div className="menu" role="menu">
                    <div className="menu-title">Subtitles</div>
                    <button type="button" role="menuitemradio" aria-checked={subIdx === -1} className={subIdx === -1 ? "on" : ""} onClick={() => { setSubIdx(-1); setSubMenu(false); }}>
                      Off
                    </button>
                    {item.subtitles.map((s, i) => (
                      <button key={s.id} type="button" role="menuitemradio" aria-checked={subIdx === i} className={subIdx === i ? "on" : ""} onClick={() => { setSubIdx(i); setSubMenu(false); }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}>
              {fullscreen ? <IconExitFullscreen size={22} /> : <IconFullscreen size={22} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
