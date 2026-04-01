import { useIntelStore, type TimeRange } from "@/store/intelStore";

export function IntelFilterBar() {
  const { filter, setFilter, resetFilter } = useIntelStore();
  const hasActiveFilter = filter.person != null;

  return (
    <div className="intel-filter-bar">
      <select
        className="filter-select"
        value={filter.timeRange}
        onChange={(e) => setFilter({ timeRange: e.target.value as TimeRange })}
        aria-label="Time range"
      >
        <option value="1d">Last 24h</option>
        <option value="7d">Last 7 days</option>
        <option value="14d">Last 14 days</option>
        <option value="30d">Last 30 days</option>
      </select>

      <button
        className={`filter-chip${filter.sources.includes("github") ? " active" : ""}`}
        onClick={() =>
          setFilter({
            sources: filter.sources.includes("github")
              ? filter.sources.filter((s) => s !== "github")
              : [...filter.sources, "github"],
          })
        }
      >
        GitHub
      </button>

      <button
        className={`filter-chip${filter.sources.includes("jira") ? " active" : ""}`}
        onClick={() =>
          setFilter({
            sources: filter.sources.includes("jira")
              ? filter.sources.filter((s) => s !== "jira")
              : [...filter.sources, "jira"],
          })
        }
      >
        Jira
      </button>

      {hasActiveFilter && (
        <>
          <span className="filter-chip active" style={{ cursor: "default" }}>
            👤 {filter.person}
          </span>
          <button className="btn-ghost" onClick={resetFilter} title="Clear filters">
            × Clear
          </button>
        </>
      )}
    </div>
  );
}
