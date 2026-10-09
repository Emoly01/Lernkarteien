export const ACC = ["#6ecece", "#90d490", "#f0c080", "#d090c8", "#90b8e0", "#e09090", "#a8c870", "#c8a870"];
export const STATUS = { neu: ["neu", "#c8bfa8"], unsicher: ["unsicher", "#e0a94a"], sicher: ["sicher", "#5a7a4a"] };
export const LEVELS = ["Hauptpunkt", "Unterpunkt", "Detail", "Unterdetail", "Stichpunkt"];
export const MARKS = ["•", "×", "—", "◦", "·"];
export const MAX_LEVEL = LEVELS.length - 1;

const KEY = "lernkarten-redesign-v1";
const LEGACY_CARDS = "studycards-v1";
const LEGACY_SUBJECTS = "studycards-subjects-v1";

export const mid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const L = (level, text) => ({ id: mid(), level, text });
const C = (subject, title, status, rows) => ({ id: mid(), subject, title, status, lines: rows.map(r => L(r[0], r[1])) });
export const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

function seed() {
  return {
    subjects: ["Anästhesiologie", "Pharmakologie", "Pflegewissenschaft", "Anatomie"],
    cards: [
      C("Anästhesiologie", "Atemwegsmanagement I", "unsicher", [[0, "Anatomie"], [1, "Larynx"], [2, "Knorpel: Schildknorpel; Ringknorpel; Stellknorpel"], [2, "Innervation: N. laryngeus sup.; N. laryngeus recurrens"], [0, "Schwieriger Atemweg"], [1, "Prädiktoren"], [2, "Mallampati: Klasse III–IV"], [2, "Mundöffnung: < 3 cm"]]),
      C("Anästhesiologie", "Narkosestadien nach Guedel", "sicher", [[0, "Stadium I – Analgesie"], [1, "bis zum Bewusstseinsverlust"], [0, "Stadium II – Exzitation"], [1, "Unruhe, Erbrechen möglich"], [0, "Stadium III – Toleranz"], [1, "chirurgisches Stadium"], [0, "Stadium IV – Asphyxie"], [1, "Atemstillstand"]]),
      C("Anästhesiologie", "Rapid Sequence Induction", "neu", [[0, "Indikation"], [1, "nicht nüchtern"], [1, "Ileus, Schwangerschaft"], [0, "Ablauf"], [1, "Präoxygenierung"], [2, "Dauer: 3–5 min"], [1, "Einleitung ohne Zwischenbeatmung"]]),
      C("Pharmakologie", "Opioide", "sicher", [[0, "Wirkung"], [1, "Analgesie"], [1, "Atemdepression"], [0, "Beispiele"], [1, "Fentanyl"], [2, "Potenz: ca. 100× Morphin"], [1, "Remifentanil"], [2, "HWZ: 3–4 min, kontextunabhängig"]]),
      C("Pharmakologie", "Muskelrelaxanzien", "unsicher", [[0, "depolarisierend"], [1, "Succinylcholin"], [2, "NW: Hyperkaliämie; Maligne Hyperthermie"], [0, "nicht-depolarisierend"], [1, "Rocuronium"], [2, "Antagonist: Sugammadex"]]),
      C("Pflegewissenschaft", "Pflegeprozess", "neu", [[0, "Sechs Schritte"], [1, "Informationssammlung"], [1, "Probleme & Ressourcen"], [1, "Ziele festlegen"], [1, "Maßnahmen planen"], [1, "Durchführung"], [1, "Evaluation"]]),
    ],
  };
}

