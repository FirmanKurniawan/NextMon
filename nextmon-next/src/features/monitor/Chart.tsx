/** Server-rendered SVG history chart (port of Monitor::chart): outage periods shaded, no client JS. */
import type { Point } from './logic.ts';

export type Series = { key: 'lat' | 'net' | 'cpu' | 'mem' | 'act' | 'up'; cls: string; label: string };

const r1 = (n: number) => Math.round(n * 10) / 10;

export function Chart({ pts, series, max, unit, from, to, mini = false, tz = 'UTC' }: { pts: Point[]; series: Series[]; max: number | null; unit: string; from: number; to: number; mini?: boolean; tz?: string }) {
  const W = 600;
  const H = mini ? 48 : 150;
  const L = mini ? 2 : 36;
  const B = mini ? 2 : 18;
  const T = 6;
  const span = Math.max(1, to - from);
  const x = (ts: number) => L + (W - L - 4) * ((ts - from) / span);
  const vals: number[] = [];
  for (const p of pts) for (const s of series) if (p.ok && typeof p[s.key] === 'number') vals.push(p[s.key] as number);
  const top = max ?? Math.max(10, Math.ceil((Math.max(...(vals.length ? vals : [10])) * 1.15) / 10) * 10);
  const y = (v: number) => T + (H - T - B) * (1 - Math.min(1, Math.max(0, v / top)));
  const fmtTick = (ts: number, day: boolean) => {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...(day ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false }) });
    return f.format(new Date(ts * 1000));
  };
  const grid: { gy: number; label: string }[] = [];
  if (!mini)
    for (let i = 0; i <= 4; i++) {
      const v = top * (1 - i / 4);
      const label = v.toFixed(top < 10 ? 1 : 0).replace(/\.?0+$/, '') || '0';
      grid.push({ gy: T + ((H - T - B) * i) / 4, label });
    }
  const step = span <= 8 * 3600 ? 3600 : span <= 30 * 3600 ? 6 * 3600 : 86400;
  const ticks: number[] = [];
  if (!mini) for (let tk = Math.ceil(from / step) * step; tk < to; tk += step) ticks.push(tk);
  const bands: { x0: number; w: number }[] = [];
  let prev: Point | null = null;
  for (const p of pts) {
    if (!p.ok) {
      const x0 = x((prev ?? p).ts);
      bands.push({ x0, w: Math.max(2, x(p.ts) - x0 + 2) });
    }
    prev = p;
  }
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    let n = 0;
    for (const p of pts) {
      const v = p[s.key];
      if (!p.ok || typeof v !== 'number') {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${r1(x(p.ts))} ${r1(y(v))} `;
      pen = true;
      n++;
    }
    return { s, d: d.trim(), n };
  });
  return (
    <svg className={`nm-chart${mini ? ' nm-mini' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(' / ') + (unit ? ` (${unit})` : '')} preserveAspectRatio="none">
      {grid.map((g, i) => (
        <g key={i}>
          <line className="nm-grid" x1={L} x2={W} y1={r1(g.gy)} y2={r1(g.gy)} />
          <text className="nm-axis" x={L - 4} y={r1(g.gy + 3)} textAnchor="end">
            {g.label}
          </text>
        </g>
      ))}
      {ticks.map((tk) => (
        <text key={tk} className="nm-axis" x={r1(x(tk))} y={H - 4} textAnchor="middle">
          {fmtTick(tk, step >= 86400)}
        </text>
      ))}
      {bands.map((b, i) => (
        <rect key={i} className="nm-down" x={r1(b.x0)} y={T} width={r1(b.w)} height={H - T - B} />
      ))}
      {paths.map(({ s, d, n }) =>
        n ? (
          <path key={s.key} className={`nm-line ${s.cls}`} d={d}>
            <title>{`${s.label} (${unit})`}</title>
          </path>
        ) : null,
      )}
    </svg>
  );
}

