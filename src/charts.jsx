import { useState } from "react";
import { ACC } from "./data.js";

// Charts and distribution shapes written as one line (see parseChart in data.js).
// Gaps work like in tables: shown underlined while browsing, a "?" to tap while studying.

const de = (n, d = 0) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

function useGaps(quiz) {
  const [open, setOpen] = useState(() => new Set());
  return (show, k, children) => {
    if (!show) return children;
    if (!quiz || open.has(k)) return <span className={"gap" + (quiz ? " open" : "")}>{children}</span>;
    return <button type="button" className="gap-q" aria-label="Lücke aufdecken"
      onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setOpen(o => new Set(o).add(k)); }}>?</button>;
  };
}

// ── Kreis-, Balkendiagramm, Histogramm ───────────────────────
export function Chart({ chart, pad, quiz }) {
  const gap = useGaps(quiz);
  const { kind, items } = chart;
  const total = items.reduce((s, it) => s + it.num, 0);
  // Counts (whole numbers, no %): the slides always give n.
  const counts = items.every(it => Number.isInteger(it.num) && !it.value.endsWith("%"));
  const head = (
    <div className="ch-head">
      <span className="ch-type">{gap(chart.typeGap, "type", chart.type)}</span>
      {chart.title && <span className="ch-title">{chart.title}</span>}
      {counts && <span className="ch-n">n = {de(total)}</span>}
    </div>
  );
  const label = `${chart.typeGap ? "Diagramm" : chart.type}${chart.title ? ": " + chart.title : ""}. ` +
    items.map(it => `${it.label} ${it.gap && quiz ? "?" : it.value}`).join(", ");
  return (
    <div className="ch-wrap" style={{ "--pad": pad + "px" }}>
      {head}
      {kind === "pie" ? <Pie items={items} total={total} counts={counts} gap={gap} label={label} />
        : <Bars items={items} hist={kind === "hist"} gap={gap} label={label} />}
    </div>
  );
}

