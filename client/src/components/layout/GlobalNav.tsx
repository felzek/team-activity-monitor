import { useLocation, Link } from "react-router-dom";
import { useSessionStore } from "@/store/sessionStore";

interface Props {
  onLogout: () => void;
}

export function GlobalNav({ onLogout }: Props) {
  const location = useLocation();
  const { userDisplayName, orgName } = useSessionStore();

  return (
    <nav className="global-nav">
      <Link to="/app" className="global-nav-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Team Activity
      </Link>

      <div className="global-nav-links">
        <Link to="/app" className={`global-nav-link${location.pathname === "/app" ? " active" : ""}`}>
          Workspace
        </Link>
        <Link to="/settings" className={`global-nav-link${location.pathname.startsWith("/settings") ? " active" : ""}`}>
          Settings
        </Link>
      </div>

      <div className="global-nav-spacer" />

      <div className="global-nav-user">
        {orgName && <span className="global-nav-user-name">{orgName}</span>}
        {userDisplayName && <span className="global-nav-user-name" style={{ color: "var(--text)" }}>{userDisplayName}</span>}
        <button className="btn-secondary" onClick={onLogout}>Log out</button>
      </div>
    </nav>
  );
}
