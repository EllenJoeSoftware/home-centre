import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, urls } from "../api/client";
import type { MediaItem } from "../api/types";
import { Artwork, Placeholder } from "../components/Artwork";
import { IconPlay, IconTv } from "../components/Icons";
import { ProgressBar } from "../components/MediaCard";
import { rovingKeys } from "../components/Row";
import { EmptyState, ErrorState, Spinner } from "../components/States";
import { formatRuntime, progressFraction } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { SeriesCard } from "./Home";

export function Shows() {
  const { data, error, loading, reload } = useAsync(() => api.series(), []);
  const [sort, setSort] = useState<"name" | "episodes">("name");
  const list = useMemo(() => {
    const l = [...(data ?? [])];
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    else l.sort((a, b) => b.episodeCount - a.episodeCount);
    return l;
  }, [data, sort]);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>TV Shows</h1>
          <p className="muted">{data ? `${data.length} series` : " "}</p>
        </div>
        <label className="select">
          <span className="sr-only">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "episodes")}>
            <option value="name">Name</option>
            <option value="episodes">Most episodes</option>
          </select>
        </label>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? (
        <EmptyState title="No TV shows yet" icon={<IconTv size={36} />}>
          Name episodes like <code>Show Name S01E02.mkv</code> or <code>1x02</code> and they will be grouped here.
        </EmptyState>
      ) : null}
      <div className="grid grid-landscape" onKeyDown={(e) => rovingKeys(e, "grid")}>
        {list.map((s) => (
          <SeriesCard key={s.name} s={s} />
        ))}
      </div>
    </div>
  );
}

export function EpisodeRow({ ep }: { ep: MediaItem }) {
  const frac = progressFraction(ep);
  const navigate = useNavigate();
  return (
    <li className="episode">
      <button type="button" className="episode-media" onClick={() => navigate(`/play/${encodeURIComponent(ep.id)}${frac != null ? "?resume=1" : ""}`)} aria-label={`Play ${ep.title}`}>
        <Artwork item={ep} width={400} />
        <span className="card-play" aria-hidden="true">
          <IconPlay size={18} />
        </span>
        {frac != null ? <ProgressBar value={frac} className="card-progress" /> : null}
        {ep.progress?.completed ? <span className="badge watched">Watched</span> : null}
      </button>
      <Link to={`/media/${encodeURIComponent(ep.id)}`} className="episode-text">
        <span className="episode-num">Episode {ep.series?.episode}</span>
        <strong>{ep.title}</strong>
        <span className="muted">{formatRuntime(ep.durationSec)}</span>
      </Link>
    </li>
  );
}

export function ShowDetail() {
  const { name = "" } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.episodes(name), [name]);
  const seasons = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.series?.season ?? 0))).sort((a, b) => a - b), [data]);
  const [season, setSeason] = useState<number | null>(null);
  const navigate = useNavigate();
  const activeSeason = season ?? seasons[0] ?? 1;
  const eps = (data ?? []).filter((e) => (e.series?.season ?? 0) === activeSeason);
  const next =
    (data ?? []).find((e) => e.progress && !e.progress.completed && e.progress.positionSec > 0) ??
    (data ?? []).find((e) => !e.progress?.completed) ??
    data?.[0];
  const backdrop = (data ?? []).find((e) => e.hasThumbnail);

  return (
    <div className="page detail">
      <div className="detail-backdrop" aria-hidden="true">
        {backdrop ? <img src={urls.thumbnail(backdrop.id, 1280)} alt="" /> : <Placeholder seed={name} kind="video" />}
      </div>
      <div className="detail-head">
        <div className="eyebrow">TV Show</div>
        <h1 className="detail-title">{name}</h1>
        {data ? (
          <div className="meta-line">
            <span>
              {seasons.length} season{seasons.length === 1 ? "" : "s"}
            </span>
            <span>{data.length} episodes</span>
          </div>
        ) : null}
        {next ? (
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/play/${encodeURIComponent(next.id)}?resume=1`)}>
              <IconPlay size={18} />
              {next.progress && !next.progress.completed && next.progress.positionSec > 0 ? "Resume" : "Play"}{" "}
              {next.series ? `S${next.series.season} · E${next.series.episode}` : ""}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner /> : null}
      {seasons.length > 1 ? (
        <div className="tabs" role="tablist" aria-label="Seasons">
          {seasons.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={s === activeSeason} className={`tab-pill ${s === activeSeason ? "active" : ""}`} onClick={() => setSeason(s)}>
              Season {s}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="episodes">
        {eps.map((ep) => (
          <EpisodeRow key={ep.id} ep={ep} />
        ))}
      </ol>
    </div>
  );
}
