import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import type { Library, ScanStatus } from "../api/types";
import FolderPicker from "../components/FolderPicker";
import { IconFolder, IconPlus, IconRefresh, IconTrash } from "../components/Icons";
import { ErrorState, Spinner } from "../components/States";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatRelative } from "../lib/format";
import { parentPath } from "../lib/paths";
import { useAsync } from "../lib/hooks";

/** Polls scan status every 2s while a scan runs, every 15s otherwise. `refresh()` polls right away. */
function useScanStatus() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api.scanStatus();
        if (!alive) return;
        setStatus(s);
        setErr(null);
        timer = window.setTimeout(tick, s.running ? 2000 : 15000);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
        timer = window.setTimeout(tick, 10000);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { status, setStatus, err, setErr, refresh };
}

type ScanState = ReturnType<typeof useScanStatus>;

function ScanPanel({ scan }: { scan: ScanState }) {
  const { status, setStatus, err, setErr, refresh } = scan;
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await api.startScan();
      setStatus((s) => (s ? { ...s, running: true } : { running: true, lastScanAt: null, itemCount: 0 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
      refresh();
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Library</h2>
          <p className="muted">Scans run automatically on the server's interval. Trigger one after adding files.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={start} disabled={starting || status?.running}>
          <IconRefresh size={16} className={status?.running ? "spin" : ""} />
          {status?.running ? "Scanning…" : "Scan now"}
        </button>
      </header>
      {err ? <div className="form-error">{err}</div> : null}
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Status</span>
          <span className={`stat-value ${status?.running ? "accent" : ""}`}>
            <span className={`status-dot ${status?.running ? "live" : ""}`} />
            {status ? (status.running ? "Scanning" : "Idle") : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Items</span>
          <span className="stat-value">{status ? status.itemCount.toLocaleString() : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last scan</span>
          <span className="stat-value" title={status?.lastScanAt ? formatDate(status.lastScanAt) : undefined}>
            {status ? formatRelative(status.lastScanAt) : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}

type RowMode = "view" | "rename" | "remove";

function LibraryRow({
  lib,
  scanning,
  onChangeFolder,
  onChanged,
}: {
  lib: Library;
  scanning: boolean;
  onChangeFolder: (lib: Library) => void;
  onChanged: (message?: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>("view");
  const [name, setName] = useState(lib.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameId = useId();

  const cancel = () => {
    setMode("view");
    setErr(null);
    setName(lib.name);
  };

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.updateLibrary(lib.id, { name: name.trim() });
      setMode("view");
      onChanged(`Renamed to “${updated.name}”.`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteLibrary(lib.id);
      onChanged(`Removed “${lib.name}”.`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
    }
  };

  return (
    <li className={`folder-row ${mode !== "view" ? "editing" : ""}`}>
      <div className="folder-main">
        <IconFolder size={20} className="folder-icon" />
        <div className="folder-text">
          <strong>{lib.name}</strong>
          <code className="path-tail" title={lib.path}>
            <bdi>{lib.path}</bdi>
          </code>
        </div>
        <span className="folder-count muted">
          {lib.itemCount === 0 && scanning ? "Scanning…" : `${lib.itemCount.toLocaleString()} ${lib.itemCount === 1 ? "item" : "items"}`}
        </span>
        {mode === "view" ? (
          <div className="folder-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChangeFolder(lib)}>
              Change folder
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("rename")}>
              Rename
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setMode("remove")}>
              Remove
            </button>
          </div>
        ) : null}
      </div>

      {mode === "rename" ? (
        <form className="folder-inline" onSubmit={rename}>
          <label className="field" htmlFor={nameId}>
            <span>Name</span>
            <input
              id={nameId}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancel()}
              autoFocus
              required
            />
          </label>
          <div className="folder-inline-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim() || name.trim() === lib.name}>
              Save
            </button>
          </div>
        </form>
      ) : null}

      {mode === "remove" ? (
        <div className="folder-inline confirm" role="group" aria-label={`Remove ${lib.name}`}>
          <p>
            Remove <strong>{lib.name}</strong>? Its {lib.itemCount.toLocaleString()} {lib.itemCount === 1 ? "item" : "items"} and watch progress are
            removed from Home Centre. Files on disk are not touched.
          </p>
          <div className="folder-inline-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} autoFocus>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-danger-solid" onClick={remove} disabled={busy}>
              <IconTrash size={15} /> {busy ? "Removing…" : "Remove folder"}
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="form-error" role="alert">
          {err}
        </div>
      ) : null}
    </li>
  );
}

type PickerState = { mode: "add" } | { mode: "change"; lib: Library } | null;

function MediaFoldersPanel({ scan }: { scan: ScanState }) {
  const { status, refresh } = scan;
  const libs = useAsync(() => api.libraries(), [status?.lastScanAt, status?.running, status?.itemCount]);
  const [picker, setPicker] = useState<PickerState>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changed = (message?: string) => {
    libs.reload();
    refresh();
    setNotice(message ?? null);
  };

  const submit = async (path: string, name: string | undefined) => {
    if (!picker) return;
    if (picker.mode === "add") {
      const lib = await api.createLibrary({ path, name });
      changed(`Added “${lib.name}”. Scanning it now…`);
    } else {
      if (path === picker.lib.path) {
        setPicker(null);
        return;
      }
      const lib = await api.updateLibrary(picker.lib.id, { path });
      changed(`“${lib.name}” now points to ${lib.path}. Re-scanning…`);
    }
    setPicker(null);
  };

  const list = libs.data ?? [];
  return (
    <section className="panel" aria-labelledby="media-folders-title">
      <header className="panel-head">
        <div>
          <h2 id="media-folders-title">Media folders</h2>
          <p className="muted">Folders on the server that are scanned for movies, shows, music and photos.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setPicker({ mode: "add" })}>
          <IconPlus size={16} /> Add folder
        </button>
      </header>
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
      {libs.error && !libs.data ? <ErrorState error={libs.error} onRetry={libs.reload} /> : null}
      {libs.loading && !libs.data ? <Spinner /> : null}
      {libs.data && list.length === 0 ? (
        <div className="folders-empty">
          <IconFolder size={28} />
          <p>No media folders yet. Add one to start building your library.</p>
        </div>
      ) : null}
      {list.length > 0 ? (
        <ul className="folder-list">
          {list.map((l) => (
            <LibraryRow
              key={`${l.id}:${l.name}`}
              lib={l}
              scanning={Boolean(status?.running)}
              onChangeFolder={(lib) => setPicker({ mode: "change", lib })}
              onChanged={changed}
            />
          ))}
        </ul>
      ) : null}
      {picker ? (
        <FolderPicker
          title={picker.mode === "add" ? "Add media folder" : `Change folder for “${picker.lib.name}”`}
          initialPath={picker.mode === "change" ? parentPath(picker.lib.path) : null}
          withName={picker.mode === "add"}
          submitLabel={picker.mode === "add" ? "Add this folder" : "Use this folder"}
          onSubmit={submit}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </section>
  );
}

function UsersPanel() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.users(), []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    try {
      await api.createUser({ username: username.trim(), password, isAdmin });
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      reload();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Delete user “${name}”? Their watch progress will be lost.`)) return;
    try {
      await api.deleteUser(id);
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Users</h2>
          <p className="muted">Everyone in the house can have their own account and watch progress.</p>
        </div>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Spinner /> : null}
      <ul className="user-list">
        {(data ?? []).map((u) => (
          <li key={u.id}>
            <span className="avatar">{u.username.slice(0, 1).toUpperCase()}</span>
            <strong>{u.username}</strong>
            {u.isAdmin ? <span className="chip chip-ok">Admin</span> : <span className="chip">User</span>}
            {u.id === me?.id ? <span className="muted">(you)</span> : null}
            <span className="spacer" />
            {u.id !== me?.id ? (
              <button type="button" className="icon-btn danger" onClick={() => remove(u.id, u.username)} aria-label={`Delete ${u.username}`}>
                <IconTrash size={18} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="user-form" onSubmit={create}>
        <h3>Add user</h3>
        <div className="form-row">
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            <span>Administrator</span>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>
            <IconPlus size={16} /> Add
          </button>
        </div>
        {formErr ? <div className="form-error">{formErr}</div> : null}
      </form>
    </section>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const scan = useScanStatus();
  if (user && !user.isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="page admin">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Server administration</p>
        </div>
      </header>
      <ScanPanel scan={scan} />
      <MediaFoldersPanel scan={scan} />
      <UsersPanel />
    </div>
  );
}