// Old format: card.points[].subs[].details[{label, values}] → flat outline lines
function migrateLegacy() {
  const raw = localStorage.getItem(LEGACY_CARDS);
  if (!raw) return null;
  const old = JSON.parse(raw);
  const subjRaw = localStorage.getItem(LEGACY_SUBJECTS);
  const subjects = subjRaw ? JSON.parse(subjRaw) : [];
  const cards = old.map(c => {
    const lines = [];
    for (const p of c.points || []) {
      lines.push(L(0, p.text || ""));
      for (const s of p.subs || []) {
        lines.push(L(1, s.text || ""));
        for (const d of s.details || []) {
          const text = d.label ? (d.values ? `${d.label}: ${d.values}` : d.label) : d.values || "";
          lines.push(L(2, text));
        }
      }
    }
    return { id: c.id || mid(), subject: c.subject, title: c.title || "", status: "neu", lines: lines.filter(l => l.text.trim()) };
  });
  for (const c of cards) if (c.subject && !subjects.includes(c.subject)) subjects.push(c.subject);
  return { subjects, cards };
}

// ── Spaced repetition (Leitner) ──────────────────────────────
// box 0 = neu; "Sicher" moves a card up one box, "Unsicher" down one, "Nochmal" back to box 1 (due again today).
export const INTERVALS = [0, 1, 3, 7, 14, 30]; // days until next review, per box
const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
export const isDue = c => !c.due || c.due <= today();
export const formatDate = s => parse(s).toLocaleDateString("de-DE", { day: "numeric", month: "short" });

// Before an exam, never schedule further out than half the remaining time,
// so reviews get denser as the date approaches and nothing lands after it.
export function schedule(card, kind, examDate) {
  const box = kind === "sicher" ? Math.min(INTERVALS.length - 1, (card.box || 0) + 1)
    : kind === "unsicher" ? Math.max(1, (card.box || 0) - 1) : 1;
  let days = kind === "nochmal" ? 0 : INTERVALS[box];
  const t = today();
  if (examDate && examDate > t) days = Math.min(days, Math.max(1, Math.floor(daysBetween(t, examDate) / 2)));
  return { ...card, box, due: addDays(t, days), status: kind === "sicher" ? "sicher" : "unsicher" };
}

// Each deck keeps its own colour, so deleting or renaming one never recolours the others.
// Decks without a stored colour get the one they had by position before this existed.
function withAccents(subjects, accents = {}) {
  const out = {};
  subjects.forEach((s, i) => { out[s] = accents[s] || ACC[i % ACC.length]; });
  return out;
}

// Least-used colour first, so a new deck looks different from the ones already there.
export function nextAccent(accents) {
  const used = Object.values(accents);
  return ACC.reduce((best, c) => (used.filter(u => u === c).length < used.filter(u => u === best).length ? c : best), ACC[0]);
}

export function renameSubject(d, from, to) {
  const accents = { ...d.accents, [to]: d.accents[from] };
  delete accents[from];
  return {
    ...d,
    subjects: d.subjects.map(s => (s === from ? to : s)),
    cards: d.cards.map(c => (c.subject === from ? { ...c, subject: to } : c)),
    accents,
  };
}

export function deleteSubject(d, name) {
  const accents = { ...d.accents };
  delete accents[name];
  return { ...d, subjects: d.subjects.filter(s => s !== name), cards: d.cards.filter(c => c.subject !== name), accents };
}

// Case- and accent-insensitive: "anasth" finds "Anästhesiologie".
export const fold = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");

export function searchCards(cards, query) {
  const q = fold(query.trim());
  if (!q) return [];
  return cards.filter(c => fold(c.title).includes(q) || c.lines.some(l => fold(l.text).includes(q)))
    .map(c => {
      const hit = fold(c.title).includes(q) ? null : c.lines.find(l => fold(l.text).includes(q));
      return { card: c, snippet: hit ? hit.text : c.lines.filter(l => l.level === 0).map(l => l.text).join(" · ") };
    });
}

