import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { AudioBar } from "./AudioBar";
import { IconFilm, IconFolder, IconHome, IconLogout, IconMusic, IconPhoto, IconSearch, IconSettings, IconTv, IconUser } from "./Icons";
import { Logo, LogoMark } from "./Logo";

const NAV = [
  { to: "/", label: "Home", icon: IconHome, end: true },
  { to: "/movies", label: "Movies", icon: IconFilm },
  { to: "/shows", label: "TV Shows", icon: IconTv },
  { to: "/music", label: "Music", icon: IconMusic },
  { to: "/photos", label: "Photos", icon: IconPhoto },
  { to: "/folders", label: "Folders", icon: IconFolder },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { current } = usePlayer();
  const navigate = useNavigate();
  const doLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`shell ${current ? "has-audio" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <NavLink to="/" className="sidebar-logo" aria-label="Home Centre home">
          <Logo />
        </NavLink>
        <NavLink to="/search" className="sidebar-search">
          <IconSearch size={18} />
          <span>Search</span>
          <kbd>/</kbd>
        </NavLink>
        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-item">
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user?.isAdmin ? (
            <NavLink to="/admin" className="nav-item">
              <IconSettings />
              <span>Settings</span>
            </NavLink>
          ) : null}
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              {(user?.username ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="sidebar-username">{user?.username}</span>
            <button type="button" className="icon-btn" onClick={doLogout} aria-label="Sign out" title="Sign out">
              <IconLogout size={18} />
            </button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <NavLink to="/" className="topbar-logo" aria-label="Home Centre home">
          <LogoMark size={28} />
          <span>Home Centre</span>
        </NavLink>
        <div className="topbar-actions">
          <NavLink to="/search" className="icon-btn" aria-label="Search">
            <IconSearch />
          </NavLink>
          <NavLink to="/folders" className="icon-btn" aria-label="Folders">
            <IconFolder />
          </NavLink>
          {user?.isAdmin ? (
            <NavLink to="/admin" className="icon-btn" aria-label="Settings">
              <IconSettings />
            </NavLink>
          ) : null}
          <button type="button" className="icon-btn" onClick={doLogout} aria-label="Sign out">
            {user ? <IconLogout /> : <IconUser />}
          </button>
        </div>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <AudioBar />

      <nav className="tabbar" aria-label="Sections">
        {NAV.slice(0, 5).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="tab">
            <Icon size={22} />
            <span>{label === "TV Shows" ? "Shows" : label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
