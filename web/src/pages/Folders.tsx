import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { MediaItem } from "../api/types";
import { IconChevronRight, IconFolder, IconPlay } from "../components/Icons";
import { Lightbox } from "../components/Lightbox";
import { MediaCard } from "../components/MediaCard";
import { rovingKeys } from "../components/Row";
import { EmptyState, ErrorState, Spinner } from "../components/States";
import { usePlayer } from "../context/PlayerContext";
import { useAsync } from "../lib/hooks";
import { TrackList } from "./Music";

export function Libraries() {
  const { data, error, loading, reload } = useAsync(() => api.libraries(), []);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Folders</h1>
          <p className="muted">Browse your media exactly as it is on disk.</p>
        </div>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <EmptyState title="No libraries configured">Set MEDIA_DIRS on the server.</EmptyState> : null}
      <div className="lib-grid" onKeyDown={(e) => rovingKeys(e, "grid")}>
        {(data ?? []).map((l) => (
          <Link key={l.id} to={`/folders/${encodeURIComponent(l.id)}`} className="tile lib-tile">
            <IconFolder size={26} />
            <div>
              <strong>{l.name}</strong>
              <span>{l.itemCount.toLocaleString()} items</span>
              <code>{l.path}</code>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function FolderBrowser() {
  const params = useParams();
  const libraryId = params.libraryId ?? "";
  const path = params["*"] ?? "";
  const libs = useAsync(() => api.libraries(), []);
  const { data, error, loading, reload } = useAsync(() => api.folders(libraryId, path), [libraryId, path]);
  const { playQueue } = usePlayer();
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);

  const libName = libs.data?.find((l) => l.id === libraryId)?.name ?? "Library";
  const crumbs = path ? path.split("/").filter(Boolean) : [];
  const groups = useMemo(() => {
    const items = data?.items ?? [];
    return {
      video: items.filter((i) => i.kind === "video"),
      audio: items.filter((i) => i.kind === "audio"),
      image: items.filter((i) => i.kind === "image"),
    };
  }, [data]);
  const base = `/folders/${encodeURIComponent(libraryId)}`;
  const linkFor = (p: string) => (p ? `${base}/${p.split("/").map(encodeURIComponent).join("/")}` : base);

  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/folders">Folders</Link>
        <IconChevronRight size={14} />
        <Link to={base}>{libName}</Link>
        {crumbs.map((c, i) => (
          <span key={i} className="crumb">
            <IconChevronRight size={14} />
            <Link to={linkFor(crumbs.slice(0, i + 1).join("/"))} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
              {c}
            </Link>
          </span>
        ))}
      </nav>
      <header className="page-head">
        <div>
          <h1>{crumbs[crumbs.length - 1] ?? libName}</h1>
          {data ? (
            <p className="muted">
              {data.folders.length} folders · {data.items.length} files
            </p>
          ) : null}
        </div>
        {groups.audio.length > 0 ? (
          <button type="button" className="btn btn-primary" onClick={() => playQueue(groups.audio, 0)}>
            <IconPlay size={16} /> Play folder
          </button>
        ) : null}
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner /> : null}
      {data && data.folders.length === 0 && data.items.length === 0 ? <EmptyState title="This folder is empty" icon={<IconFolder size={36} />} /> : null}

      {data && data.folders.length > 0 ? (
        <div className="folder-grid" onKeyDown={(e) => rovingKeys(e, "grid")}>
          {data.folders.map((f) => (
            <Link key={f.path} to={linkFor(f.path)} className="tile folder-tile">
              <IconFolder size={22} />
              <span>{f.name}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {groups.video.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Videos</h2>
          <div className="grid grid-landscape" onKeyDown={(e) => rovingKeys(e, "grid")}>
            {groups.video.map((it) => (
              <MediaCard key={it.id} item={it} />
            ))}
          </div>
        </section>
      ) : null}
      {groups.audio.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Audio</h2>
          <TrackList items={groups.audio} />
        </section>
      ) : null}
      {groups.image.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Photos</h2>
          <div className="grid grid-photo" onKeyDown={(e) => rovingKeys(e, "grid")}>
            {groups.image.map((it, i) => (
              <MediaCard key={it.id} item={it} shape="square" onActivate={() => setPhotoIdx(i)} />
            ))}
          </div>
        </section>
      ) : null}
      {photoIdx != null ? <Lightbox items={groups.image as MediaItem[]} index={photoIdx} onIndex={setPhotoIdx} onClose={() => setPhotoIdx(null)} /> : null}
    </div>
  );
}