function normalize(d) {
  const box0 = { neu: 0, unsicher: 1, sicher: 2 };
  const subjects = d.subjects || [];
  return {
    subjects,
    accents: withAccents(subjects, d.accents),
    cards: (d.cards || []).map(c => ({ ...c, status: c.status || "neu", box: c.box ?? box0[c.status || "neu"], due: c.due || null })),
    examDate: d.examDate || null,
    pointByPoint: d.pointByPoint ?? true,
    lastBackup: d.lastBackup || null,
    // Sync bookkeeping (see sync.js); older saves simply start at 0.
    tombstones: d.tombstones || {},
    subjectMeta: d.subjectMeta || {},
    subjectsAt: d.subjectsAt || 0,
    settingsAt: d.settingsAt || 0,
  };
}

// Takes a merged state from the sync server and keeps this device's local-only fields.
export function applySyncState(local, synced) {
  return normalize({ ...synced, lastBackup: local.lastBackup });
}

export function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!d || !d.cards) { try { d = migrateLegacy(); } catch (e) { d = null; } }
  if (!d || !d.cards) d = seed();
  return normalize(d);
}

export function persist(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
}

// ── Backup ───────────────────────────────────────────────────
export function exportBackup(d) {
  const blob = new Blob([JSON.stringify({ app: "lernkarten", version: 1, exportedAt: new Date().toISOString(), ...d }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lernkarten-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Returns normalized data or throws with a German message.
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error("Die Datei ist kein gültiges JSON."); }
  if (!d || !Array.isArray(d.cards) || !Array.isArray(d.subjects)) throw new Error("Das sieht nicht nach einer Lernkarten-Sicherung aus.");
  const ok = d.cards.every(c => c && typeof c.title === "string" && typeof c.subject === "string" && Array.isArray(c.lines));
  if (!ok) throw new Error("Einige Karten in der Datei sind beschädigt.");
  for (const c of d.cards) if (!d.subjects.includes(c.subject)) d.subjects.push(c.subject);
  return normalize(d);
}

// Turns card lines into render rows; `reveal` hides everything after the n-th Hauptpunkt.
// Turns pasted multi-line text into outline lines. Indentation decides the level (each deeper
// indent = one level); without indentation, the app's own markers (• × — ◦ ·) do. Bullet
// symbols are stripped, empty lines skipped, "->" becomes "→". Levels are relative (0 = top).
const BULLET = /^([•\-*×—–◦·▪●○])\s+/;
const MARKER_LEVEL = { "•": 0, "●": 0, "×": 1, "—": 2, "–": 2, "◦": 3, "○": 3, "·": 4, "▪": 4 };
export function parsePasted(text) {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  // Copied from Excel or SPSS: tabs separate cells, so each line becomes a table row. Leading tabs
  // are empty cells here, not indentation.
  const filled = raw.filter(r => r.trim()), tabbed = filled.filter(r => /\S\t/.test(r)).length;
  if (tabbed >= 2 && tabbed * 2 >= filled.length) {
    return filled.map(r => ({ level: 0, text: r.replace(/\s+$/, "").split("\t").map(c => c.trim()).join(" | ").trim() }));
  }
  const rows = raw
    .map(raw => {
      const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;
      let body = raw.trim(), marker = null;
      const m = body.match(BULLET);
      if (m) { marker = m[1]; body = body.slice(m[0].length).trim(); }
      return { indent, marker, text: body.replace(/->/g, "→") };
    })
    .filter(r => r.text);
  if (!rows.length) return [];
  const indents = [...new Set(rows.map(r => r.indent))].sort((a, b) => a - b);
  const useMarkers = indents.length === 1 && rows.some(r => r.marker && r.marker in MARKER_LEVEL && MARKER_LEVEL[r.marker] > 0);
  const out = [];
  for (const r of rows) {
    let level = useMarkers ? (MARKER_LEVEL[r.marker] ?? 0) : indents.indexOf(r.indent);
    const prev = out.length ? out[out.length - 1].level : 0;
    level = Math.max(0, Math.min(level, MAX_LEVEL, out.length ? prev + 1 : 0));
    out.push({ level, text: r.text });
  }
  return out;
}

// A line with arrows is a process: "Problem → Methode → Lösung" becomes boxes with arrows.
// Optional caption before a colon: "Ablauf: A → B → C". "->" and "=>" count as arrows too.
const ARROW = /\s*(?:→|->|=>)\s*/;
export function parseFlow(text) {
  let caption = "", body = text;
  const m = text.match(/^([^:]+?):\s+(.*)$/); // "Ablauf: …" – a colon followed by a space, so "10:30" stays intact
  if (m && !ARROW.test(m[1])) { caption = m[1].trim(); body = m[2]; }
  const steps = body.split(ARROW).map(s => s.trim());
  if (steps.length < 2 || steps.some(s => !s)) return null;
  return { caption, steps };
}

// Flow lines that share a step ("A → C" and "B → C") are one flowchart: a step name used more
// than once (ignoring case and spacing) is one box, linked to everything it's linked to.
const stepKey = s => fold(s).replace(/\s+/g, " ");
export function flowConnects(stepRows) {
  const all = stepRows.flat().map(stepKey);
  return new Set(all).size < all.length;
}

function flowEdges(stepRows) {
  const nodes = [], index = new Map(), edges = [], have = new Set();
  const id = text => {
    const k = stepKey(text);
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push(text); }
    return index.get(k);
  };
  for (const steps of stepRows) {
    const ids = steps.map(id);
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1], b = ids[i];
      if (a !== b && !have.has(a + ">" + b)) { have.add(a + ">" + b); edges.push({ from: a, to: b }); }
    }
  }
  return { nodes, edges };
}

