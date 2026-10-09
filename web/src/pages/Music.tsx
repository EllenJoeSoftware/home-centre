import { api } from "../api/client";
import type { MediaItem } from "../api/types";
import { Artwork } from "../components/Artwork";
import { IconMusic, IconPlay, IconPlus } from "../components/Icons";
import { readSort, SortBar } from "../components/SortBar";
import { EmptyState, ErrorState, LoadMore, Spinner } from "../components/States";
import { usePlayer } from "../context/PlayerContext";
import { formatTime } from "../lib/format";
import { usePaged } from "../lib/hooks";
import { useSearchParams, Link } from "react-router-dom";

export function TrackList({ items, showAlbum = true }: { items: MediaItem[]; showAlbum?: boolean }) {
  const { playQueue, enqueue, current, playing } = usePlayer();
  return (
    <ol className="tracklist">
      {items.map((t, i) => {
        const isCur = current?.id === t.id;
        return (
          <li key={t.id} className={isCur ? "current" : ""}>
            <button type="button" className="track" onClick={() => playQueue(items, i)} aria-label={`Play ${t.title}`}>
              <span className="track-num">
                {isCur && playing ? (
                  <span className="eq" aria-label="Now playing">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <>
                    <span className="n">{i + 1}</span>
                    <IconPlay size={14} className="p" />
                  </>
                )}
              </span>
              <Artwork item={t} width={96} className="track-art" />
              <span className="track-title">
                {t.title}
                <small>{t.artist ?? "Unknown artist"}</small>
              </span>
              {showAlbum ? <span className="track-album">{t.album ?? ""}</span> : null}
              <span className="time">{formatTime(t.durationSec)}</span>
            </button>
            <Link to={`/media/${encodeURIComponent(t.id)}`} className="icon-btn track-more" aria-label={`Details for ${t.title}`}>
              <span aria-hidden="true">⋯</span>
            </Link>
            <button type="button" className="icon-btn track-add" onClick={() => enqueue([t])} aria-label={`Add ${t.title} to queue`}>
              <IconPlus size={16} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function Music() {
  const [sp, setSp] = useSearchParams();
  const { sort, order } = readSort(sp, "title", "asc");
  const paged = usePaged((offset, limit, signal) => api.media({ kind: "audio", sort, order, offset, limit }, signal), [sort, order], {
    limit: 100,
  });
  const { playQueue } = usePlayer();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Music</h1>
          <p className="muted">{paged.total ? `${paged.total.toLocaleString()} tracks` : " "}</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-primary" disabled={paged.items.length === 0} onClick={() => playQueue(paged.items, 0)}>
            <IconPlay size={16} /> Play all
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={paged.items.length === 0}
            onClick={() => playQueue([...paged.items].sort(() => Math.random() - 0.5), 0)}
          >
            Shuffle
          </button>
          <SortBar
            sort={sort}
            order={order}
            onChange={(s, o) => setSp({ sort: s, order: o }, { replace: true })}
            fields={["title", "added", "duration", "size"]}
          />
        </div>
      </header>
      {paged.error ? <ErrorState error={paged.error} /> : null}
      {!paged.loading && !paged.error && paged.items.length === 0 ? (
        <EmptyState title="No music yet" icon={<IconMusic size={36} />}>
          MP3, FLAC, M4A, OGG and other audio files in your media folders appear here.
        </EmptyState>
      ) : null}
      <TrackList items={paged.items} />
      {paged.items.length === 0 && paged.loading ? <Spinner /> : <LoadMore onVisible={paged.loadMore} loading={paged.loading} hasMore={paged.hasMore} />}
    </div>
  );
}
