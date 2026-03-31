import { useRef, useEffect, useState } from "react";

interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}

interface ChartSpec {
  chartType: "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";
  title: string;
  labels: string[];
  datasets: ChartDataset[];
}

interface Props {
  spec: ChartSpec;
  width?: number;
  height?: number;
}

const DEFAULT_COLORS = [
  "#4285F4", "#EA4335", "#FBBC04", "#34A853",
  "#FF6D01", "#46BDC6", "#7BAAF7", "#F07B72",
  "#FCD04F", "#71C287", "#FF9E40", "#78D4DB"
];

/**
 * Pure-canvas chart renderer. No external charting library needed.
 * Supports bar, line, pie, doughnut, area, and scatter charts.
 */
export function ChartRenderer({ spec, width = 560, height = 340 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Canvas not supported");
      return;
    }

    // HiDPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    try {
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      switch (spec.chartType) {
        case "bar":
          drawBarChart(ctx, spec, width, height);
          break;
        case "line":
        case "area":
          drawLineChart(ctx, spec, width, height, spec.chartType === "area");
          break;
        case "pie":
        case "doughnut":
          drawPieChart(ctx, spec, width, height, spec.chartType === "doughnut");
          break;
        case "scatter":
          drawScatterChart(ctx, spec, width, height);
          break;
        default:
          drawBarChart(ctx, spec, width, height);
      }

      // Title
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 14px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(spec.title, width / 2, 20);
    } catch (err) {
      setError(String(err));
    }
  }, [spec, width, height]);

  if (error) {
    return <div className="chart-error">Chart error: {error}</div>;
  }

  return (
    <div className="chart-renderer">
      <canvas ref={canvasRef} />
    </div>
  );
}

/** Export the canvas as a PNG data URL. */
export function getChartDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

// ── Drawing functions ──

const PAD = { top: 35, right: 20, bottom: 50, left: 55 };

function getColor(i: number, override?: string): string {
  return override ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
}

function drawBarChart(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number) {
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const n = spec.labels.length;
  const ds = spec.datasets.length;
  if (n === 0 || ds === 0) return;

  const allValues = spec.datasets.flatMap((d) => d.data);
  const maxVal = Math.max(...allValues, 1);
  const groupW = plotW / n;
  const barW = Math.min(groupW * 0.7 / ds, 40);

  // Y axis gridlines
  const steps = 5;
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "right";
  for (let i = 0; i <= steps; i++) {
    const y = PAD.top + plotH - (plotH * i / steps);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(w - PAD.right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(maxVal * i / steps)), PAD.left - 8, y + 4);
  }

  // Bars
  for (let di = 0; di < ds; di++) {
    const dataset = spec.datasets[di];
    ctx.fillStyle = getColor(di, dataset.color);
    for (let li = 0; li < n; li++) {
      const val = dataset.data[li] ?? 0;
      const barH = (val / maxVal) * plotH;
      const x = PAD.left + li * groupW + (groupW - barW * ds) / 2 + di * barW;
      const y = PAD.top + plotH - barH;
      ctx.beginPath();
      ctx.roundRect(x, y, barW - 1, barH, [3, 3, 0, 0]);
      ctx.fill();
    }
  }

  // X labels
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "center";
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  for (let i = 0; i < n; i++) {
    const x = PAD.left + i * groupW + groupW / 2;
    const label = spec.labels[i].length > 12 ? spec.labels[i].slice(0, 11) + "..." : spec.labels[i];
    ctx.fillText(label, x, h - PAD.bottom + 18);
  }

  drawLegend(ctx, spec.datasets, w, h);
}

function drawLineChart(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, fill: boolean) {
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const n = spec.labels.length;
  if (n === 0) return;

  const allValues = spec.datasets.flatMap((d) => d.data);
  const maxVal = Math.max(...allValues, 1);

  // Gridlines
  const steps = 5;
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "right";
  for (let i = 0; i <= steps; i++) {
    const y = PAD.top + plotH - (plotH * i / steps);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(w - PAD.right, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(maxVal * i / steps)), PAD.left - 8, y + 4);
  }

  // Lines
  for (let di = 0; di < spec.datasets.length; di++) {
    const dataset = spec.datasets[di];
    const color = getColor(di, dataset.color);

    const points: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const x = PAD.left + (i / (n - 1 || 1)) * plotW;
      const y = PAD.top + plotH - ((dataset.data[i] ?? 0) / maxVal) * plotH;
      points.push([x, y]);
    }

    if (fill) {
      ctx.fillStyle = color + "30";
      ctx.beginPath();
      ctx.moveTo(points[0][0], PAD.top + plotH);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(points[points.length - 1][0], PAD.top + plotH);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      i === 0 ? ctx.moveTo(points[i][0], points[i][1]) : ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();

    // Dots
    ctx.fillStyle = color;
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // X labels
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "center";
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  for (let i = 0; i < n; i++) {
    const x = PAD.left + (i / (n - 1 || 1)) * plotW;
    ctx.fillText(spec.labels[i], x, h - PAD.bottom + 18);
  }

  drawLegend(ctx, spec.datasets, w, h);
}

function drawPieChart(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number, donut: boolean) {
  const data = spec.datasets[0]?.data ?? [];
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const cx = w / 2;
  const cy = PAD.top + (h - PAD.top - PAD.bottom) / 2;
  const radius = Math.min(w - PAD.left - PAD.right, h - PAD.top - PAD.bottom) / 2 - 10;

  let startAngle = -Math.PI / 2;
  for (let i = 0; i < data.length; i++) {
    const slice = (data[i] / total) * Math.PI * 2;
    ctx.fillStyle = getColor(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fill();
    startAngle += slice;
  }

  if (donut) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend with labels
  const legendY = h - 20;
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  const labelW = w / Math.min(data.length, 6);
  for (let i = 0; i < Math.min(data.length, 6); i++) {
    const x = labelW * i + labelW / 2;
    ctx.fillStyle = getColor(i);
    ctx.fillRect(x - 20, legendY - 8, 10, 10);
    ctx.fillStyle = "#6b7280";
    const label = spec.labels[i]?.slice(0, 10) ?? "";
    ctx.fillText(label, x + 5, legendY);
  }
}

function drawScatterChart(ctx: CanvasRenderingContext2D, spec: ChartSpec, w: number, h: number) {
  // Treat labels as X values (parsed as numbers)
  drawLineChart(ctx, spec, w, h, false);
}

function drawLegend(ctx: CanvasRenderingContext2D, datasets: ChartDataset[], w: number, h: number) {
  if (datasets.length <= 1) return;
  ctx.font = "11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  const legendY = h - 8;
  let x = PAD.left;
  for (let i = 0; i < datasets.length; i++) {
    const color = getColor(i, datasets[i].color);
    ctx.fillStyle = color;
    ctx.fillRect(x, legendY - 8, 10, 10);
    ctx.fillStyle = "#6b7280";
    const label = datasets[i].label.slice(0, 20);
    ctx.fillText(label, x + 14, legendY);
    x += ctx.measureText(label).width + 28;
    if (x > w - 40) break;
  }
}
