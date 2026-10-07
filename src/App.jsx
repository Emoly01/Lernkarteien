import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { ACC, STATUS, LEVELS, MARKS, MAX_LEVEL, parseFlow, flowConnects, flowCycle, flowGraph, parsePasted, mid, L, plural, load, persist, mapLines, schedule, isDue, today, daysBetween, formatDate, exportBackup, parseBackup, nextAccent, renameSubject, deleteSubject, searchCards } from "./data.js";
import { stamp } from "./sync.js";
import { useCloudSync } from "./useCloudSync.js";
import "./styles.css";

// ── Settings (were design-tool toggles in the prototype) ─────
const STUDY_ONLY = false;          // hides all editing UI
const SHUFFLE = true;              // shuffle study queue
const TITLE_TURQUOISE = false;     // true = every title bar turquoise, false = subject colour

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Strg";

// The card being edited is kept in localStorage while typing, so nothing is lost if the app
// is closed, the phone kills it in the background, or the battery dies.
const DRAFT_KEY = "lernkarten-draft";
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } };
const writeDraft = v => { try { v ? localStorage.setItem(DRAFT_KEY, JSON.stringify(v)) : localStorage.removeItem(DRAFT_KEY); } catch (e) {} };
// What counts as a change: title, deck and non-empty lines (not empty lines or ids).
const draftKey = d => JSON.stringify([d.title.trim(), d.subject, d.lines.filter(l => l.text.trim()).map(l => [l.level, l.text])]);

// Scrolls the editor so the line being typed in stays visible: below the sticky header and above
// the sticky toolbar and, on phones, the on-screen keyboard (visualViewport excludes it).
function keepInView(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewTop = vv ? vv.offsetTop : 0;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const header = document.querySelector(".hdr")?.getBoundingClientRect();
  const footer = document.querySelector(".e-footer")?.getBoundingClientRect();
  const top = Math.max(viewTop, header ? header.bottom : 0) + 12;
  const bottom = Math.min(viewBottom, footer && footer.top < viewBottom ? footer.top : viewBottom) - 16;
  if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom, behavior: "smooth" });
  else if (r.top < top) window.scrollBy({ top: r.top - top, behavior: "smooth" });
}