// A flowchart that is nothing but one closed loop ("A → B → C → A", or written over several lines)
// is a cycle and gets drawn as a ring. Returns its steps in order, starting with the first one
// written, or null when anything branches off or the loop doesn't close.
export function flowCycle(stepRows) {
  const { nodes, edges } = flowEdges(stepRows);
  if (nodes.length < 2 || edges.length !== nodes.length) return null;
  const next = nodes.map(() => -1);
  for (const e of edges) { if (next[e.from] !== -1) return null; next[e.from] = e.to; }
  const order = [0];
  for (let v = next[0]; v !== 0; v = next[v]) { if (v === -1 || order.length >= nodes.length) return null; order.push(v); }
  return order.length === nodes.length ? order.map(v => nodes[v]) : null;
}

// Lays a flowchart out top to bottom in rows ("layers"). Returns
//   nodes: step texts; items: boxes plus invisible waypoints ({ node } or {}), one per row an
//   arrow skips; rows: item indices per row, left to right; links: one per arrow, the items it
//   passes through from top to bottom, and `back` when it really points up (closes a loop).
export function flowGraph(stepRows) {
  const { nodes, edges } = flowEdges(stepRows);
  // Loops: an arrow back to a step we're still following gets laid out reversed and drawn pointing up.
  const out = nodes.map(() => []);
  edges.forEach((e, i) => out[e.from].push(i));
  const state = nodes.map(() => 0), finished = []; // 0 unseen, 1 being followed, 2 done
  const visit = v => {
    state[v] = 1;
    for (const i of out[v]) { const w = edges[i].to; if (state[w] === 1) edges[i].back = true; else if (!state[w]) visit(w); }
    state[v] = 2; finished.push(v);
  };
  // Follow the steps in the order they were written, so the arrow that closes a loop is the one
  // written last ("Ergebnis → Ursache"), not whichever the walk happens to reach last.
  nodes.forEach((_, v) => { if (!state[v]) visit(v); });
  const topo = finished.reverse();
  const dag = edges.map(e => (e.back ? [e.to, e.from] : [e.from, e.to]));
  const preds = nodes.map(() => []), succs = nodes.map(() => []);
  dag.forEach(([a, b]) => { succs[a].push(b); preds[b].push(a); });
  // Each step goes one row below the lowest step leading to it; a starting step sits right above
  // the first step it leads to instead of at the very top.
  const layer = nodes.map(() => 0);
  for (const v of topo) for (const w of succs[v]) layer[w] = Math.max(layer[w], layer[v] + 1);
  for (const v of topo) if (!preds[v].length && succs[v].length) layer[v] = Math.min(...succs[v].map(w => layer[w])) - 1;
  // Arrows that skip rows get a waypoint in every row they cross, so they can go around boxes.
  const items = nodes.map((_, v) => ({ node: v, layer: layer[v] }));
  const links = dag.map(([a, b], i) => {
    const chain = [a];
    for (let l = layer[a] + 1; l < layer[b]; l++) { chain.push(items.length); items.push({ layer: l }); }
    chain.push(b);
    return { chain, back: !!edges[i].back };
  });
  const rows = Array.from({ length: Math.max(0, ...layer) + 1 }, () => []);
  items.forEach((it, i) => rows[it.layer].push(i));
  // Fewer crossings: sort each row by the average position of what it's connected to, a few times down and up.
  const up = items.map(() => []), down = items.map(() => []);
  for (const { chain } of links) for (let k = 1; k < chain.length; k++) { down[chain[k - 1]].push(chain[k]); up[chain[k]].push(chain[k - 1]); }
  const pos = [];
  const place = r => r.forEach((it, i) => { pos[it] = (i + 0.5) / r.length; });
  rows.forEach(place);
  const sortRow = (r, nb) => {
    const key = new Map(r.map(it => [it, nb[it].length ? nb[it].reduce((s, n) => s + pos[n], 0) / nb[it].length : pos[it]]));
    r.sort((a, b) => key.get(a) - key.get(b));
    place(r);
  };
  for (let n = 0; n < 4; n++) {
    for (let l = 1; l < rows.length; l++) sortRow(rows[l], up);
    for (let l = rows.length - 2; l >= 0; l--) sortRow(rows[l], down);
  }
  return { nodes, items: items.map(it => (it.node == null ? {} : { node: it.node })), rows, links };
}

