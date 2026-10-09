import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { urls } from "../api/client";
import type { MediaItem } from "../api/types";

interface AudioPlayerState {
  queue: MediaItem[];
  index: number;
  current: MediaItem | null;
  playing: boolean;
  audioRef: RefObject<HTMLAudioElement>;
  playQueue: (items: MediaItem[], startIndex?: number) => void;
  enqueue: (items: MediaItem[]) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  jump: (index: number) => void;
  remove: (index: number) => void;
  clear: () => void;
}

const PlayerContext = createContext<AudioPlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = queue[index] ?? null;

  // Load source whenever the current track changes.
  const currentId = current?.id;
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!currentId) {
      a.pause();
      a.removeAttribute("src");
      a.load();
      return;
    }
    a.src = urls.stream(currentId);
    a.play().catch(() => setPlaying(false));
  }, [currentId]);

  const playQueue = useCallback((items: MediaItem[], startIndex = 0) => {
    const tracks = items.filter((i) => i.kind === "audio");
    if (tracks.length === 0) return;
    const startId = items[startIndex]?.id;
    const idx = Math.max(0, tracks.findIndex((t) => t.id === startId));
    setQueue(tracks);
    setIndex(idx);
    // Same track re-selected: restart it.
    const a = audioRef.current;
    if (a && tracks[idx]?.id === currentIdRef.current) {
      a.currentTime = 0;
      void a.play().catch(() => undefined);
    }
  }, []);
  const currentIdRef = useRef<string | undefined>(currentId);
  currentIdRef.current = currentId;

  const enqueue = useCallback((items: MediaItem[]) => {
    const tracks = items.filter((i) => i.kind === "audio");
    setQueue((q) => q.concat(tracks));
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, []);
  const pause = useCallback(() => audioRef.current?.pause(), []);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < queueLenRef.current) return i + 1;
      audioRef.current?.pause();
      return i;
    });
  }, []);
  const prev = useCallback(() => {
    const a = audioRef.current;
    if (a && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const queueLenRef = useRef(0);
  queueLenRef.current = queue.length;

  const jump = useCallback((i: number) => setIndex(i), []);
  const remove = useCallback(
    (i: number) => {
      setQueue((q) => q.filter((_, j) => j !== i));
      setIndex((cur) => (i < cur ? cur - 1 : cur));
    },
    [],
  );
  const clear = useCallback(() => {
    setQueue([]);
    setIndex(0);
  }, []);

  // Media Session integration (lock screen / hardware keys).
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist ?? "",
        album: current.album ?? "",
        artwork: current.hasThumbnail ? [{ src: urls.thumbnail(current.id, 512), sizes: "512x512", type: "image/jpeg" }] : [],
      });
      navigator.mediaSession.setActionHandler("nexttrack", next);
      navigator.mediaSession.setActionHandler("previoustrack", prev);
    } catch {
      /* unsupported */
    }
  }, [current, next, prev]);

  const value = useMemo(
    () => ({ queue, index, current, playing, audioRef, playQueue, enqueue, toggle, pause, next, prev, jump, remove, clear }),
    [queue, index, current, playing, playQueue, enqueue, toggle, pause, next, prev, jump, remove, clear],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={next}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): AudioPlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}
