interface Props {
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height = 16, style }: Props) {
  return (
    <div
      className="skeleton"
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "65%" : "100%"} />
      ))}
    </div>
  );
}