// ── Card lines (read-only) ───────────────────────────────────
// Process lines ("A → B → C") as boxes with arrows. Consecutive process lines on the same level
// with the same number of steps share one grid, so their steps line up like on a slide:
// the first row is framed, the rows below are filled. Narrow cards run top to bottom.
function Flow({ rows, pad }) {
  const R = rows.length, C = rows[0].flow.steps.length;
  const caption = rows[0].flow.caption;
  const cells = [];
  rows.forEach((ln, r) => ln.flow.steps.forEach((step, i) => {
    const pos = { "--hr": r + 1, "--hc": 2 * i + 1, "--vr": 2 * i + 1, "--vc": r + 1 };
    cells.push(<div key={`${ln.key}-${i}`} className={"flow-box" + (R > 1 && r === 0 ? " outline" : "")} style={pos}>{step}</div>);
    if (i < C - 1) cells.push(
      <span key={`${ln.key}-a${i}`} className="flow-arrow" aria-hidden="true"
        style={{ "--hr": r + 1, "--hc": 2 * i + 2, "--vr": 2 * i + 2, "--vc": r + 1 }}>
        <svg viewBox="0 0 24 12" width="24" height="12"><path d="M1 6h19M15 1.5 21 6l-6 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>);
  }));
  return (
    <div className="flow-wrap" style={{ "--pad": pad + "px" }}>
      {caption && <div className="flow-caption">{caption}</div>}
      <div className={`flow flow-c${Math.min(C, 5)}`} style={{ "--rows": R, "--gaps": C - 1 }}
        role="img" aria-label={rows.map(ln => ln.flow.steps.join(", dann ")).join(". Darunter: ")}>
        {cells}
      </div>
    </div>
  );
}

// Flowchart: process lines that share a step ("A → C", "B → C", "C → D") become one diagram,
// top to bottom. Boxes are laid out by CSS (so text wraps like everywhere else); the arrows are
// drawn on top once the boxes have been measured, and again whenever the card changes size.
function FlowGraph({ rows, pad }) {
  const steps = rows.map(ln => ln.flow.steps);
  const shape = JSON.stringify(steps);
  const g = useMemo(() => flowGraph(steps), [shape]);
  const wrap = useRef(null), els = useRef([]);
  const [arrows, setArrows] = useState({ w: 0, h: 0, list: [] });

  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      // offset* (not getBoundingClientRect): unaffected by the card's flip and swipe transforms.
      const R = g.items.map((_, i) => { const el = els.current[i]; return el && { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; });
      if (R.some(r => !r)) return;
      const cx = i => R[i].x + R[i].w / 2;
      // Several arrows leaving or entering one box spread out along its edge, ordered left to right.
      const spread = (end, next) => {
        const at = [], by = new Map();
        g.links.forEach((l, li) => { const k = end(l.chain); if (!by.has(k)) by.set(k, []); by.get(k).push({ li, nb: next(l.chain) }); });
        by.forEach((list, item) => {
          list.sort((a, b) => cx(a.nb) - cx(b.nb));
          const s = Math.min(16, (R[item].w * 0.6) / list.length);
          list.forEach((e, j) => { at[e.li] = cx(item) + (j - (list.length - 1) / 2) * s; });
        });
        return at;
      };
      const sx = spread(c => c[0], c => c[1]), tx = spread(c => c[c.length - 1], c => c[c.length - 2]);
      const list = g.links.map(({ chain, back }, li) => {
        let x0 = sx[li], y0 = R[chain[0]].y + R[chain[0]].h + 1;
        let d = `M${x0} ${y0}`;
        for (let k = 1; k < chain.length; k++) {
          const last = k === chain.length - 1, r = R[chain[k]];
          const x1 = last ? tx[li] : cx(chain[k]), y1 = r.y - (last ? 1 : 0), m = (y1 - y0) / 2;
          d += ` C${x0} ${y0 + m} ${x1} ${y1 - m} ${x1} ${y1}`;
          if (!last) { y0 = r.y + r.h; d += ` L${x1} ${y0}`; x0 = x1; }
        }
        // The head sits on the box the arrow really points to: the lower one, or the upper one for a loop.
        const hx = back ? sx[li] : tx[li], hy = back ? R[chain[0]].y + R[chain[0]].h + 1 : R[chain[chain.length - 1]].y - 1, dir = back ? 1 : -1;
        return { d, head: `M${hx - 4.5} ${hy + 7 * dir}L${hx} ${hy}L${hx + 4.5} ${hy + 7 * dir}Z` };
      });
      const next = { w: box.offsetWidth, h: box.offsetHeight, list };
      setArrows(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    els.current.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [g]);

  const label = steps.map(s => s.join(", dann ")).join(". ");
  return (
    <div className="flow-wrap" style={{ "--pad": pad + "px" }}>
      {rows[0].flow.caption && <div className="flow-caption">{rows[0].flow.caption}</div>}
      <div className="fg" ref={wrap} role="img" aria-label={label}>
        {g.rows.map((row, r) => (
          <div key={r} className="fg-row">
            {row.map(it => g.items[it].node == null
              ? <span key={it} className="fg-via" ref={el => { els.current[it] = el; }} />
              : <div key={it} className="flow-box fg-box" ref={el => { els.current[it] = el; }}>{g.nodes[g.items[it].node]}</div>)}
          </div>
        ))}
        <svg className="fg-arrows" width={arrows.w} height={arrows.h} aria-hidden="true">
          {arrows.list.map((a, i) => <g key={i}><path d={a.d} className="fg-line" /><path d={a.head} className="fg-head" /></g>)}
        </svg>
      </div>
    </div>
  );
}

// Cycle ("A → B → C → A"): the steps sit on an oval, first one at the top, going clockwise, with
// each arrow following the oval to the next step. The oval grows taller until no boxes overlap and
// every arrow has room to show, so long cycles on a phone become tall instead of cramped.
function FlowCycle({ steps, caption, pad }) {
  const wrap = useRef(null), els = useRef([]);
  const [lay, setLay] = useState(null);
  const N = steps.length;

  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const S = steps.map((_, i) => els.current[i] && { w: els.current[i].offsetWidth, h: els.current[i].offsetHeight });
      if (S.some(s => !s)) return;
      const W = box.offsetWidth, maxW = Math.max(...S.map(s => s.w)), maxH = Math.max(...S.map(s => s.h));
      // Wide cards don't stretch the ring: it only gets as wide as its steps need.
      const rx = Math.max(maxW * 0.55, Math.min((W - maxW) / 2 - 2, N === 2 ? maxW * 0.8 : 70 + maxW * (0.35 + 0.1 * N)));
      // Steps sit at equal distances along the oval (not equal angles), so a tall oval doesn't
      // bunch them up at the top and bottom.
      const angles = ry => {
        const M = 720, ts = [], cum = [0];
        for (let k = 0; k <= M; k++) ts.push(-Math.PI / 2 + (2 * Math.PI * k) / M);
        for (let k = 1; k <= M; k++) cum.push(cum[k - 1] + Math.hypot(rx * (Math.cos(ts[k]) - Math.cos(ts[k - 1])), ry * (Math.sin(ts[k]) - Math.sin(ts[k - 1]))));
        const out = [];
        for (let i = 0, k = 0; i <= N; i++) { const want = (cum[M] * i) / N; while (k < M && cum[k] < want) k++; out.push(ts[k]); }
        return out;
      };
      const rects = (ry, A) => S.map((s, i) => { const x = rx * Math.cos(A[i]), y = ry * Math.sin(A[i]); return { x: x - s.w / 2, y: y - s.h / 2, w: s.w, h: s.h }; });
      const inside = (r, x, y, m) => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;
      // The part of the oval between box i and the next one that isn't hidden under either box.
      const arc = (R, ry, A, i) => {
        const a = R[i], b = R[(i + 1) % N], pts = [];
        for (let k = 0; k <= 80; k++) {
          const t = A[i] + ((A[i + 1] - A[i]) * k) / 80, x = rx * Math.cos(t), y = ry * Math.sin(t);
          if (inside(b, x, y, 5)) break;
          if (!inside(a, x, y, 5)) pts.push([x, y]);
        }
        return pts;
      };
      const len = pts => pts.reduce((s, p, k) => (k ? s + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0);
      const fits = ry => {
        const A = angles(ry), R = rects(ry, A);
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          const a = R[i], b = R[j];
          if (a.x < b.x + b.w + 12 && b.x < a.x + a.w + 12 && a.y < b.y + b.h + 12 && b.y < a.y + a.h + 12) return false;
        }
        return R.every((_, i) => len(arc(R, ry, A, i)) >= 26);
      };
      let ry = Math.max(rx * 0.6, maxH + 20);
      for (let n = 0; n < 60 && !fits(ry); n++) ry *= 1.07;
      const A = angles(ry), R = rects(ry, A), arcs = R.map((_, i) => arc(R, ry, A, i));
      // Arrows can bulge past the boxes (e.g. under the bottom two of three), so they count for the height too.
      const ys = R.flatMap(r => [r.y, r.y + r.h]).concat(arcs.flat().map(p => p[1]));
      const top = Math.min(...ys) - 6, bottom = Math.max(...ys) + 6;
      const ox = W / 2, oy = 2 - top;
      const list = arcs.map(arcPts => {
        const pts = arcPts.map(([x, y]) => [x + ox, y + oy]);
        if (pts.length < 2) return null;
        const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
        const l = Math.hypot(ex - px, ey - py) || 1, ux = (ex - px) / l, uy = (ey - py) / l;
        const bx = ex - ux * 7, by = ey - uy * 7;
        pts[pts.length - 1] = [bx + ux, by + uy]; // the line stops inside the head, not at its tip
        return {
          d: "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L"),
          head: `M${(bx - uy * 4.5).toFixed(1)} ${(by + ux * 4.5).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${(bx + uy * 4.5).toFixed(1)} ${(by - ux * 4.5).toFixed(1)}Z`,
        };
      }).filter(Boolean);
      const next = { h: Math.ceil(bottom - top + 4), pos: R.map(r => [Math.round(r.x + ox), Math.round(r.y + oy)]), list };
      setLay(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    els.current.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [JSON.stringify(steps)]);

  return (
    <div className="flow-wrap" style={{ "--pad": pad + "px" }}>
      {caption && <div className="flow-caption">{caption}</div>}
      <div className="fc" ref={wrap} style={{ height: lay ? lay.h : 120, "--maxw": N <= 4 ? "42%" : N <= 6 ? "36%" : "31%" }}
        role="img" aria-label={`Kreislauf: ${steps.join(", dann ")}, dann wieder ${steps[0]}`}>
        {steps.map((s, i) => (
          <div key={i} className="flow-box fc-box" ref={el => { els.current[i] = el; }}
            style={lay ? { transform: `translate(${lay.pos[i][0]}px, ${lay.pos[i][1]}px)` } : { visibility: "hidden" }}>{s}</div>
        ))}
        {lay && <svg className="fg-arrows" width="100%" height={lay.h} aria-hidden="true">
          {lay.list.map((a, i) => <g key={i}><path d={a.d} className="fg-line" /><path d={a.head} className="fg-head" /></g>)}
        </svg>}
      </div>
    </div>
  );
}

function Lines({ lines }) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.flow && !ln.hidden) {
      // Process lines directly below each other on the same level; a caption starts a new diagram.
      const run = [ln];
      for (let j = i + 1; j < lines.length; j++) {
        const nx = lines[j];
        if (nx.hidden || !nx.flow || nx.level !== ln.level || nx.flow.caption) break;
        run.push(nx);
      }
      if (flowConnects(run.map(r => r.flow.steps))) {
        const ring = flowCycle(run.map(r => r.flow.steps));
        out.push(ring
          ? <FlowCycle key={ln.key} steps={ring} caption={ln.flow.caption} pad={ln.level * 26} />
          : <FlowGraph key={ln.key} rows={run} pad={ln.level * 26} />);
        i += run.length - 1;
        continue;
      }
      let n = 1;
      while (n < run.length && run[n].flow.steps.length === ln.flow.steps.length) n++;
      out.push(<Flow key={ln.key} rows={run.slice(0, n)} pad={ln.level * 26} />);
      i += n - 1;
      continue;
    }
    out.push(renderLine(ln));
  }
  return out;
}

function renderLine(ln) {
  if (ln.hidden) return <div key={ln.key} className="ln-ghost" style={{ paddingLeft: ln.pad }}><div style={{ width: ln.ghostW + "%" }} /></div>;
  if (ln.level === 0) return <div key={ln.key} className="ln"><span className="ln-bullet">•</span><span className="ln-0-text">{ln.text}</span></div>;
  if (ln.level === 1) return <div key={ln.key} className="ln ln-1"><span className="ln-1-mark">×</span><span className="ln-1-text">{ln.text}</span></div>;
  // Detail and deeper: "Begriff: Rest" gets a bold label; each level indents a bit further.
  return <div key={ln.key} className={`ln ln-deep ln-${ln.level}`} style={{ paddingLeft: ln.level * 26 }}><span className="ln-2-mark">{MARKS[ln.level]}</span><span className="ln-2-text"><b>{ln.label}</b>{ln.rest}</span></div>;
}

