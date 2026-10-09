import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api/client";
import type { BrowseListing, BrowseRoot } from "../api/types";
import { IconChevronRight, IconClose, IconFolder, IconHome } from "./Icons";
import { Spinner } from "./States";
import { baseName, crumbsFor } from "../lib/paths";

function pluralize(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export interface FolderPickerProps {
  title: string;
  /** Folder to open first (e.g. the parent of the library being changed). Falls back to the roots. */
  initialPath?: string | null;
  /** Show the optional name field (adding a library). */
  withName?: boolean;
  submitLabel?: string;
  /** Resolve to close the picker; throw to show the error inline. */
  onSubmit: (path: string, name: string | undefined) => Promise<void>;
  onClose: () => void;
}

export default function FolderPicker({ title, initialPath, withName, submitLabel = "Use this folder", onSubmit, onClose }: FolderPickerProps) {
  const titleId = useId();
  const nameId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [roots, setRoots] = useState<BrowseRoot[] | null>(null);
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [browseErr, setBrowseErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const current = listing?.path ?? null;

  const open = useCallback(async (path: string | null, fallbackToRoots = false) => {
    abortRef.current?.abort();
    setBrowseErr(null);
    setSubmitErr(null);
    if (path === null) {
      setListing(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const l = await api.fsBrowse(path, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setListing(l);
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      if (fallbackToRoots) setListing(null);
      else setBrowseErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  // Initial load: roots, then the starting folder if any.
  useEffect(() => {
    let alive = true;
    api
      .fsRoots()
      .then((r) => {
        if (!alive) return;
        setRoots(r.roots);
        void open(initialPath ?? null, true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setRoots([]);
        setLoading(false);
        setBrowseErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [initialPath, open]);

  // Default the name to the folder name until the user edits it.
  useEffect(() => {
    if (!nameTouched) setName(current ? baseName(current) : "");
  }, [current, nameTouched]);

  // Move focus into the list whenever a new folder is shown.
  useEffect(() => {
    if (loading) return;
    const first = listRef.current?.querySelector<HTMLElement>("button");
    (first ?? dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]"))?.focus({ preventScroll: true });
    listRef.current?.scrollTo?.({ top: 0 });
  }, [loading, current]);

  // Lock page scroll and restore focus to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, []);

  // Esc closes from anywhere (focus may have fallen back to <body>, e.g. after a disabled button).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab" && dialogRef.current) {
      // Keep focus inside the dialog.
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, [tabindex='0']")];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Arrow keys move between folders; Backspace/ArrowLeft goes up.
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let target: HTMLButtonElement | undefined;
    if (e.key === "ArrowDown") target = buttons[Math.min(buttons.length - 1, i + 1)];
    else if (e.key === "ArrowUp") target = buttons[Math.max(0, i - 1)];
    else if (e.key === "Home") target = buttons[0];
    else if (e.key === "End") target = buttons[buttons.length - 1];
    else if ((e.key === "Backspace" || e.key === "ArrowLeft") && current) {
      e.preventDefault();
      void open(listing?.parent ?? null);
      return;
    } else return;
    e.preventDefault();
    target?.focus();
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!current || busy) return;
    setBusy(true);
    setSubmitErr(null);
    try {
      await onSubmit(current, withName ? name.trim() || undefined : undefined);
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const crumbs = current && roots ? crumbsFor(current, roots) : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="modal picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </header>

        <nav className="picker-bar" aria-label="Current folder">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void open(listing?.parent ?? null)}
            disabled={!current}
            aria-label="Up one folder"
          >
            <IconChevronRight size={16} className="rot-up" />
            Up
          </button>
          <ol className="crumbs">
            <li>
              <button type="button" className="crumb" onClick={() => void open(null)} aria-current={current ? undefined : "location"}>
                <IconHome size={15} />
                <span>Locations</span>
              </button>
            </li>
            {crumbs.map((c, i) => (
              <li key={c.path}>
                <IconChevronRight size={14} className="crumb-sep" />
                <button
                  type="button"
                  className="crumb"
                  onClick={() => void open(c.path)}
                  aria-current={i === crumbs.length - 1 ? "location" : undefined}
                  title={c.path}
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="picker-body" aria-busy={loading}>
          {loading ? (
            <Spinner label="Loading folders" />
          ) : browseErr ? (
            <div className="picker-msg">
              <div className="form-error" role="alert">
                {browseErr}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" data-autofocus onClick={() => void open(null)}>
                Back to locations
              </button>
            </div>
          ) : current === null ? (
            (roots ?? []).length === 0 ? (
              <p className="picker-msg muted" data-autofocus tabIndex={-1}>
                No browsable locations are configured on the server (BROWSE_ROOTS).
              </p>
            ) : (
              <ul className="picker-list" ref={listRef} onKeyDown={onListKey} aria-label="Locations">
                {(roots ?? []).map((r) => (
                  <li key={r.path}>
                    <button type="button" className="picker-item" onClick={() => void open(r.path)}>
                      <IconFolder size={20} className="picker-icon" />
                      <span className="picker-name">
                        {r.name}
                        <code className="path-tail">
                          <bdi>{r.path}</bdi>
                        </code>
                      </span>
                      <IconChevronRight size={18} className="picker-chev" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (listing?.dirs.length ?? 0) === 0 ? (
            <p className="picker-msg muted" data-autofocus tabIndex={-1}>
              No sub-folders here.
              {listing && listing.mediaFiles > 0 ? ` This folder has ${pluralize(listing.mediaFiles, "media file")}.` : ""}
            </p>
          ) : (
            <ul className="picker-list" ref={listRef} onKeyDown={onListKey} aria-label="Folders">
              {listing!.dirs.map((d) => (
                <li key={d.path}>
                  <button type="button" className="picker-item" onClick={() => void open(d.path)}>
                    <IconFolder size={20} className="picker-icon" />
                    <span className="picker-name">{d.name}</span>
                    {d.mediaCount > 0 ? <span className="chip chip-ok">{pluralize(d.mediaCount, "file")}</span> : null}
                    <IconChevronRight size={18} className="picker-chev" />
                  </button>
                </li>
              ))}
              {listing!.truncated ? <li className="picker-note muted">Showing the first 1,000 folders.</li> : null}
            </ul>
          )}
        </div>

        <form className="picker-foot" onSubmit={submit}>
          <div className="picker-current">
            <span className="stat-label">Selected folder</span>
            {current ? (
              <>
                <code className="path-tail" title={current}>
                  <bdi>{current}</bdi>
                </code>
                <span className="muted">
                  {listing && listing.mediaFiles > 0
                    ? `${pluralize(listing.mediaFiles, "media file")} directly in this folder; sub-folders are scanned too.`
                    : "Sub-folders are scanned too."}
                </span>
              </>
            ) : (
              <span className="muted">Open a location and pick a folder.</span>
            )}
          </div>
          {withName ? (
            <label className="field" htmlFor={nameId}>
              <span>Name (optional)</span>
              <input
                id={nameId}
                value={name}
                maxLength={100}
                placeholder={current ? baseName(current) : "Folder name"}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                disabled={!current}
              />
            </label>
          ) : null}
          {submitErr ? (
            <div className="form-error" role="alert">
              {submitErr}
            </div>
          ) : null}
          <div className="picker-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!current || busy || loading}>
              {busy ? "Saving…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
