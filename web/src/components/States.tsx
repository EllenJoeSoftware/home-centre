import { useEffect, useRef, type ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty error">
      <h3>Something went wrong</h3>
      <div className="empty-body">{error.message}</div>
      {onRetry ? (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonRow({ count = 6, shape = "landscape" }: { count?: number; shape?: string }) {
  return (
    <div className="row-scroller skeleton-row" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`card card-${shape} skeleton`}>
          <div className="card-media" />
          <div className="card-text">
            <div className="sk-line" />
            <div className="sk-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Calls onVisible when scrolled into view; also renders a manual "Load more" button. */
export function LoadMore({ onVisible, loading, hasMore }: { onVisible: () => void; loading: boolean; hasMore: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading]);
  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} className="load-more">
      {loading ? (
        <Spinner />
      ) : (
        <button type="button" className="btn btn-ghost" onClick={onVisible}>
          Load more
        </button>
      )}
    </div>
  );
}
