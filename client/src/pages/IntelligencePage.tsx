import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { IntelPane } from "@/components/intelligence/IntelPane";
import { useIntelStore } from "@/store/intelStore";

export function IntelligencePage() {
  const initFromUrl = useIntelStore((s) => s.initFromUrl);
  const navigate = useNavigate();

  useEffect(() => {
    initFromUrl();
  }, [initFromUrl]);

  return (
    <div className="intel-board-page">
      <div className="intel-board-header">
        <div className="intel-board-title-row">
          <div>
            <p className="eyebrow">Work Intelligence</p>
            <h1>Team Dashboard</h1>
            <p className="intel-board-subtitle">Live view across GitHub and Jira</p>
          </div>
          <button className="btn-secondary" onClick={() => navigate("/app")}>
            ← Back to workspace
          </button>
        </div>
      </div>
      <IntelPane variant="full" />
    </div>
  );
}
