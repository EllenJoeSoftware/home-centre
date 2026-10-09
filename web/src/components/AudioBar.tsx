import { useEffect, useState } from "react";
import { usePlayer } from "../context/PlayerContext";
import { formatTime } from "../lib/format";
import { Artwork } from "./Artwork";
import { IconClose, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconVolume, IconMute } from "./Icons";

function useAudioTime(audio: HTMLAudioElement | null) {
  const [t, setT] = useState({ time: 0, duration: 0, buffered: 0 });
  useEffect(() => {
    if (!audio) return;
    const update = () => {
      const b = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
      setT({ time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0, buffered: b });
    };
    const evs = ["timeupdate", "durationchange", "loadedmetadata", "progress", "emptied"];
    evs.forEach((e) => audio.addEventListener(e, update));
    update();
    return () => evs.forEach((e) => audio.removeEventListener(e, update));
  }, [audio]);
  return t;
}

export function AudioBar() {
  const { current, queue, index, playing, audioRef, toggle, next, prev, jump, remove, clear } = usePlayer();
  const [showQueue, setShowQueue] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const audio = audioRef.current;
  const { time, duration } = useAudioTime(current ? audio : null);
  const dur = duration || current?.durationSec || 0;

  useEffect(() => {
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [audio, volume, muted]);

  if (!current) return null;

  return (
    <div className="audiobar" role="region" aria-label="Audio player">
      <div className="audiobar-progress" aria-hidden="true">
        <div style={{ width: dur ? `${(time / dur) * 100}%` : "0%" }} />
      </div>
      <div className="audiobar-inner">
        <div className="audiobar-meta">
          <Artwork item={current} width={120} className="audiobar-art" />
          <div className="audiobar-text">
            <div className="audiobar-title" title={current.title}>
              {current.title}
            </div>
            <div className="audiobar-sub">{[current.artist, current.album].filter(Boolean).join(" · ") || "Unknown artist"}</div>
          </div>
        </div>

        <div className="audiobar-center">
          <div className="audiobar-controls">
            <button type="button" className="icon-btn" onClick={prev} aria-label="Previous track">
              <IconPrev size={18} />
            </button>
            <button type="button" className="icon-btn play-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <button type="button" className="icon-btn" onClick={next} disabled={index >= queue.length - 1} aria-label="Next track">
              <IconNext size={18} />
            </button>
          </div>
          <div className="audiobar-seek">
            <span className="time">{formatTime(time)}</span>
            <input
              type="range"
              className="range"
              min={0}
              max={dur || 0}
              step={1}
              value={Math.min(time, dur || 0)}
              onChange={(e) => {
                if (audio) audio.currentTime = Number(e.target.value);
              }}
              aria-label="Seek"
              style={{ ["--fill" as string]: dur ? `${(time / dur) * 100}%` : "0%" }}
            />
            <span className="time">{formatTime(dur)}</span>
          </div>
        </div>

        <div className="audiobar-right">
          <div className="audiobar-volume">
            <button type="button" className="icon-btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
              {muted || volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}
            </button>
            <input
              type="range"
              className="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              aria-label="Volume"
              style={{ ["--fill" as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>
          <button
            type="button"
            className={`icon-btn ${showQueue ? "active" : ""}`}
            onClick={() => setShowQueue((s) => !s)}
            aria-label="Queue"
            aria-expanded={showQueue}
          >
            <IconQueue size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={clear} aria-label="Close player">
            <IconClose size={18} />
          </button>
        </div>
      </div>

      {showQueue ? (
        <div className="queue" role="dialog" aria-label="Play queue">
          <div className="queue-head">
            <h3>Up next</h3>
            <span className="muted">{queue.length} tracks</span>
          </div>
          <ol className="queue-list">
            {queue.map((t, i) => (
              <li key={`${t.id}-${i}`} className={i === index ? "current" : ""}>
                <button type="button" className="queue-item" onClick={() => jump(i)}>
                  <span className="queue-num">{i === index && playing ? <span className="eq" aria-label="Now playing"><i /><i /><i /></span> : i + 1}</span>
                  <span className="queue-title">
                    {t.title}
                    <small>{t.artist ?? ""}</small>
                  </span>
                  <span className="time">{formatTime(t.durationSec)}</span>
                </button>
                <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label={`Remove ${t.title}`}>
                  <IconClose size={14} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
