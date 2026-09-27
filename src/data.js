export const ACC = ["#6ecece", "#90d490", "#f0c080", "#d090c8", "#90b8e0", "#e09090", "#a8c870", "#c8a870"];
export const STATUS = { neu: ["neu", "#c8bfa8"], unsicher: ["unsicher", "#e0a94a"], sicher: ["sicher", "#5a7a4a"] };
export const LEVELS = ["Hauptpunkt", "Unterpunkt", "Detail"];

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

export function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!d || !d.cards) { try { d = migrateLegacy(); } catch (e) { d = null; } }
  if (!d || !d.cards) d = seed();
  return d;
}

export function persist(d) {
  try { localStorage.setItem(KEY, JSON.stringify({ subjects: d.subjects, cards: d.cards })); } catch (e) {}
}

// Turns card lines into render rows; `reveal` hides everything after the n-th Hauptpunkt.
export function mapLines(lines, reveal) {
  let g = -1;
  return lines.filter(l => l.text.trim()).map(l => {
    if (l.level === 0) g++;
    const shown = reveal == null || g < reveal;
    let label = "", rest = l.text;
    if (l.level === 2) { const i = l.text.indexOf(":"); if (i > 0) { label = l.text.slice(0, i + 1) + " "; rest = l.text.slice(i + 1).trim(); } }
    return { key: l.id, level: l.level, text: l.text, label, rest, hidden: !shown, pad: l.level * 26 + 4, ghostW: [46, 58, 64][l.level] };
  });
}
