import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { MediaItem, MediaKind, SortField, SortOrder } from "../api/types";
import { rovingKeys } from "../components/Row";
import { MediaCard, type CardShape } from "../components/MediaCard";
import { readSort, SortBar } from "../components/SortBar";
import { EmptyState, ErrorState, LoadMore, Spinner } from "../components/States";
import { usePaged } from "../lib/hooks";
import { iconForKind } from "../components/Icons";
import { Lightbox } from "../components/Lightbox";

interface Props {
  title: string;
  kind: MediaKind;
  shape: CardShape;
  defaultSort?: SortField;
  defaultOrder?: SortOrder;
  filter?: (i: MediaItem) => boolean;
  emptyText: string;
}

export function useSortParams(defSort: SortField, defOrder: SortOrder) {
  const [sp, setSp] = useSearchParams();
  const { sort, order } = readSort(sp, defSort, defOrder);
  const setSort = (s: SortField, o: SortOrder) => {
    const next = new URLSearchParams(sp);
    next.set("sort", s);
    next.set("order", o);
    setSp(next, { replace: true });
  };
  return { sort, order, setSort, sp, setSp };
}

export function BrowseGrid({ title, kind, shape, defaultSort = "title", defaultOrder = "asc", filter, emptyText }: Props) {
  const { sort, order, setSort } = useSortParams(defaultSort, defaultOrder);
  const paged = usePaged((offset, limit, signal) => api.media({ kind, sort, order, offset, limit }, signal), [kind, sort, order], {
    filter,
  });
  const Icon = iconForKind[kind];
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">{paged.total > 0 && !filter ? `${paged.total.toLocaleString()} items` : paged.items.length > 0 ? `${paged.items.length.toLocaleString()}${paged.hasMore ? "+" : ""} items` : " "}</p>
        </div>
        <SortBar sort={sort} order={order} onChange={setSort} />
      </header>
      {paged.error ? <ErrorState error={paged.error} /> : null}
      {!paged.loading && !paged.error && paged.items.length === 0 && !paged.hasMore ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} icon={<Icon size={36} />}>
          {emptyText}
        </EmptyState>
      ) : null}
      <div className={`grid grid-${shape}`} onKeyDown={(e) => rovingKeys(e, "grid")}>
        {paged.items.map((it) => (
          <MediaCard key={it.id} item={it} shape={shape} />
        ))}
      </div>
      {paged.items.length === 0 && paged.loading ? <Spinner /> : <LoadMore onVisible={paged.loadMore} loading={paged.loading} hasMore={paged.hasMore} />}
    </div>
  );
}

export function Movies() {
  return (
    <BrowseGrid
      title="Movies"
      kind="video"
      shape="landscape"
      filter={(i) => !i.series}
      emptyText="Videos that aren't TV episodes show up here."
    />
  );
}

export function Photos() {
  const { sort, order, setSort, sp, setSp } = useSortParams("added", "desc");
  const paged = usePaged((offset, limit, signal) => api.media({ kind: "image", sort, order, offset, limit }, signal), [sort, order], {
    limit: 120,
  });
  const openId = sp.get("open");
  const [extra, setExtra] = useState<MediaItem | null>(null);
  const openIdx = useMemo(() => (openId ? paged.items.findIndex((i) => i.id === openId) : -1), [openId, paged.items]);

  // Item requested via ?open= that isn't in the loaded page: fetch it alone.
  useEffect(() => {
    if (openId && openIdx < 0 && !paged.loading && extra?.id !== openId) {
      api.item(openId).then(setExtra).catch(() => undefined);
    }
  }, [openId, openIdx, paged.loading, extra]);
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set("open", id);
    else next.delete("open");
    setSp(next, { replace: true });
  };

  const lightboxItems = openIdx >= 0 ? paged.items : extra && extra.id === openId ? [extra] : null;
  const lightboxIdx = openIdx >= 0 ? openIdx : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Photos</h1>
          <p className="muted">{paged.total ? `${paged.total.toLocaleString()} photos` : " "}</p>
        </div>
        <SortBar sort={sort} order={order} onChange={setSort} fields={["added", "modified", "title", "size"]} />
      </header>
      {paged.error ? <ErrorState error={paged.error} /> : null}
      {!paged.loading && !paged.error && paged.items.length === 0 ? (
        <EmptyState title="No photos yet" icon={<iconForKind.image size={36} />}>
          JPEG, PNG, WebP, GIF and HEIC files in your media folders appear here.
        </EmptyState>
      ) : null}
      <div className="grid grid-photo" onKeyDown={(e) => rovingKeys(e, "grid")}>
        {paged.items.map((it) => (
          <MediaCard key={it.id} item={it} shape="square" onActivate={(i) => setOpen(i.id)} />
        ))}
      </div>
      {paged.items.length === 0 && paged.loading ? <Spinner /> : <LoadMore onVisible={paged.loadMore} loading={paged.loading} hasMore={paged.hasMore} />}
      {lightboxItems ? (
        <Lightbox
          items={lightboxItems}
          index={lightboxIdx}
          onIndex={(i) => {
            const it = lightboxItems[i];
            if (it) setOpen(it.id);
            if (i >= paged.items.length - 5 && paged.hasMore) paged.loadMore();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
