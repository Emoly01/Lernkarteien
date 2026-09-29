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
export function mapLines(lines, reveal) {
  let g = -1;
  return lines.filter(l => l.text.trim()).map(l => {
    if (l.level === 0) g++;
    const shown = reveal == null || g < reveal;
    let label = "", rest = l.text;
    if (l.level >= 2) { const i = l.text.indexOf(":"); if (i > 0) { label = l.text.slice(0, i + 1) + " "; rest = l.text.slice(i + 1).trim(); } }
    return { key: l.id, level: l.level, text: l.text, label, rest, hidden: !shown, pad: l.level * 26 + 4, ghostW: [46, 58, 64, 60, 56][l.level] ?? 56 };
  });
}
