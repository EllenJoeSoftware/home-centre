import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import type { Page } from "../api/types";

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export interface PagedState<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Offset pagination with append. `filter` lets a view hide items client-side
 * (e.g. Movies = videos without series info) while still paging the raw list.
 */
export function usePaged<T>(
  fetchPage: (offset: number, limit: number, signal: AbortSignal) => Promise<Page<T>>,
  deps: DependencyList,
  { limit = 60, filter }: { limit?: number; filter?: (t: T) => boolean } = {},
): PagedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const genRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const loadingRef = useRef(false);

  const load = useCallback(
    async (gen: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      try {
        const page = await fetchRef.current(offsetRef.current, limit, ctrl.signal);
        if (gen !== genRef.current) return;
        const f = filterRef.current;
        const got = f ? page.items.filter(f) : page.items;
        offsetRef.current += page.items.length;
        setItems((prev) => prev.concat(got));
        setTotal(page.total);
        setHasMore(page.items.length > 0 && offsetRef.current < page.total);
        setError(null);
      } catch (e) {
        if (gen !== genRef.current) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setHasMore(false);
      } finally {
        if (gen === genRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [limit],
  );

  useEffect(() => {
    genRef.current += 1;
    ctrlRef.current?.abort();
    loadingRef.current = false;
    offsetRef.current = 0;
    setItems([]);
    setTotal(0);
    setHasMore(true);
    setError(null);
    void load(genRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (!loadingRef.current) void load(genRef.current);
  }, [load]);

  return { items, total, loading, error, hasMore, loadMore };
}
