import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, urls } from "../api/client";
import type { MediaItem } from "../api/types";
import { Artwork, Placeholder } from "../components/Artwork";
import { IconFolder, IconPhoto, IconPlay, IconPlus } from "../components/Icons";
import { Lightbox } from "../components/Lightbox";
import { MediaCard, ProgressBar } from "../components/MediaCard";
import { Row } from "../components/Row";
import { ErrorState, Spinner } from "../components/States";
import { usePlayer } from "../context/PlayerContext";
import { formatBytes, formatDate, formatEpisode, formatRuntime, formatTime, progressFraction, resolutionLabel } from "../lib/format";
import { useAsync } from "../lib/hooks";

function folderLink(item: MediaItem) {
  const base = `/folders/${encodeURIComponent(item.libraryId)}`;
  return item.folder ? `${base}/${item.folder.split("/").map(encodeURIComponent).join("/")}` : base;
}

export default function Detail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: item, error, loading, reload } = useAsync(() => api.item(id), [id]);
  const siblings = useAsync(
    () => (item ? (item.series ? api.episodes(item.series.name) : api.folders(item.libraryId, item.folder).then((f) => f.items)) : Promise.resolve([] as MediaItem[])),
    [item?.id],
  );
  const { playQueue, enqueue } = usePlayer();
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading || !item) return <div className="page"><Spinner /></div>;

  const frac = progressFraction(item);
  const resumable = frac != null;
  const res = resolutionLabel(item.width, item.height);
  const meta = [
    item.series ? formatEpisode(item.series) : null,
    item.year,
    formatRuntime(item.durationSec),
    res,
    item.kind === "image" && item.width && item.height ? `${item.width}×${item.height}` : null,
  ].filter(Boolean);

  const sameKind = (siblings.data ?? []).filter((s) => s.kind === item.kind);
  const album = item.album ? sameKind.filter((s) => s.album === item.album) : sameKind;
  const play = (resume: boolean) => {
    if (item.kind === "video") navigate(`/play/${encodeURIComponent(item.id)}${resume ? "?resume=1" : "?resume=0"}`);
    else if (item.kind === "audio") {
      const q = album.length ? album : [item];
      playQueue(q, Math.max(0, q.findIndex((s) => s.id === item.id)));
    } else setLightbox(Math.max(0, sameKind.findIndex((s) => s.id === item.id)));
  };

  const facts: [string, string | null][] = [
    ["File", item.fileName],
    ["Folder", item.folder || "/"],
    ["Size", formatBytes(item.size)],
    ["Container", item.container],
    ["Video", item.videoCodec ? `${item.videoCodec}${item.width ? ` · ${item.width}×${item.height}` : ""}` : null],
    ["Audio", item.audioCodec],
    ["Playback", item.kind === "image" ? null : item.directPlayable ? "Direct play" : item.kind === "video" ? "Transcode (HLS)" : "Direct stream"],
    ["Subtitles", item.subtitles.length ? item.subtitles.map((s) => s.label).join(", ") : null],
    ["Added", formatDate(item.addedAt)],
    ["Modified", formatDate(item.modifiedAt)],
  ];

  return (
    <div className={`page detail kind-${item.kind}`}>
      <div className="detail-backdrop" aria-hidden="true">
        {item.hasThumbnail ? <img src={urls.thumbnail(item.id, 1280)} alt="" /> : item.kind === "image" ? <img src={urls.stream(item.id)} alt="" /> : <Placeholder seed={item.id} kind={item.kind} />}
      </div>
      <div className="detail-layout">
        <div className={`detail-art ${item.kind === "video" ? "wide" : "square"}`}>
          <Artwork item={item} width={item.kind === "video" ? 800 : 600} eager />
        </div>
        <div className="detail-info">
          <div className="eyebrow">
            {item.series ? (
              <Link to={`/shows/${encodeURIComponent(item.series.name)}`}>{item.series.name}</Link>
            ) : item.kind === "video" ? (
              "Movie"
            ) : item.kind === "audio" ? (
              item.artist ?? "Music"
            ) : (
              "Photo"
            )}
          </div>
          <h1 className="detail-title">{item.title}</h1>
          {item.kind === "audio" && item.album ? <div className="detail-sub">{item.album}</div> : null}
          <div className="meta-line">
            {meta.map((m) => (
              <span key={String(m)}>{m}</span>
            ))}
            {item.kind === "video" ? <span className={`chip ${item.directPlayable ? "chip-ok" : "chip-warn"}`}>{item.directPlayable ? "Direct play" : "Transcode"}</span> : null}
            {item.subtitles.length ? <span className="chip">CC</span> : null}
          </div>
          {resumable ? (
            <div className="hero-progress">
              <ProgressBar value={frac} />
              <span>
                {formatTime(item.progress?.positionSec)} of {formatTime(item.durationSec)}
              </span>
            </div>
          ) : null}
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => play(resumable)} autoFocus>
              {item.kind === "image" ? <IconPhoto size={18} /> : <IconPlay size={18} />}
              {item.kind === "image" ? "View" : resumable ? `Resume from ${formatTime(item.progress?.positionSec)}` : "Play"}
            </button>
            {resumable ? (
              <button type="button" className="btn btn-ghost" onClick={() => play(false)}>
                Start over
              </button>
            ) : null}
            {item.kind === "audio" ? (
              <>
                {album.length > 1 ? (
                  <button type="button" className="btn btn-ghost" onClick={() => playQueue(album, 0)}>
                    <IconPlay size={16} /> Play {item.album ? "album" : "folder"}
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={() => enqueue([item])}>
                  <IconPlus size={16} /> Queue
                </button>
              </>
            ) : null}
            <Link to={folderLink(item)} className="btn btn-ghost">
              <IconFolder size={16} /> Open folder
            </Link>
          </div>
          <dl className="facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {sameKind.length > 1 ? (
        <Row title={item.series ? `More from ${item.series.name}` : item.kind === "audio" ? (item.album ? `From ${item.album}` : "In this folder") : "In this folder"}>
          {(item.kind === "audio" ? album : sameKind)
            .filter((s) => s.id !== item.id)
            .slice(0, 40)
            .map((s) => (
              <MediaCard key={s.id} item={s} shape={item.kind === "video" ? "landscape" : "square"} />
            ))}
        </Row>
      ) : null}

      {lightbox != null ? <Lightbox items={sameKind.length ? sameKind : [item]} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
