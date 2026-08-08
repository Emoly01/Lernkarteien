export const CARDS_KEY = "studycards-v1";
export const SUBJECTS_KEY = "studycards-subjects-v1";

export const DEFAULT_SUBJECTS = ["Anästhesiologie", "Pflegewissenschaft", "Pharmakologie", "Anatomie"];

let idCounter = 0;
export function makeId() {
  return Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 5);
}

export const EMPTY_DETAIL = () => ({ id: makeId(), label: "", values: "" });
export const EMPTY_SUB = () => ({ id: makeId(), text: "", details: [] });
export const EMPTY_POINT = () => ({ id: makeId(), text: "", subs: [] });
export const EMPTY_CARD = () => ({ id: makeId(), subject: "", title: "", points: [], createdAt: Date.now() });

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);

// Anything that reaches the renderer must have the full shape — stored JSON can be
// hand-edited, imported, or written by an older version of the app.
function normalizeCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: str(raw.id) || makeId(),
    subject: str(raw.subject),
    title: str(raw.title),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    points: arr(raw.points).map(p => ({
      id: str(p?.id) || makeId(),
      text: str(p?.text),
      subs: arr(p?.subs).map(s => ({
        id: str(s?.id) || makeId(),
        text: str(s?.text),
        details: arr(s?.details).map(d => ({
          id: str(d?.id) || makeId(),
          label: str(d?.label),
          values: str(d?.values),
        })),
      })),
    })),
  };
}

export function normalizeCards(raw) {
  return arr(raw).map(normalizeCard).filter(Boolean);
}

export function normalizeSubjects(raw) {
  const list = arr(raw).map(str).map(s => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

export function load() {
  try {
    const cards = normalizeCards(JSON.parse(localStorage.getItem(CARDS_KEY) || "[]"));
    const stored = localStorage.getItem(SUBJECTS_KEY);
    const subjects = stored ? normalizeSubjects(JSON.parse(stored)) : DEFAULT_SUBJECTS;
    return { cards, subjects: subjects.length ? subjects : DEFAULT_SUBJECTS };
  } catch {
    return { cards: [], subjects: DEFAULT_SUBJECTS };
  }
}

// Returns false when the write failed (private mode, quota) so the UI can warn
// instead of silently losing the user's cards.
export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
