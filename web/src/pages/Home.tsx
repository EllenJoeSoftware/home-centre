import { Link, useNavigate } from "react-router-dom";
import { api, urls } from "../api/client";
import type { MediaItem, Series } from "../api/types";
import { Artwork, Placeholder } from "../components/Artwork";
import { IconFolder, IconInfo, IconPlay } from "../components/Icons";
import { MediaCard, ProgressBar } from "../components/MediaCard";
import { Row } from "../components/Row";
import { EmptyState, SkeletonRow } from "../components/States";
import { usePlayer } from "../context/PlayerContext";
import { useAsync } from "../lib/hooks";
import { formatEpisode, formatRuntime, formatTime, progressFraction, resolutionLabel } from "../lib/format";

function Hero({ item, resume }: { item: MediaItem; resume: boolean }) {
  const navigate = useNavigate();
  const frac = progressFraction(item);
  const meta = [
    item.series ? formatEpisode(item.series) : item.year,
    formatRuntime(item.durationSec),
    resolutionLabel(item.width, item.height),
  ].filter(Boolean);
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true">
        {item.hasThumbnail ? <img src={urls.thumbnail(item.id, 1280)} alt="" /> : <Placeholder seed={item.id} kind={item.kind} />}
      </div>
      <div className="hero-content">
        <div className="eyebrow">{resume ? "Pick up where you left off" : "Just added"}</div>
        <h1 className="hero-title">{item.series ? item.series.name : item.title}</h1>
        {item.series ? <div className="hero-episode">{item.title}</div> : null}
        <div className="meta-line">
          {meta.map((m) => (
            <span key={String(m)}>{m}</span>
          ))}
        </div>
        {resume && frac != null ? (
          <div className="hero-progress">
            <ProgressBar value={frac} />
            <span>{formatTime((item.durationSec ?? 0) - (item.progress?.positionSec ?? 0))} left</span>
          </div>
        ) : null}
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/play/${encodeURIComponent(item.id)}${resume ? "?resume=1" : ""}`)}>
            <IconPlay size={18} /> {resume ? "Resume" : "Play"}
          </button>
          <Link to={`/media/${encodeURIComponent(item.id)}`} className="btn btn-ghost">
            <IconInfo size={18} /> Details
          </Link>
        </div>
      </div>
    </section>
  );
}

function SeriesCard({ s }: { s: Series }) {
  return (
    <Link to={`/shows/${encodeURIComponent(s.name)}`} className="card card-landscape kind-video" aria-label={s.name}>
      <div className="card-media">
        {s.thumbnailItemId ? (
          <Artwork item={{ id: s.thumbnailItemId, kind: "video", title: s.name, hasThumbnail: true }} />
        ) : (
          <div className="art">
            <Placeholder seed={s.name} kind="video" />
          </div>
        )}
      </div>
      <div className="card-text">
        <div className="card-title">{s.name}</div>
        <div className="card-sub">
          {s.seasons.length} season{s.seasons.length === 1 ? "" : "s"} · {s.episodeCount} episodes
        </div>
      </div>
    </Link>
  );
}
export { SeriesCard };

function KindRow({
  title,
  eyebrow,
  seeAll,
  load,
  shape,
  onActivate,
  filter,
}: {
  title: string;
  eyebrow?: string;
  seeAll: string;
  load: () => Promise<MediaItem[]>;
  shape: "landscape" | "square";
  onActivate?: (item: MediaItem, all: MediaItem[]) => void;
  filter?: (i: MediaItem) => boolean;
}) {
  const { data, loading } = useAsync(load, []);
  const items = (data ?? []).filter(filter ?? (() => true));
  if (!loading && items.length === 0) return null;
  return (
    <Row title={title} eyebrow={eyebrow} seeAll={seeAll}>
      {loading && !data ? <SkeletonRow shape={shape} /> : null}
      {items.map((it) => (
        <MediaCard key={it.id} item={it} shape={shape} onActivate={onActivate ? (i) => onActivate(i, items) : undefined} />
      ))}
    </Row>
  );
}

export default function Home() {
  const cont = useAsync(() => api.continueWatching(), []);
  const recent = useAsync(() => api.recent(24), []);
  const series = useAsync(() => api.series(), []);
  const libs = useAsync(() => api.libraries(), []);
  const { playQueue } = usePlayer();
  const navigate = useNavigate();

  const continueItems = cont.data ?? [];
  const heroItem: MediaItem | undefined =
    continueItems.find((i) => i.kind === "video") ?? (recent.data ?? []).find((i) => i.kind === "video");
  const heroIsResume = !!heroItem && continueItems.some((c) => c.id === heroItem.id);

  const empty = !cont.loading && !recent.loading && continueItems.length === 0 && (recent.data ?? []).length === 0;

  return (
    <div className="page home">
      {heroItem ? <Hero item={heroItem} resume={heroIsResume} /> : <div className="hero-spacer" />}

      {empty ? (
        <EmptyState title="Your library is empty" icon={<IconFolder size={36} />}>
          Add media to the server's media folders and run a scan from <Link to="/admin">Settings</Link>.
        </EmptyState>
      ) : null}

      {continueItems.length > 0 ? (
        <Row title="Continue watching" eyebrow="In progress">
          {continueItems.map((it) => (
            <MediaCard key={it.id} item={it} showRemaining to={`/play/${encodeURIComponent(it.id)}?resume=1`} />
          ))}
        </Row>
      ) : null}

      {recent.loading && !recent.data ? (
        <section className="row">
          <header className="row-head">
            <h2>Recently added</h2>
          </header>
          <SkeletonRow />
        </section>
      ) : (recent.data ?? []).length > 0 ? (
        <Row title="Recently added" eyebrow="New">
          {(recent.data ?? []).map((it) => (
            <MediaCard
              key={it.id}
              item={it}
              shape="landscape"
              onActivate={it.kind === "audio" ? (i) => playQueue([i]) : it.kind === "image" ? (i) => navigate(`/photos?open=${encodeURIComponent(i.id)}`) : undefined}
            />
          ))}
        </Row>
      ) : null}

      <KindRow
        title="Movies"
        seeAll="/movies"
        shape="landscape"
        load={() => api.media({ kind: "video", sort: "added", order: "desc", limit: 40 }).then((p) => p.items)}
        filter={(i) => !i.series}
      />

      {(series.data ?? []).length > 0 ? (
        <Row title="TV Shows" seeAll="/shows">
          {(series.data ?? []).slice(0, 30).map((s) => (
            <SeriesCard key={s.name} s={s} />
          ))}
        </Row>
      ) : null}

      <KindRow
        title="Music"
        seeAll="/music"
        shape="square"
        load={() => api.media({ kind: "audio", sort: "added", order: "desc", limit: 30 }).then((p) => p.items)}
        onActivate={(item, all) => playQueue(all, all.indexOf(item))}
      />

      <KindRow
        title="Photos"
        seeAll="/photos"
        shape="square"
        load={() => api.media({ kind: "image", sort: "added", order: "desc", limit: 30 }).then((p) => p.items)}
        onActivate={(item) => navigate(`/photos?open=${encodeURIComponent(item.id)}`)}
      />

      {(libs.data ?? []).length > 0 ? (
        <section className="row">
          <header className="row-head">
            <h2>Libraries</h2>
          </header>
          <div className="lib-grid">
            {(libs.data ?? []).map((l) => (
              <Link key={l.id} to={`/folders/${encodeURIComponent(l.id)}`} className="tile lib-tile">
                <IconFolder size={26} />
                <div>
                  <strong>{l.name}</strong>
                  <span>{l.itemCount.toLocaleString()} items</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
