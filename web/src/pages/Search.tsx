import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { MediaItem } from "../api/types";
import { IconSearch } from "../components/Icons";
import { MediaCard } from "../components/MediaCard";
import { rovingKeys } from "../components/Row";
import { EmptyState, ErrorState, Spinner } from "../components/States";
import { useDebounced } from "../lib/hooks";
import { TrackList } from "./Music";

export default function Search() {
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get("q") ?? "");
  const q = useDebounced(text.trim(), 300);
  const [results, setResults] = useState<MediaItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSp(q ? { q } : {}, { replace: true });
    if (!q) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .media({ q, limit: 100, sort: "title" }, ctrl.signal)
      .then((p) => {
        setResults(p.items);
        setTotal(p.total);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const videos = results?.filter((r) => r.kind === "video") ?? [];
  const audio = results?.filter((r) => r.kind === "audio") ?? [];
  const images = results?.filter((r) => r.kind === "image") ?? [];

  return (
    <div className="page">
      <div className="searchbox">
        <IconSearch size={22} />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search titles, artists, albums, files…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search"
          enterKeyHint="search"
        />
        {loading ? <span className="spinner small" /> : null}
      </div>
      {error ? <ErrorState error={error} /> : null}
      {!q ? (
        <EmptyState title="Find anything" icon={<IconSearch size={36} />}>
          Search across every library by title, file name, artist or album.
        </EmptyState>
      ) : null}
      {q && results && results.length === 0 && !loading ? <EmptyState title={`No results for “${q}”`}>Try a shorter or different term.</EmptyState> : null}
      {results && results.length > 0 ? (
        <p className="muted results-count">
          {total.toLocaleString()} result{total === 1 ? "" : "s"}
          {total > results.length ? ` · showing first ${results.length}` : ""}
        </p>
      ) : null}
      {results === null && loading ? <Spinner /> : null}
      {videos.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Videos</h2>
          <div className="grid grid-landscape" onKeyDown={(e) => rovingKeys(e, "grid")}>
            {videos.map((it) => (
              <MediaCard key={it.id} item={it} />
            ))}
          </div>
        </section>
      ) : null}
      {audio.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Music</h2>
          <TrackList items={audio} />
        </section>
      ) : null}
      {images.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Photos</h2>
          <div className="grid grid-photo" onKeyDown={(e) => rovingKeys(e, "grid")}>
            {images.map((it) => (
              <MediaCard key={it.id} item={it} shape="square" onActivate={(i) => navigate(`/media/${encodeURIComponent(i.id)}`)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
