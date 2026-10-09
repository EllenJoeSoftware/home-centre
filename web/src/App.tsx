import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/States";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Home from "./pages/Home";
import { Movies, Photos } from "./pages/Browse";
import { Shows, ShowDetail } from "./pages/Shows";
import Music from "./pages/Music";
import { FolderBrowser, Libraries } from "./pages/Folders";
import Search from "./pages/Search";
import Detail from "./pages/Detail";
import { EmptyState } from "./components/States";
import { Link } from "react-router-dom";

const PlayerPage = lazy(() => import("./pages/Player"));
const Admin = lazy(() => import("./pages/Admin"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** "/" jumps to search from anywhere (like many media apps). */
function GlobalKeys() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (window.location.pathname.startsWith("/play/")) return;
      e.preventDefault();
      navigate("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Page not found">
        <Link to="/">Back to home</Link>
      </EmptyState>
    </div>
  );
}

export default function App() {
  return (
    <>
      <GlobalKeys />
      <ScrollToTop />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/play/:id"
            element={
              <RequireAuth>
                <PlayerPage />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="movies" element={<Movies />} />
            <Route path="shows" element={<Shows />} />
            <Route path="shows/:name" element={<ShowDetail />} />
            <Route path="music" element={<Music />} />
            <Route path="photos" element={<Photos />} />
            <Route path="folders" element={<Libraries />} />
            <Route path="folders/:libraryId/*" element={<FolderBrowser />} />
            <Route path="search" element={<Search />} />
            <Route path="media/:id" element={<Detail />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
