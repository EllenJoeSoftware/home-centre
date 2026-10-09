import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import type { ScanStatus } from "../api/types";
import { IconFolder, IconPlus, IconRefresh, IconTrash } from "../components/Icons";
import { ErrorState, Spinner } from "../components/States";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatRelative } from "../lib/format";
import { useAsync } from "../lib/hooks";

function ScanPanel() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const libs = useAsync(() => api.libraries(), [status?.lastScanAt]);

  // Poll every 2s while a scan runs, every 15s otherwise.
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
  }, [starting]);

  const start = async () => {
    setStarting(true);
    try {
      await api.startScan();
      setStatus((s) => (s ? { ...s, running: true } : { running: true, lastScanAt: null, itemCount: 0 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
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
      <ul className="lib-list">
        {(libs.data ?? []).map((l) => (
          <li key={l.id}>
            <IconFolder size={18} />
            <strong>{l.name}</strong>
            <code>{l.path}</code>
            <span className="muted">{l.itemCount.toLocaleString()} items</span>
          </li>
        ))}
      </ul>
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
  if (user && !user.isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="page admin">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Server administration</p>
        </div>
      </header>
      <ScanPanel />
      <UsersPanel />
    </div>
  );
}