function Pie({ items, total, counts, gap, label }) {
  const R = 60, C = 64;
  let a = -Math.PI / 2;
  const slices = items.map((it, i) => {
    const share = total ? it.num / total : 0, a0 = a, a1 = (a += share * 2 * Math.PI);
    const color = ACC[i % ACC.length];
    if (share >= 0.9999) return <circle key={i} cx={C} cy={C} r={R} fill={color} />;
    if (share <= 0) return null;
    const p = t => `${(C + R * Math.cos(t)).toFixed(2)} ${(C + R * Math.sin(t)).toFixed(2)}`;
    return <path key={i} d={`M${C} ${C}L${p(a0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}Z`} fill={color} />;
  });
  return (
    <div className="pie">
      <svg viewBox="0 0 128 128" className="pie-svg" role="img" aria-label={label}>
        {slices}
        {items.length > 1 && <circle cx={C} cy={C} r={R} fill="none" className="pie-rim" />}
      </svg>
      <ul className="pie-legend">
        {items.map((it, i) => (
          <li key={i}>
            <span className="pie-swatch" style={{ background: ACC[i % ACC.length] }} aria-hidden="true" />
            <span className="pie-label">{it.label}</span>
            <span className="pie-val">{gap(it.gap, i, <>{it.value}{counts && total > 0 && <small> · {de((it.num / total) * 100, 1)} %</small>}</>)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Bars stand apart (nominal, ordinal); histogram bars touch (metric classes). Histogram classes
// written as "15–20" get their boundaries on the axis instead of a label under each bar.
const RANGE = /^([−-]?\d+(?:[.,]\d+)?)\s*(?:–|—|-|bis)\s*([−-]?\d+(?:[.,]\d+)?)$/;
function Bars({ items, hist, gap, label }) {
  const max = Math.max(...items.map(it => it.num)) || 1;
  const n = items.length, values = n <= 12;
  const ranges = hist && items.map(it => it.label.match(RANGE));
  const bounds = ranges && ranges.every(Boolean) ? ranges : null;
  const step = Math.ceil(n / 10);
  return (
    <div className={"bars" + (hist ? " hist" : "")} style={{ "--n": n }} role="img" aria-label={label}>
      {items.map((it, i) => (
        <div key={i} className="bar-col" style={{ gridColumn: i + 1 }}>
          {values && <span className="bar-val">{gap(it.gap, i, it.value)}</span>}
          <div className="bar" style={{ height: Math.max(it.num > 0 ? 1 : 0, Math.round((it.num / max) * 108)) }} />
        </div>
      ))}
      {items.map((it, i) => (
        <div key={"l" + i} className="bar-label" style={{ gridColumn: i + 1 }}>
          {!bounds ? it.label : <>
            {i % step === 0 && <span className="bar-tick">{bounds[i][1]}</span>}
            {i === n - 1 && <span className="bar-tick end">{bounds[i][2]}</span>}
          </>}
        </div>
      ))}
    </div>
  );
}

// ── Verteilungsformen ────────────────────────────────────────
// Each shape is a curve over 0…1; it's drawn scaled so its peak reaches `h` (1 = full height).
const g = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2);
const twoPiece = (x, m, sl, sr) => g(x, m, x < m ? sl : sr);
const SHAPES = {
  normal: { f: x => g(x, 0.5, 1 / 6), deco: "sd" },
  normalW: { f: x => g(x, 0.5, 1 / 6), deco: "center" },
  symmetrisch: { f: x => g(x, 0.5, 0.085) + 0.62 * g(x, 0.31, 0.075) + 0.62 * g(x, 0.69, 0.075), deco: "stats" },
  asymmetrisch: { f: x => g(x, 0.56, 0.13) +0.42 * g(x, 0.3, 0.07), deco: "mode" },
  unimodal: { f: x => g(x, 0.5, 0.12), deco: "center" },
  bimodal: { f: x => 0.88 * g(x, 0.31, 0.085) + g(x, 0.67, 0.1), deco: "center" },
  multimodal: { f: x => 0.8 * g(x, 0.2, 0.06) + g(x, 0.5, 0.065) + 0.86 * g(x, 0.8, 0.06), deco: "center" },
  schmalgipfelig: { f: x => g(x, 0.5, 0.055), deco: "center" },
  breitgipfelig: { f: x => Math.exp(-0.5 * Math.abs((x - 0.5) / 0.19) ** 3.5), deco: "center" },
  linkssteil: { f: x => twoPiece(x, 0.27, 0.075, 0.3), deco: "stats" },
  rechtssteil: { f: x => twoPiece(x, 0.73, 0.3, 0.075), deco: "stats" },
  uformig: { f: x => Math.abs(2 * x - 1) ** 2.4, deco: "center" },
  abfallend: { f: x => 0.05 / (x + 0.05), deco: "yaxis", from: 0.02 },
  flach: { f: x => g(x, 0.5, 0.2), h: 0.55, deco: "center" },
  steil: { f: x => g(x, 0.5, 0.06) * 0.8 + g(x, 0.5, 0.16) * 0.2, deco: "center" },
};

const X0 = 14, W = 272, BASE = 104, H = 90, N = 160;
function curve(id) {
  const s = SHAPES[id], from = s.from || 0;
  const xs = Array.from({ length: N + 1 }, (_, k) => from + ((1 - from) * k) / N);
  const ys = xs.map(s.f), top = Math.max(...ys), h = s.h || 1;
  const px = x => X0 + x * W, py = y => BASE - (y / top) * H * h;
  const pts = xs.map((x, k) => [px(x), py(ys[k])]);
  // Mo, Md and AM come from the curve itself, so their order is always right.
  let mo = 0, area = 0, mean = 0;
  ys.forEach((y, k) => { if (y > ys[mo]) mo = k; area += y; mean += y * xs[k]; });
  let acc = 0, md = 0;
  while (md < N && (acc += ys[md]) < area / 2) md++;
  return { pts, px, py, top, h, xs, ys, mo: xs[mo], md: xs[md], am: mean / area, deco: s.deco };
}

function Shape({ id }) {
  const c = curve(id);
  const line = "M" + c.pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
  const fill = `${line}L${c.pts[N][0].toFixed(1)} ${BASE}L${c.pts[0][0].toFixed(1)} ${BASE}Z`;
  const yAt = x => c.py(SHAPES[id].f(x));
  const deco = [];
  if (c.deco === "center") deco.push(<line key="c" x1={c.px(0.5)} x2={c.px(0.5)} y1={BASE} y2={8} className="dist-mark" />);
  if (c.deco === "mode") deco.push(<line key="m" x1={c.px(c.mo)} x2={c.px(c.mo)} y1={BASE} y2={8} className="dist-mark" />);
  if (c.deco === "yaxis") deco.push(<line key="y" x1={X0} x2={X0} y1={BASE} y2={8} className="dist-axis" />);
  if (c.deco === "sd") {
    // ±1 Standardabweichung = Wendepunkte; about 2/3 of all values lie between them.
    const sx = z => c.px(0.5 + z / 6);
    deco.push(<path key="band" className="dist-band" d={"M" + c.pts.filter(p => p[0] >= sx(-1) && p[0] <= sx(1)).map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + `L${sx(1)} ${BASE}L${sx(-1)} ${BASE}Z`} />);
    deco.push(<line key="c" x1={sx(0)} x2={sx(0)} y1={BASE} y2={yAt(0.5)} className="dist-mark dashed" />);
    [-1, 1].forEach(z => deco.push(<line key={z} x1={sx(z)} x2={sx(z)} y1={BASE} y2={yAt(0.5 + z / 6)} className="dist-sd" />));
    deco.push(<text key="t" x={sx(0)} y={BASE - 22} className="dist-text strong" textAnchor="middle">≈ 2/3</text>);
    [-3, -2, -1, 0, 1, 2, 3].forEach(z => deco.push(<text key={"z" + z} x={sx(z)} y={BASE + 15} className="dist-text" textAnchor="middle">{z > 0 ? "+" + z : z < 0 ? "−" + -z : "0"}</text>));
  }
  if (c.deco === "stats") {
    const marks = [["Mo", c.mo], ["Md", c.md], ["AM", c.am]].map(([t, x]) => ({ t, x: c.px(x) }));
    if (Math.abs(marks[0].x - marks[2].x) < 3) {
      deco.push(<line key="l" x1={marks[0].x} x2={marks[0].x} y1={BASE} y2={yAt(c.mo)} className="dist-mark" />);
      deco.push(<text key="t" x={marks[0].x} y={BASE + 16} className="dist-text strong" textAnchor="middle">Mo = Md = AM</text>);
    } else {
      // Ticks sit at the true positions; the labels move apart just enough to stay readable.
      deco.push(<line key="l" x1={marks[0].x} x2={marks[0].x} y1={BASE} y2={yAt(c.mo)} className="dist-mark" />);
      const order = [...marks].sort((a, b) => a.x - b.x), lx = order.map(m => m.x);
      for (let k = 1; k < lx.length; k++) lx[k] = Math.max(lx[k], lx[k - 1] + 27);
      const shift = (lx[lx.length - 1] - order[order.length - 1].x) / 2;
      order.forEach((m, k) => {
        deco.push(<line key={"k" + m.t} x1={m.x} x2={m.x} y1={BASE - 4} y2={BASE + 3} className="dist-tick" />);
        deco.push(<text key={m.t} x={lx[k] - shift} y={BASE + 16} className="dist-text strong" textAnchor="middle">{m.t}</text>);
      });
    }
  }
  return (
    <svg viewBox="0 0 300 124" className="dist-svg" aria-hidden="true">
      <path d={fill} className="dist-fill" />
      {deco}
      <path d={line} className="dist-line" />
      <line x1={X0 - 4} x2={X0 + W + 4} y1={BASE} y2={BASE} className="dist-axis" />
    </svg>
  );
}

export function Dist({ chart, pad, quiz }) {
  const gap = useGaps(quiz);
  return (
    <div className="ch-wrap" style={{ "--pad": pad + "px" }}>
      <div className={"dists" + (chart.items.length > 1 ? " multi" : "")}>
        {chart.items.map((it, i) => (
          <figure key={i} className="dist" role="img"
            aria-label={it.gap && quiz ? "Verteilungsform – welche?" : `Verteilungsform: ${it.name}${it.also ? " (= " + it.also + ")" : ""}`}>
            <Shape id={it.id} />
            <figcaption className="dist-cap">
              {gap(it.gap, i, <><b>{it.name}</b>{(it.also || it.note) && <small>{" "}{[it.also && "= " + it.also, it.note].filter(Boolean).join(" · ")}</small>}</>)}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