// A line with "|" is a table row: "Häufigkeit | Prozent". The first row of a table is its header.
// A cell starting with "?" is a gap that stays hidden while studying until it's tapped: "?16,0".
export function parseTable(text) {
  if (!text.includes("|")) return null;
  return text.split("|").map(c => {
    c = c.trim();
    return c.length > 1 && c[0] === "?" ? { text: c.slice(1).trim(), gap: true } : { text: c };
  });
}

// Distribution shapes, named as in the lecture (Bortz 2005: 33, 38). The first name is the one the
// slides use; the others are accepted too and shown as "= …" under the picture. `note` is the
// Kennwert from the slides.
export const DISTS = [
  { id: "normal", names: ["Normalverteilung", "Gauß'sche Glockenkurve", "Glockenkurve", "normalverteilt"] },
  { id: "symmetrisch", names: ["symmetrisch"], note: "γ₁ = 0" },
  { id: "asymmetrisch", names: ["asymmetrisch"] },
  { id: "unimodal", names: ["unimodal", "eingipfelig"] },
  { id: "bimodal", names: ["bimodal", "zweigipfelig"] },
  { id: "multimodal", names: ["multimodal", "mehrgipfelig"] },
  { id: "schmalgipfelig", names: ["schmalgipfelig"] },
  { id: "breitgipfelig", names: ["breitgipfelig"] },
  { id: "linkssteil", names: ["linkssteil", "rechtsschief", "positiv schief"], note: "γ₁ > 0" },
  { id: "rechtssteil", names: ["rechtssteil", "linksschief", "negativ schief"], note: "γ₁ < 0" },
  { id: "uformig", names: ["u-förmig"] },
  { id: "abfallend", names: ["abfallend"] },
  { id: "flach", names: ["flache Wölbung", "platykurtisch"], note: "γ₂ < 0" },
  { id: "steil", names: ["steile Wölbung", "starke Wölbung", "leptokurtisch"], note: "γ₂ > 0" },
  { id: "normalW", names: ["normale Wölbung", "mesokurtisch"], note: "γ₂ = 0" },
];
const distKey = s => fold(s).replace(/[\s'’‘-]/g, "");
const DIST_BY_NAME = new Map(DISTS.flatMap(d => d.names.map(n => [distKey(n), { d, name: n }])));
function findDist(text) {
  // "linkssteile Verteilung", "Symmetrische" … are the same shape.
  const full = distKey(text), k = full.replace(/verteilung$/, "");
  return DIST_BY_NAME.get(full) || DIST_BY_NAME.get(k) || (k.endsWith("e") && DIST_BY_NAME.get(k.slice(0, -1))) || null;
}

// A line that starts with a chart type and a colon is drawn as that chart:
//   Kreisdiagramm: gedrückt 11 | gehoben 147
//   Balkendiagramm: Zufriedenheit | sehr unzufrieden 1,25 % | unzufrieden 6,88 % | …
//   Histogramm: 15–20 36 | 20–25 69 | 25–30 34
//   Verteilung: linkssteil | rechtssteil
// A first part without a number is the title. "?" makes a gap that stays hidden while studying:
// before a value ("neutral ?62"), before the chart type ("?Histogramm: …") or before a shape
// ("Verteilung: ?linkssteil"). Anything that doesn't fit (e.g. "Histogramm: nur metrisch")
// stays a normal line.
const CHART_TYPES = { kreisdiagramm: "pie", kuchendiagramm: "pie", tortendiagramm: "pie", balkendiagramm: "bar", saulendiagramm: "bar", stabdiagramm: "bar", histogramm: "hist", verteilung: "dist", verteilungsform: "dist", verteilungsformen: "dist" };
const ITEM = /^(.*?\S)(?:\s+|\s*[:=]\s*)(\?)?\s*([−+-]?\d+(?:[.,]\d+)*)(\s*%)?$/;
export const toNumber = s => { s = s.replace(/−/g, "-"); return parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); };
export function parseChart(text) {
  const m = text.match(/^(\?)?\s*([^:|]+?)\s*:\s*(.+)$/);
  const kind = m && CHART_TYPES[fold(m[2]).replace(/\s+/g, "")];
  if (!kind) return null;
  const parts = m[3].split(kind === "dist" ? /\s*[|;,]\s*/ : /\s*[|;]\s*/).filter(Boolean);
  if (kind === "dist") {
    const items = parts.map(p => {
      const gap = p[0] === "?", hit = findDist(gap ? p.slice(1) : p);
      return hit && { id: hit.d.id, name: hit.name, also: hit.d.names.find(n => n !== hit.name), note: hit.d.note, gap };
    });
    return items.length && items.every(Boolean) ? { kind, items } : null;
  }
  let title = "";
  if (parts.length && !ITEM.test(parts[0])) title = parts.shift();
  const items = parts.map(p => {
    const im = p.match(ITEM);
    return im && { label: im[1], value: im[3] + (im[4] ? " %" : ""), num: Math.max(0, toNumber(im[3])) || 0, gap: !!im[2] };
  });
  if (items.length < 2 || !items.every(Boolean)) return null;
  return { kind, type: m[2].trim(), typeGap: !!m[1], title, items };
}

export function mapLines(lines, reveal) {
  let g = -1;
  return lines.filter(l => l.text.trim()).map(l => {
    if (l.level === 0) g++;
    const shown = reveal == null || g < reveal;
    let label = "", rest = l.text;
    const chart = parseChart(l.text);
    const table = chart ? null : parseTable(l.text);
    if (l.level >= 2) { const i = l.text.indexOf(":"); if (i > 0) { label = l.text.slice(0, i + 1) + " "; rest = l.text.slice(i + 1).trim(); } }
    return { key: l.id, level: l.level, text: l.text, label, rest, chart, table, flow: chart || table ? null : parseFlow(l.text), hidden: !shown, pad: l.level * 26 + 4, ghostW: [46, 58, 64, 60, 56][l.level] ?? 56 };
  });
}