export default function App() {
  const [data, setData] = useState(load);
  // Local edits go through `update`, which timestamps what changed so other devices can merge it.
  // Changes that arrive from the sync server use setData directly.
  const update = useCallback(fn => setData(prev => {
    const next = typeof fn === "function" ? fn(prev) : fn;
    return next === prev ? prev : stamp(prev, next);
  }), []);
  const sync = useCloudSync(data, setData);
  const { subjects, cards, examDate } = data;
  const POINT_BY_POINT = data.pointByPoint; // reveal back side one Hauptpunkt at a time
  const [studyScope, setStudyScope] = useState(null); // deck name, or null = all due cards
  const [editingExam, setEditingExam] = useState(false);
  const fileInput = useRef(null);
  const [view, setView] = useState("home"); // home | deck | card | study | done | edit
  const [deck, setDeck] = useState(null);
  const [cardIdx, setCardIdx] = useState(0);
  const [queue, setQueue] = useState([]);
  const [qPos, setQPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reveal, setReveal] = useState(0);
  const [noAnim, setNoAnim] = useState(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tally, setTally] = useState({ sicher: 0, unsicher: 0, nochmal: 0 });
  const [draft, setDraft] = useState(null);
  const [returnTo, setReturnTo] = useState("deck");
  const [addingSubject, setAddingSubject] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const draftOrig = useRef(null);                       // draftKey of the card when the editor opened
  const [savedDraft, setSavedDraft] = useState(readDraft); // unsaved card from a previous visit
  const [query, setQuery] = useState("");
  const [deckMenu, setDeckMenu] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [flash, setFlash] = useState("");
  const flashTimer = useRef(null);
  const focusTitle = useRef(false);

  const drag = useRef(null);
  const pendingFocus = useRef(null);
  const pendingCaret = useRef(null); // cursor position to restore after a programmatic edit
  const handlers = useRef({});

  useEffect(() => { persist(data); }, [data]);
  useEffect(() => { try { navigator.storage?.persist?.(); } catch (e) {} }, []);

  useEffect(() => {
    if (focusTitle.current) { focusTitle.current = false; document.querySelector(".e-title")?.focus(); }
    if (pendingFocus.current == null) return;
    const el = document.querySelector(`[data-line-idx="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    const caret = pendingCaret.current; pendingCaret.current = null;
    if (el) {
      el.focus({ preventScroll: true });
      const n = caret ?? el.value.length; try { el.setSelectionRange(n, n); } catch (e) {}
      keepInView(el);
    }
  });

  // When the phone keyboard opens or closes, the visible area changes: keep the active line in view.
  useEffect(() => {
    if (view !== "edit" || !window.visualViewport) return;
    const onResize = () => { const el = document.activeElement; if (el?.closest?.(".editor")) keepInView(el); };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport.removeEventListener("resize", onResize);
  }, [view]);

  useEffect(() => { window.scrollTo(0, 0); setDeckMenu(false); setFlash(""); }, [view]);

  // ── Helpers ──
  const accent = (subject) => data.accents[subject] || ACC[0];
  const titleColor = (subject) => (TITLE_TURQUOISE ? "#6ecece" : accent(subject));
  const dCards = deck ? cards.filter(c => c.subject === deck) : [];
  const weak = dCards.filter(c => c.status !== "sicher");
  const studyCard = cards.find(c => c.id === queue[qPos]);
  const groups = (card) => (card ? card.lines.filter(l => l.level === 0 && l.text.trim()).length : 0);
  const canRate = flipped && (!POINT_BY_POINT || reveal >= groups(studyCard));

  // ── Study ──
  const startStudy = (ids, scope = deck) => {
    if (!ids.length) return;
    setStudyScope(scope);
    if (SHUFFLE) ids = [...ids].sort(() => Math.random() - 0.5);
    setQueue(ids); setQPos(0); setFlipped(false); setReveal(0);
    setTally({ sicher: 0, unsicher: 0, nochmal: 0 });
    setView("study");
  };
  const tap = () => {
    if (!flipped) { setFlipped(true); setReveal(1); return; }
    if (POINT_BY_POINT && reveal < groups(studyCard)) setReveal(reveal + 1);
  };
  const rate = (kind) => {
    const card = studyCard;
    if (!card) return;
    update(d => ({ ...d, cards: d.cards.map(c => c.id === card.id ? schedule(c, kind, d.examDate) : c) }));
    const q = kind === "nochmal" ? [...queue, card.id] : queue;
    const next = qPos + 1;
    setQueue(q); setQPos(next);
    setTally(t => ({ ...t, [kind]: t[kind] + 1 }));
    setFlipped(false); setReveal(0); setNoAnim(true);
    setView(next >= q.length ? "done" : "study");
    setTimeout(() => setNoAnim(false), 40);
  };
  handlers.current = { view, tap, rate, canRate };

  // A card in the study queue can disappear if another device deletes it; just skip it.
  useEffect(() => {
    if (view !== "study" || studyCard || !queue.length) return;
    if (qPos + 1 < queue.length) setQPos(qPos + 1); else setView("done");
  }, [view, studyCard, qPos, queue.length]);

  useEffect(() => {
    const onKey = (e) => {
      const h = handlers.current;
      if (h.view !== "study") return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); h.tap(); }
      else if (h.canRate) { if (e.key === "1") h.rate("nochmal"); if (e.key === "2") h.rate("unsicher"); if (e.key === "3") h.rate("sicher"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const pMove = (e) => {
    const d = drag.current; if (!d) return;
    const x = e.clientX - d.x;
    if (Math.abs(x) > 8 || Math.abs(e.clientY - d.y) > 8) d.moved = true;
    if (canRate && d.moved) {
      if (!dragging) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
      setDx(x); setDragging(true);
    }
  };
  const pUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (!d.moved) { setDx(0); setDragging(false); return tap(); }
    if (canRate && Math.abs(dx) > 100) {
      const right = dx > 0;
      setDx(right ? 600 : -600); setDragging(false);
      setTimeout(() => {
        setDx(0); setDragging(true);
        handlers.current.rate(right ? "sicher" : "nochmal");
        setTimeout(() => setDragging(false), 40);
      }, 220);
      return;
    }
    setDx(0); setDragging(false);
  };
  const pCancel = () => { drag.current = null; setDx(0); setDragging(false); };

  // ── Editor ──
  const openEditor = (card, back) => {
    const d = JSON.parse(JSON.stringify(card));
    if (!d.lines.length) d.lines = [L(0, "")];
    draftOrig.current = draftKey(d);
    if (!d.title) focusTitle.current = true; // new card: start typing the title right away
    setDraft(d); setReturnTo(back); setFocusIdx(0); setView("edit");
  };
  const newCard = () => openEditor({ id: mid(), subject: deck || subjects[0], title: "", status: "neu", lines: [] }, "deck");
  const draftDirty = !!draft && draftKey(draft) !== draftOrig.current;
  useEffect(() => {
    if (view === "edit" && draft) {
      if (draftDirty) writeDraft({ draft, orig: draftOrig.current, returnTo, at: Date.now() });
      else writeDraft(null);
    }
  }, [draft, view, draftDirty, returnTo]);
  // Closing the tab or browser with unsaved changes: let the browser ask first.
  useEffect(() => {
    if (!draftDirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftDirty]);
  const closeEditor = (to) => { writeDraft(null); setSavedDraft(null); setDraft(null); setView(to); };
  const resumeDraft = () => {
    const s = savedDraft;
    draftOrig.current = s.orig;
    setDraft(s.draft); setReturnTo(s.returnTo || "deck"); setDeck(s.draft.subject); setFocusIdx(0);
    setSavedDraft(null); setView("edit");
  };
  const dropSavedDraft = () => { writeDraft(null); setSavedDraft(null); };
  const setLines = (fn, focus) => {
    const lines = fn(draft.lines.slice());
    if (focus != null) { pendingFocus.current = focus; setFocusIdx(focus); }
    setDraft({ ...draft, lines });
  };
  const maxLevel = (lines, i) => (i === 0 ? 0 : Math.min(MAX_LEVEL, lines[i - 1].level + 1));
  const shift = (i, delta) => setLines(ls => {
    const lvl = Math.max(0, Math.min(maxLevel(ls, i), ls[i].level + delta));
    ls[i] = { ...ls[i], level: lvl };
    for (let j = i + 1; j < ls.length && ls[j].level > lvl + 1; j++) ls[j] = { ...ls[j], level: lvl + 1 };
    return ls;
  }, i);
  const lineKey = (i, e) => {
    const ls = draft.lines, ln = ls[i];
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return; // shortcut: save & new card
    if (e.key === "Enter") {
      e.preventDefault();
      if (!ln.text.trim() && ln.level > 0) return shift(i, -1);
      setLines(x => { x.splice(i + 1, 0, L(ln.level, "")); return x; }, i + 1);
    } else if (e.key === "Tab") { e.preventDefault(); shift(i, e.shiftKey ? -1 : 1); }
    else if (e.key === "Backspace" && !ln.text && ls.length > 1) {
      e.preventDefault();
      setLines(x => { x.splice(i, 1); if (x[0]) x[0] = { ...x[0], level: 0 }; return x; }, Math.max(0, i - 1));
    }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); pendingFocus.current = i - 1; setFocusIdx(i - 1); }
    else if (e.key === "ArrowDown" && i < ls.length - 1) { e.preventDefault(); pendingFocus.current = i + 1; setFocusIdx(i + 1); }
  };
  const storeDraft = () => {
    const clean = { ...draft, title: draft.title.trim(), lines: draft.lines.filter(l => l.text.trim()) };
    const exists = cards.some(c => c.id === draft.id);
    const next = exists ? cards.map(c => c.id === draft.id ? clean : c) : [...cards, clean];
    update(d => ({ ...d, cards: next }));
    return { clean, next };
  };
  const saveDraft = () => {
    const { clean, next } = storeDraft();
    setDeck(clean.subject);
    setCardIdx(Math.max(0, next.filter(c => c.subject === clean.subject).findIndex(c => c.id === clean.id)));
    closeEditor("card");
  };
  // Leaving the editor by going back (header button, browser/phone back) keeps the work:
  // a card with a title is saved; only an untitled card with text asks before it's dropped.
  // Returns false if the user chose to stay.
  const leaveEditor = () => {
    if (!draft || !draftDirty) { closeEditor(returnTo); return true; }
    if (draft.title.trim()) { saveDraft(); return true; }
    if (!window.confirm("Diese Karte hat noch keinen Titel und kann nicht gespeichert werden. Verwerfen?")) return false;
    closeEditor(returnTo); return true;
  };
  const cancelEdit = () => {
    if (draftDirty && !window.confirm("Deine Änderungen an dieser Karte verwerfen?")) return;
    closeEditor(returnTo);
  };
  // Save the current card (if it has anything worth keeping) and start a blank one in the same deck.
  const saveAndNew = () => {
    const hasText = draft.lines.some(l => l.text.trim());
    const subject = draft.subject || deck || subjects[0];
    if (draft.title.trim()) {
      const { clean } = storeDraft();
      setDeck(clean.subject);
      setFlash(`„${clean.title}“ gespeichert`);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(""), 2500);
    } else if (hasText) {
      if (!window.confirm("Diese Karte hat noch keinen Titel und kann nicht gespeichert werden. Verwerfen und neue Karte anfangen?")) return;
    } else if (!cards.some(c => c.id === draft.id)) {
      focusTitle.current = true; setFocusIdx(0); return; // already a blank new card
    }
    const blank = { id: mid(), subject, title: "", status: "neu", lines: [L(0, "")] };
    draftOrig.current = draftKey(blank);
    writeDraft(null);
    setDraft(blank);
    setReturnTo("deck"); setFocusIdx(0);
    focusTitle.current = true;
    window.scrollTo(0, 0);
  };
  handlers.current.newCard = newCard;
  handlers.current.saveAndNew = saveAndNew;

  // Keyboard shortcuts for writing cards (Ctrl/Cmd+N belongs to the browser and can't be used):
  //   N          new card (when not typing in a field)
  //   Alt/⌥+N    new card from anywhere; in the editor: save this one and start the next
  //   Ctrl/⌘+Enter in the editor: save and start the next card
  useEffect(() => {
    const onKey = (e) => {
      const h = handlers.current;
      if (STUDY_ONLY || !["home", "deck", "card", "edit"].includes(h.view)) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const altN = e.altKey && !mod && e.code === "KeyN"; // e.code: on a Mac ⌥+N types a dead key
      const plainN = !typing && !mod && !e.altKey && e.key.toLowerCase() === "n";
      const saveNext = h.view === "edit" && mod && e.key === "Enter";
      if (!altN && !plainN && !saveNext) return;
      e.preventDefault();
      if (h.view === "edit") h.saveAndNew(); else h.newCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const deleteCard = () => {
    if (!window.confirm("Diese Karte löschen?")) return;
    update(d => ({ ...d, cards: d.cards.filter(c => c.id !== draft.id) }));
    setCardIdx(0); closeEditor("deck");
  };

  // ── Subjects ──
  const addSubject = () => {
    const n = newSubject.trim();
    if (!n || subjects.includes(n)) return;
    update(d => ({ ...d, subjects: [...d.subjects, n], accents: { ...d.accents, [n]: nextAccent(d.accents) } }));
    setNewSubject(""); setAddingSubject(false);
  };
  const cancelSubject = () => { setAddingSubject(false); setNewSubject(""); };
  const renameTrim = renameVal.trim();
  const renameError = !renameTrim ? "Der Name darf nicht leer sein."
    : renameTrim !== deck && subjects.includes(renameTrim) ? "Eine Mappe mit diesem Namen gibt es schon." : "";
  const doRename = () => {
    if (renameError) return;
    if (renameTrim !== deck) { update(d => renameSubject(d, deck, renameTrim)); setDeck(renameTrim); }
    setDeckMenu(false);
  };
  const doDeleteDeck = () => {
    const n = dCards.length;
    const msg = n ? `Mappe „${deck}“ mit ${plural(n, "Karte", "Karten")} löschen? Das lässt sich nicht rückgängig machen.` : `Leere Mappe „${deck}“ löschen?`;
    if (!window.confirm(msg)) return;
    update(d => deleteSubject(d, deck));
    setDeck(null); setView("home");
  };

  const goBack = () => {
    if (view === "deck") return setView("home");
    if (view === "edit") return leaveEditor();
    if ((view === "study" || view === "done") && !studyScope) return setView("home");
    setView("deck");
  };

  handlers.current.back = goBack;

  // Browser and phone "back" should move back inside the app (editor → card → deck → overview)
  // instead of leaving it. While not on the overview, one extra history entry is kept; pressing
  // back consumes it, we navigate back in-app and add it again if we're still not home.
  const ignorePop = useRef(false);
  useEffect(() => {
    const hasEntry = history.state?.lernkarten;
    if (view !== "home" && !hasEntry) history.pushState({ lernkarten: true }, "");
    if (view === "home" && hasEntry) { ignorePop.current = true; history.back(); }
  }, [view]);
  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      const h = handlers.current;
      if (h.view === "home") return;
      const left = h.back();
      // Stayed (e.g. "keep this untitled card?" → Cancel): restore the entry for the next back press.
      if (left === false) history.pushState({ lernkarten: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Backup ──
  const doExport = () => { exportBackup(data); update(d => ({ ...d, lastBackup: today() })); };
  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const next = parseBackup(await file.text());
      const also = sync.user ? " Durch den Sync gilt das auch für deine anderen Geräte." : "";
      if (!window.confirm(`${plural(next.cards.length, "Karte", "Karten")} aus der Sicherung laden? Deine aktuellen Karten werden dabei ersetzt.${also}`)) return;
      update({ ...next, lastBackup: today() });
      setView("home");
    } catch (err) { window.alert(err.message); }
  };

  // ── Sync ──
  const leaveSync = () => {
    if (!window.confirm("Auf diesem Gerät abmelden? Deine Karten bleiben hier, werden aber nicht mehr mit deinen anderen Geräten abgeglichen.")) return;
    sync.signOut();
  };
  const syncText = {
    connecting: "Verbinde …",
    syncing: "Wird synchronisiert …",
    ok: sync.lastSync ? `Synchronisiert · ${new Date(sync.lastSync).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : "Synchronisiert",
    offline: sync.error,
    error: sync.error,
  }[sync.status] || "";

  // ── Header ──
  const cIdx = Math.min(cardIdx, dCards.length - 1);
  const counterText = view === "study" ? `${qPos + 1} / ${queue.length}` : view === "card" ? `${cIdx + 1} / ${dCards.length}` : "";
  // Cards get more room on big screens; overview and deck lists stay narrow and easy to scan.
  const wide = ["card", "study", "edit"].includes(view) ? " wide" : "";
  const header = (
    <div className="hdr">
      <div className={"hdr-inner" + wide}>
        {view !== "home" && (
          <button className="back-btn" onClick={goBack} aria-label="Zurück">
            <span className="back-arrow">‹</span>
            <span className="back-label">{view === "deck" ? "Mappen" : (view === "study" || view === "done") ? (studyScope || "Start") : deck || "Zurück"}</span>
          </button>
        )}
        {view === "home" && (
          <div className="logo">
            <div className="logo-icon"><div className="logo-back" /><div className="logo-front"><div /></div></div>
            <span className="logo-text">Lernkarten</span>
          </div>
        )}
        <div className="spacer" />
        {(view === "deck" || view === "card") && !STUDY_ONLY && <button className="pill-btn" onClick={newCard} title="Neue Karte (Taste N)" aria-keyshortcuts="N">+ Karte</button>}
        {view === "edit" && draft && <button className="pill-btn" onClick={saveAndNew} aria-keyshortcuts="Control+Enter Meta+Enter Alt+N"
          title={`${draft.title.trim() ? "Aktuelle Karte speichern und eine neue anfangen" : "Neue Karte anfangen"} (${MOD} + Enter)`}>+ Neue Karte</button>}
        {(view === "study" || view === "card") && <span className="counter" aria-label={`Karte ${counterText.replace(" / ", " von ")}`}>{counterText}</span>}
      </div>
      {view === "study" && <div className="progress"><div style={{ width: (qPos / queue.length * 100) + "%" }} /></div>}
    </div>
  );

  const learnWeakBtn = (cls) => weak.length > 0 && (
    <button className={cls} onClick={() => startStudy(weak.map(c => c.id), deck)}>Nur unsichere &amp; neue ({weak.length})</button>
  );

  // ── Screens ──
  let screen = null;

  if (view === "home") {
    const total = cards.length, unsure = cards.filter(c => c.status === "unsicher").length;
    const due = cards.filter(isDue);
    const daysLeft = examDate ? daysBetween(today(), examDate) : null;
    const backupAge = data.lastBackup ? daysBetween(data.lastBackup, today()) : null;
    const nudgeBackup = total > 0 && !sync.user && (backupAge == null || backupAge >= 7);
    const results = searchCards(cards, query);
    screen = (
      <div className="screen home">
        <div className="home-head">
          <h1>Welches Fach lernst du heute?</h1>
          <p className="muted">{total ? `${plural(total, "Karte", "Karten")} · ${unsure} noch unsicher` : "Leg eine Mappe an und schreib deine erste Karte."}</p>
        </div>
        {savedDraft?.draft && (
          <div className="draft-banner" role="status">
            <div className="draft-text">
              <b>Ungespeicherte Karte</b>
              <span>{savedDraft.draft.title.trim() || "Ohne Titel"}{savedDraft.draft.subject ? ` · ${savedDraft.draft.subject}` : ""}</span>
            </div>
            <div className="draft-actions">
              <button className="btn-primary draft-btn" onClick={resumeDraft}>Weiterschreiben</button>
              <button className="link-btn danger" onClick={() => { if (window.confirm("Diesen Entwurf endgültig verwerfen?")) dropSavedDraft(); }}>Verwerfen</button>
            </div>
          </div>
        )}
        {total > 0 && (
          <div className="today">
            <div className="today-row">
              <div className="today-info">
                <span className="today-label">Heute fällig</span>
                <span className="today-count">{due.length ? plural(due.length, "Karte", "Karten") : "Alles erledigt"}</span>
              </div>
              {due.length > 0
                ? <button className="btn-primary today-btn" onClick={() => startStudy(due.map(c => c.id), null)}>Jetzt lernen</button>
                : <span className="today-done" aria-hidden="true">✓</span>}
            </div>
            <div className="exam-row">
              {editingExam ? (
                <>
                  <input type="date" className="exam-input" min={today()} defaultValue={examDate || ""} autoFocus
                    onChange={e => { if (e.target.value) update(d => ({ ...d, examDate: e.target.value })); }}
                    onBlur={() => setEditingExam(false)} />
                  {examDate && <button className="link-btn danger" onMouseDown={e => { e.preventDefault(); update(d => ({ ...d, examDate: null })); setEditingExam(false); }}>Entfernen</button>}
                  <button className="link-btn" onMouseDown={e => { e.preventDefault(); setEditingExam(false); }}>Fertig</button>
                </>
              ) : examDate && daysLeft >= 0 ? (
                <>
                  <span className="exam-text">Prüfung am <b>{formatDate(examDate)}</b> · {daysLeft === 0 ? "heute – viel Erfolg!" : daysLeft === 1 ? "morgen" : `noch ${daysLeft} Tage`}</span>
                  <button className="link-btn" onClick={() => setEditingExam(true)}>Ändern</button>
                </>
              ) : (
                <button className="link-btn" onClick={() => setEditingExam(true)}>{examDate ? "Prüfung vorbei – neuen Termin festlegen" : "+ Prüfungstermin festlegen"}</button>
              )}
            </div>
          </div>
        )}
        {total > 0 && (
          <div className="search" role="search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input className="search-input" type="search" value={query} placeholder="Karten durchsuchen" aria-label="Karten durchsuchen"
              onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); }} />
            {query && <button className="search-clear" aria-label="Suche leeren" onClick={() => setQuery("")}>×</button>}
          </div>
        )}
        {query.trim() ? (
          <div className="stack10" aria-live="polite">
            <span className="section-label">{plural(results.length, "Treffer", "Treffer")}</span>
            {results.length === 0 && <p className="search-empty">Nichts gefunden für „{query.trim()}“.</p>}
            {results.map(({ card: c, snippet }) => (
              <button key={c.id} className="card-row" onClick={() => {
                setDeck(c.subject);
                setCardIdx(cards.filter(x => x.subject === c.subject).findIndex(x => x.id === c.id));
                setView("card");
              }}>
                <div className="card-row-accent" style={{ background: titleColor(c.subject) }} />
                <div className="card-row-body">
                  <span className="card-row-deck">{c.subject}</span>
                  <span className="card-row-title">{c.title}</span>
                  <span className="card-row-preview">{snippet || "leer"}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (<>
        <div className="deck-list">
          {subjects.map((name) => {
            const cs = cards.filter(c => c.subject === name), n = cs.length;
            const sure = cs.filter(c => c.status === "sicher").length, uns = cs.filter(c => c.status === "unsicher").length;
            const dueIds = cs.filter(isDue).map(c => c.id);
            return (
              <div key={name} className="deck-row">
                <button className="deck-open" onClick={() => { setDeck(name); setView("deck"); }}>
                  <div className="deck-icon" aria-hidden="true">
                    <div className="deck-icon-back" />
                    <div className="deck-icon-front"><div className="strip" style={{ background: accent(name) }} /><div className="il" /><div className="il" /><div className="il" /></div>
                  </div>
                  <div className="deck-info">
                    <span className="deck-name">{name}</span>
                    <span className="deck-meta">{n ? `${plural(n, "Karte", "Karten")} · ${dueIds.length ? `${dueIds.length} fällig` : "nichts fällig"}` : "Noch leer"}</span>
                    {n > 0 && (
                      <div className="deck-bar" role="img" aria-label={`${sure} sicher, ${uns} unsicher`}>
                        <div style={{ background: "var(--green)", width: (sure / n * 100) + "%" }} />
                        <div style={{ background: "var(--amber)", width: (uns / n * 100) + "%" }} />
                      </div>
                    )}
                  </div>
                </button>
                {dueIds.length > 0 && (
                  <div className="deck-learn-wrap">
                    <button className="btn-primary deck-learn" aria-label={`${name} lernen`} onClick={() => { setDeck(name); startStudy(dueIds, name); }}>Lernen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {addingSubject && (
          <div className="add-row">
            <input className="add-input" value={newSubject} autoFocus placeholder="Name der Mappe" aria-label="Name der neuen Mappe"
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addSubject(); if (e.key === "Escape") cancelSubject(); }} />
            <button className="btn-primary add-ok" onClick={addSubject}>Anlegen</button>
            <button className="add-x" onClick={cancelSubject} aria-label="Abbrechen">×</button>
          </div>
        )}
        {!addingSubject && !STUDY_ONLY && <button className="new-deck" onClick={() => setAddingSubject(true)}>+ Neue Mappe</button>}
        </>)}
        <div className="sync" aria-live="polite">
          {sync.choice ? (
            <>
              <span className="sync-title">Deine Karten in der Cloud</span>
              <p className="sync-hint">In deinem Konto: <b>{plural(sync.choice.remoteCards, "Karte", "Karten")}</b> · auf diesem Gerät: <b>{plural(cards.length, "Karte", "Karten")}</b></p>
              <div className="stack10">
                <button className="btn-primary h48" onClick={() => sync.resolveChoice("merge")}>Zusammenführen – beide behalten</button>
                <button className="btn-secondary h48" onClick={() => sync.resolveChoice("replace")}>Nur die Karten aus meinem Konto</button>
              </div>
              <p className="sync-hint">Sind hier nur die Beispielkarten? Dann nimm „Nur die Karten aus meinem Konto“.</p>
            </>
          ) : sync.user ? (
            <>
              <div className="sync-row">
                <span className={`sync-dot ${sync.status}`} aria-hidden="true" />
                <span className="sync-text">{syncText}</span>
              </div>
              <div className="sync-actions">
                <span className="sync-hint sync-account">{sync.user.email || sync.user.displayName}</span>
                <button className="link-btn danger" onClick={leaveSync}>Abmelden</button>
              </div>
            </>
          ) : (
            <>
              <span className="sync-title">Auf allen Geräten lernen</span>
              <p className="sync-hint">Melde dich mit Google an – wie bei Goldhort – und deine Karten sind automatisch auf Handy, Tablet und Laptop.</p>
              <button className="btn-primary h48" disabled={sync.status === "connecting"} onClick={sync.signIn}>
                {sync.status === "connecting" ? "Einen Moment …" : "Mit Google anmelden"}
              </button>
              {sync.error && <p className="form-error" role="alert">{sync.error}</p>}
            </>
          )}
          {sync.user && sync.status === "error" && <p className="form-error" role="alert">{sync.error}</p>}
        </div>
        <div className="backup">
          {nudgeBackup && <p className="backup-nudge">{backupAge == null ? "Du hast noch keine Sicherung gemacht." : `Letzte Sicherung vor ${backupAge} Tagen.`} Deine Karten liegen nur in diesem Browser.</p>}
          <div className="backup-row">
            <button className="link-btn" onClick={doExport}>Sicherung speichern</button>
            <span className="backup-sep">·</span>
            <button className="link-btn" onClick={() => fileInput.current?.click()}>Sicherung laden</button>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={doImport} />
        </div>
      </div>
    );
  }

  if (view === "deck") {
    const sure = dCards.filter(c => c.status === "sicher").length;
    const dueCards = dCards.filter(isDue);
    const t = today();
    screen = (
      <div className="screen deck">
        <div className="deck-head">
          <div className="deck-swatch" style={{ background: accent(deck) }} />
          <div className="deck-title-row">
            <h1>{deck}</h1>
            {!STUDY_ONLY && <button className="icon-btn" aria-label="Mappe bearbeiten" aria-expanded={deckMenu}
              onClick={() => { setRenameVal(deck); setDeckMenu(m => !m); }}>⋯</button>}
          </div>
          <p className="muted">{dCards.length ? `${plural(dCards.length, "Karte", "Karten")} · ${sure} sicher · ${dCards.length - sure} offen` : "Noch keine Karten"}</p>
        </div>
        {deckMenu && (
          <div className="deck-menu">
            <label className="section-label" htmlFor="rename-deck" style={{ padding: 0 }}>Mappe umbenennen</label>
            <div className="deck-menu-row">
              <input id="rename-deck" className="add-input" value={renameVal} autoFocus
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setDeckMenu(false); }} />
              <button className="btn-primary add-ok" disabled={!!renameError} onClick={doRename}>Speichern</button>
            </div>
            {renameError && renameVal !== deck && <p className="form-error" role="alert">{renameError}</p>}
            <div className="deck-menu-actions">
              <button className="link-btn danger" onClick={doDeleteDeck}>Mappe löschen</button>
              <button className="link-btn" onClick={() => setDeckMenu(false)}>Schließen</button>
            </div>
          </div>
        )}
        {dCards.length > 0 ? (
          <>
            <div className="stack10">
              {dueCards.length > 0
                ? <button className="btn-primary h56 learn-all" onClick={() => startStudy(dueCards.map(c => c.id), deck)}>Fällige lernen · {plural(dueCards.length, "Karte", "Karten")}</button>
                : <p className="all-done">Für heute alles wiederholt. Stark.</p>}
              <div className="bottom-row">
                <button className="btn-secondary h48 spacer" onClick={() => startStudy(dCards.map(c => c.id), deck)}>Alle üben ({dCards.length})</button>
                {weak.length > 0 && <button className="btn-secondary h48 spacer" onClick={() => startStudy(weak.map(c => c.id), deck)}>Unsichere ({weak.length})</button>}
              </div>
            </div>
            <div className="stack10">
              <span className="section-label">Karten</span>
              {dCards.map((c, i) => {
                const [statusLabel, color] = STATUS[c.status || "neu"];
                const inDays = c.due && c.due > t ? daysBetween(t, c.due) : 0;
                const label = c.status === "neu" ? statusLabel : inDays === 1 ? "morgen" : inDays ? `in ${inDays} T.` : "fällig";
                return (
                  <button key={c.id} className="card-row" onClick={() => { setCardIdx(i); setView("card"); }}>
                    <div className="card-row-accent" style={{ background: titleColor(c.subject) }} />
                    <div className="card-row-body">
                      <span className="card-row-title">{c.title}</span>
                      <span className="card-row-preview">{c.lines.filter(l => l.level === 0).map(l => l.text).join(" · ") || "leer"}</span>
                    </div>
                    <div className="card-row-status"><span className="dot" style={{ background: color }} aria-hidden="true" />{label}</div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty">
            <p>Noch keine Karten in dieser Mappe.</p>
            {!STUDY_ONLY && <button className="btn-primary" onClick={newCard}>Erste Karte schreiben</button>}
          </div>
        )}
      </div>
    );
  }

  if (view === "card") {
    const c = dCards[cIdx];
    screen = c && (
      <div className="screen card-view">
        <div className="paper" style={{ "--accent": titleColor(c.subject) }}>
          <div className="paper-title" style={{ background: titleColor(c.subject) }}>{c.title}</div>
          <div className="paper-body" style={{ minHeight: 220 }}><Lines lines={mapLines(c.lines)} /></div>
        </div>
        <div className="spacer" />
        <div className="bottom-bar bottom-row">
          <button className="btn-secondary nav-arrow" aria-label="Vorherige Karte" disabled={cIdx === 0} onClick={() => setCardIdx(Math.max(0, cIdx - 1))}>‹</button>
          {!STUDY_ONLY && <button className="btn-secondary h52 spacer" onClick={() => openEditor(c, "card")}>Bearbeiten</button>}
          {STUDY_ONLY && <button className="btn-primary h52 spacer" onClick={() => startStudy(dCards.map(x => x.id), deck)}>Mappe lernen</button>}
          <button className="btn-secondary nav-arrow" aria-label="Nächste Karte" disabled={cIdx === dCards.length - 1} onClick={() => setCardIdx(Math.min(dCards.length - 1, cIdx + 1))}>›</button>
        </div>
      </div>
    );
  }

  if (view === "study" && studyCard) {
    const c = studyCard, g = groups(c), acc = titleColor(c.subject);
    screen = (
      <div className="screen study">
        <div className="mode-toggle" role="group" aria-label="Aufdecken">
          <button className={!POINT_BY_POINT ? "on" : ""} aria-pressed={!POINT_BY_POINT} onClick={() => update(d => ({ ...d, pointByPoint: false }))}>Ganze Karte</button>
          <button className={POINT_BY_POINT ? "on" : ""} aria-pressed={POINT_BY_POINT} onClick={() => update(d => ({ ...d, pointByPoint: true }))}>Punkt für Punkt</button>
        </div>
        <p className="sr-only" aria-live="polite">{flipped ? `Rückseite: ${c.title}.${canRate ? " Bewerte mit 1, 2 oder 3." : ""}` : `Vorderseite: ${c.title}. Leertaste zum Umdrehen.`}</p>
        <div className="flip-wrap" onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pCancel}
          style={{ transition: dragging ? "none" : "transform .25s ease", transform: `translateX(${dx}px) rotate(${dx / 22}deg)` }}>
          <div className="stamp stamp-sure" aria-hidden="true" style={{ opacity: Math.max(0, Math.min(1, dx / 110)) }}>SICHER</div>
          <div className="stamp stamp-again" aria-hidden="true" style={{ opacity: Math.max(0, Math.min(1, -dx / 110)) }}>NOCHMAL</div>
          <div className="flipper" style={{ transition: noAnim ? "none" : "transform .55s cubic-bezier(.2,.7,.2,1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="face face-front" aria-hidden={flipped}>
              <div className="face-strip" style={{ background: acc }} />
              <div className="face-subject">{c.subject}</div>
              <div className="face-title">{c.title}</div>
              <div className="face-hint">{plural(g, "Hauptpunkt", "Hauptpunkte")} — {POINT_BY_POINT ? "erinnere dich an jeden einzeln." : "was weißt du dazu?"} Tippen zum Umdrehen.</div>
            </div>
            <div className="face face-back" aria-hidden={!flipped} style={{ "--accent": acc }}>
              <div className="paper-title" style={{ background: acc }}>{c.title}</div>
              <div className="paper-body"><Lines lines={mapLines(c.lines, POINT_BY_POINT ? reveal : null)} /></div>
            </div>
          </div>
        </div>
        <div className="spacer" />
        <div className="bottom-bar">
          {!canRate ? (
            <button className="flip-btn" onClick={tap}>{!flipped ? "Umdrehen" : `Nächster Punkt (${reveal} / ${g})`}</button>
          ) : (
            <>
              <div className="rate-grid" role="group" aria-label="Wie gut wusstest du es?">
                <button className="rate rate-again" onClick={() => rate("nochmal")}>Nochmal<small>kommt gleich wieder</small></button>
                <button className="rate rate-unsure" onClick={() => rate("unsicher")}>Unsicher<small>fast gewusst</small></button>
                <button className="rate rate-sure" onClick={() => rate("sicher")}>Sicher<small>gewusst</small></button>
              </div>
              <p className="swipe-hint" aria-hidden="true">oder Karte wischen: ← Nochmal · Sicher →</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === "done") {
    const n = new Set(queue).size;
    screen = (
      <div className="screen done">
        <h1>Geschafft!</h1>
        <p>{plural(n, "Karte", "Karten")} {studyScope ? `aus ${studyScope}` : "aus allen Mappen"} durchgearbeitet.</p>
        <div className="tally">
          <div><b style={{ color: "var(--green)" }}>{tally.sicher}</b><span>sicher</span></div>
          <div><b style={{ color: "var(--amber)" }}>{tally.unsicher}</b><span>unsicher</span></div>
          <div><b style={{ color: "var(--red)" }}>{tally.nochmal}</b><span>wiederholt</span></div>
        </div>
        <div className="stack10" style={{ width: "100%" }}>
          {studyScope && learnWeakBtn("btn-primary h56")}
          <button className="btn-secondary h52" onClick={() => setView(studyScope ? "deck" : "home")}>{studyScope ? "Zurück zur Mappe" : "Zur Übersicht"}</button>
        </div>
      </div>
    );
  }

  if (view === "edit" && draft) {
    const ls = draft.lines, fi = Math.min(focusIdx, ls.length - 1), fl = ls[fi];
    const placeholders = ["Hauptpunkt", "Unterpunkt", "Begriff: Detail; Detail", "Unterdetail", "Stichpunkt"];
    // Inserts " → " at the cursor of the current line; two or more steps turn the line into boxes.
    const insertArrow = () => {
      if (!fl) return;
      const el = document.querySelector(`[data-line-idx="${fi}"]`);
      const text = fl.text, start = el?.selectionStart ?? text.length, end = el?.selectionEnd ?? start;
      const before = text.slice(0, start).replace(/\s+$/, ""), after = text.slice(end).replace(/^\s+/, "");
      const ins = (before ? " " : "") + "→ ";
      pendingCaret.current = before.length + ins.length;
      setLines(x => { x[fi] = { ...x[fi], text: before + ins + after }; return x; }, fi);
    };
    // Pasting several lines: each becomes its own line, indentation sets the level.
    // Into an empty line it replaces that line; otherwise the lines go below the current one.
    const insertRows = (x, rows, at, replace, base) => {
      const start = replace ? at : at + 1;
      let prev = start > 0 ? x[start - 1].level : -1;
      const fresh = rows.map(r => {
        const level = Math.max(0, Math.min(base + r.level, prev + 1, MAX_LEVEL));
        prev = level;
        return L(level, r.text);
      });
      x.splice(start, replace ? 1 : 0, ...fresh);
      // Lines below must not end up more than one level deeper than the last pasted line.
      for (let j = start + fresh.length; j < x.length && x[j].level > prev + 1; j++) { x[j] = { ...x[j], level: prev + 1 }; prev = x[j].level; }
      return { lines: x, last: start + fresh.length - 1 };
    };
    const pasteRows = (rows, at, replace, base) => {
      const { lines, last } = insertRows(draft.lines.slice(), rows, at, replace, base);
      pendingCaret.current = null; pendingFocus.current = last; setFocusIdx(last);
      setDraft({ ...draft, lines });
    };
    const onLinePaste = (i, e) => {
      const text = e.clipboardData?.getData("text") || "";
      if (!/\n/.test(text.trim())) return; // single line: normal paste
      e.preventDefault();
      const rows = parsePasted(text);
      if (rows.length) pasteRows(rows, i, !ls[i].text.trim(), ls[i].level);
    };
    const onTitlePaste = (e) => {
      const text = e.clipboardData?.getData("text") || "";
      if (!/\n/.test(text.trim())) return;
      e.preventDefault();
      let rows = parsePasted(text), title = draft.title;
      if (!rows.length) return;
      if (!title.trim()) {
        // First line becomes the title, the rest the card's lines (re-based to the top level).
        title = rows[0].text;
        rows = rows.slice(1);
        const min = Math.min(...rows.map(r => r.level));
        rows = rows.map(r => ({ ...r, level: r.level - min }));
      }
      if (!rows.length) { setDraft({ ...draft, title }); return; }
      const onlyEmpty = ls.length === 1 && !ls[0].text.trim();
      const { lines, last } = insertRows(draft.lines.slice(), rows, onlyEmpty ? 0 : ls.length - 1, onlyEmpty, 0);
      pendingCaret.current = null; pendingFocus.current = last; setFocusIdx(last);
      setDraft({ ...draft, title, lines });
    };
    const addLineAfter = () => setLines(x => { x.splice(fi + 1, 0, L(fl ? fl.level : 0, "")); return x; }, fi + 1);
    screen = (
      <div className="screen editor">
        <div className="chips" role="radiogroup" aria-label="Mappe">
          {subjects.map((name) => (
            <button key={name} role="radio" aria-checked={draft.subject === name} className={"chip" + (draft.subject === name ? " sel" : "")} onClick={() => setDraft({ ...draft, subject: name })}>
              <span className="dot" style={{ background: accent(name) }} aria-hidden="true" />{name}
            </button>
          ))}
        </div>
        <div className="paper">
          <div className="e-title-bar" style={{ background: titleColor(draft.subject) }}>
            <input className="e-title" value={draft.title} placeholder="Titel der Karte" aria-label="Titel der Karte" onPaste={onTitlePaste}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={e => {
                if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                // Focus directly: if focusIdx is already 0 there is no re-render to trigger the focus effect.
                const el = document.querySelector('[data-line-idx="0"]');
                if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (_) {} }
                setFocusIdx(0);
              }} />
          </div>
          <div className="e-body">
            {ls.map((l, i) => (
              <div key={l.id} className={`e-ln e-ln-${l.level}${l.level >= 2 ? " e-ln-deep" : ""}`} style={{ paddingLeft: 6 + l.level * 26 }}>
                <span className="e-mark" aria-hidden="true">{MARKS[l.level]}</span>
                <input data-line-idx={i} value={l.text} placeholder={placeholders[l.level]} aria-label={`Zeile ${i + 1}, ${LEVELS[l.level]}`}
                  onChange={e => {
                    // "->" becomes a real arrow as you type; keep the cursor where it was.
                    const raw = e.target.value, at = e.target.selectionStart ?? raw.length;
                    const t = raw.replace(/->/g, "→");
                    if (t !== raw) { pendingCaret.current = at - (raw.slice(0, at).match(/->/g) || []).length; pendingFocus.current = i; }
                    setLines(x => { x[i] = { ...x[i], text: t }; return x; });
                  }}
                  onKeyDown={e => lineKey(i, e)}
                  onPaste={e => onLinePaste(i, e)}
                  onFocus={e => { if (focusIdx !== i) setFocusIdx(i); const el = e.target; requestAnimationFrame(() => keepInView(el)); }} />
              </div>
            ))}
          </div>
        </div>
        {flash && <p className="flash" role="status">✓ {flash}</p>}
        <p className="e-help">{MOD} + Enter = speichern & nächste Karte · Enter = neue Zeile · Tab / ⇧Tab = ein- und ausrücken · Leere Zeile + ⌫ = löschen · Mehrere Zeilen einfügen: Einrückung wird übernommen · → trennt Schritte eines Ablaufs (z. B. Problem → Methode → Lösung); zwei Ablauf-Zeilen untereinander werden zu zwei Reihen · Flussdiagramm: kommt ein Schritt in mehreren Ablauf-Zeilen untereinander vor, werden sie verbunden (z. B. A → C, B → C, C → D) · Kreislauf: endet ein Ablauf wieder beim ersten Schritt (A → B → C → A), wird er als Kreis gezeichnet</p>
        {cards.some(c => c.id === draft.id) && <button className="e-delete" onClick={deleteCard}>Karte löschen</button>}
        <div className="spacer" />
        <div className="e-footer">
          <div className="toolbar">
            <button className="tool" disabled={!fl || fl.level === 0} onMouseDown={e => { e.preventDefault(); shift(fi, -1); }} onClick={e => { if (e.detail === 0) shift(fi, -1); }} aria-label="Ausrücken">⇤ Aus</button>
            <button className="tool" disabled={!fl || fl.level >= maxLevel(ls, fi)} onMouseDown={e => { e.preventDefault(); shift(fi, 1); }} onClick={e => { if (e.detail === 0) shift(fi, 1); }} aria-label="Einrücken">Ein ⇥</button>
            <span className="tool-level" aria-live="polite">{fl ? `${LEVELS[fl.level]}${parseFlow(fl.text) ? " · Ablauf" : ""}` : ""}</span>
            <button className="tool" disabled={!fl} onMouseDown={e => { e.preventDefault(); insertArrow(); }} onClick={e => { if (e.detail === 0) insertArrow(); }} aria-label="Pfeil einfügen – macht aus der Zeile einen Ablauf">→</button>
            <button className="tool" onMouseDown={e => { e.preventDefault(); addLineAfter(); }} onClick={e => { if (e.detail === 0) addLineAfter(); }}>+ Zeile</button>
          </div>
          <div className="bottom-row">
            <button className="btn-secondary h52 cancel" onClick={cancelEdit}>Abbrechen</button>
            <button className="btn-primary h52 spacer" disabled={!draft.title.trim() || !draft.subject} onClick={saveDraft}>Karte speichern</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {header}
      <div className={"main" + wide}>{screen}</div>
    </div>
  );
}
