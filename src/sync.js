// Sync between devices. Pure functions only (no Firebase here), so they can be unit-tested.
//
// Every change carries a timestamp so two devices can be merged without losing work:
//   card.tAt / lAt / sAt – when the title / the lines / the deck last changed
//   card.at        – latest of those three (used against deletions)
//   card.srsAt     – when study progress (status/box/due) last changed
//   tombstones     – { cardId: deletedAt }, so a deletion wins over an older copy
//   subjectMeta    – { name: { at, deleted } }, same idea for decks
//   subjectsAt     – when the deck order last changed
//   settingsAt     – when examDate / pointByPoint last changed
// Title, lines, deck and progress merge separately: fix a card's title on the laptop while
// editing its text or rating it on the phone, and every change survives.

const contentKey = c => JSON.stringify([c.subject, c.title, c.lines]);
const srsKey = c => JSON.stringify([c.status, c.box, c.due]);
const FIELDS = [["title", "tAt"], ["lines", "lAt"], ["subject", "sAt"]];
const fieldAt = (c, key) => c[key] || c.at || 0;

// Called on every local change (prev → next) to stamp what changed.
export function stamp(prev, next, now = Date.now()) {
  const prevCards = new Map(prev.cards.map(c => [c.id, c]));
  const nextIds = new Set();
  const cards = next.cards.map(c => {
    nextIds.add(c.id);
    const p = prevCards.get(c.id);
    if (!p) { const t = c.at || now; return { ...c, at: t, tAt: c.tAt || t, lAt: c.lAt || t, sAt: c.sAt || t, srsAt: c.srsAt || now }; }
    let out = c;
    for (const [f, key] of FIELDS) {
      // Older cards have no per-field stamps yet: pin each to the previous overall one first.
      if (out[key] == null) out = { ...out, [key]: p[key] ?? p.at ?? 0 };
      if (JSON.stringify(p[f]) !== JSON.stringify(c[f])) out = { ...out, [key]: now, at: now };
    }
    if (srsKey(p) !== srsKey(c)) out = { ...out, srsAt: now };
    return out;
  });
  const tombstones = { ...next.tombstones };
  for (const id of prevCards.keys()) if (!nextIds.has(id)) tombstones[id] = now;

  const subjectMeta = { ...next.subjectMeta };
  const before = new Set(prev.subjects), after = new Set(next.subjects);
  for (const s of after) if (!before.has(s)) subjectMeta[s] = { at: now, deleted: false };
  for (const s of before) if (!after.has(s)) subjectMeta[s] = { at: now, deleted: true };
  const subjectsAt = JSON.stringify(prev.subjects) !== JSON.stringify(next.subjects) ? now : next.subjectsAt;

  const settingsAt = prev.examDate !== next.examDate || prev.pointByPoint !== next.pointByPoint ? now : next.settingsAt;
  return { ...next, cards, tombstones, subjectMeta, subjectsAt, settingsAt };
}

// The part of the app state that travels between devices.
export function toSyncState(d) {
  return {
    v: 1,
    subjects: d.subjects, subjectMeta: d.subjectMeta || {}, subjectsAt: d.subjectsAt || 0, accents: d.accents || {},
    cards: d.cards.map(c => ({
      id: c.id, subject: c.subject, title: c.title,
      lines: c.lines.map(l => ({ id: l.id, level: l.level, text: l.text })),
      status: c.status || "neu", box: c.box || 0, due: c.due || null, at: c.at || 0, srsAt: c.srsAt || 0,
      tAt: c.tAt || c.at || 0, lAt: c.lAt || c.at || 0, sAt: c.sAt || c.at || 0,
    })),
    tombstones: d.tombstones || {},
    examDate: d.examDate ?? null, pointByPoint: d.pointByPoint ?? true, settingsAt: d.settingsAt || 0,
  };
}

// Merges two sync states. Commutative, so it doesn't matter which side is "local".
export function mergeStates(a, b) {
  if (!b) return a;
  if (!a) return b;

  const tombstones = { ...a.tombstones };
  for (const [id, t] of Object.entries(b.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, t);

  const byId = new Map();
  for (const c of [...a.cards, ...b.cards]) {
    const o = byId.get(c.id);
    if (!o) { byId.set(c.id, c); continue; }
    const merged = { ...o, at: Math.max(o.at || 0, c.at || 0) };
    for (const [f, key] of FIELDS) {
      const ta = fieldAt(c, key), tb = fieldAt(o, key);
      const win = ta > tb || (ta === tb && JSON.stringify(c[f]) > JSON.stringify(o[f])) ? c : o;
      merged[f] = win[f]; merged[key] = Math.max(ta, tb);
    }
    const srs = (c.srsAt || 0) > (o.srsAt || 0) || ((c.srsAt || 0) === (o.srsAt || 0) && srsKey(c) > srsKey(o)) ? c : o;
    Object.assign(merged, { status: srs.status, box: srs.box, due: srs.due, srsAt: srs.srsAt });
    byId.set(c.id, merged);
  }
  const cards = [...byId.values()].filter(c => !(tombstones[c.id] >= Math.max(c.at || 0, c.srsAt || 0)));
  // A tombstone older than the card's latest change means the card was restored or edited after; drop it.
  for (const c of cards) if (tombstones[c.id]) delete tombstones[c.id];

  const subjectMeta = {};
  for (const m of [a.subjectMeta || {}, b.subjectMeta || {}]) {
    for (const [name, v] of Object.entries(m)) {
      const o = subjectMeta[name];
      if (!o || v.at > o.at || (v.at === o.at && v.deleted && !o.deleted)) subjectMeta[name] = v;
    }
  }
  const bFirst = (b.subjectsAt || 0) > (a.subjectsAt || 0)
    || ((b.subjectsAt || 0) === (a.subjectsAt || 0) && JSON.stringify(b.subjects) > JSON.stringify(a.subjects));
  const newer = bFirst ? b : a, older = bFirst ? a : b;
  const names = [...newer.subjects, ...older.subjects.filter(s => !newer.subjects.includes(s))];
  // Cards can arrive for a deck another device deleted meanwhile; keep the deck rather than orphan them.
  const used = new Set(cards.map(c => c.subject));
  const subjects = names.filter(s => used.has(s) || !subjectMeta[s]?.deleted);
  for (const s of used) if (!subjects.includes(s)) subjects.push(s);
  for (const s of subjects) if (subjectMeta[s]?.deleted) subjectMeta[s] = { at: subjectMeta[s].at, deleted: false };

  const accents = { ...older.accents, ...newer.accents };
  const settings = (b.settingsAt || 0) > (a.settingsAt || 0)
    || ((b.settingsAt || 0) === (a.settingsAt || 0) && JSON.stringify([b.examDate, b.pointByPoint]) > JSON.stringify([a.examDate, a.pointByPoint])) ? b : a;

  return {
    v: 1, subjects, subjectMeta, subjectsAt: Math.max(a.subjectsAt || 0, b.subjectsAt || 0), accents,
    cards, tombstones,
    examDate: settings.examDate ?? null, pointByPoint: settings.pointByPoint ?? true,
    settingsAt: Math.max(a.settingsAt || 0, b.settingsAt || 0),
  };
}

// Server-side guard: never trust the shape or size of what a client sends.
const str = (s, max) => (typeof s === "string" ? s.slice(0, max) : "");
const num = n => (Number.isFinite(n) ? n : 0);
export function sanitizeState(s) {
  if (!s || typeof s !== "object" || !Array.isArray(s.cards) || !Array.isArray(s.subjects)) return null;
  if (s.cards.length > 20000 || s.subjects.length > 500) return null;
  const date = d => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const meta = {};
  for (const [k, v] of Object.entries(s.subjectMeta || {}).slice(0, 2000)) meta[str(k, 200)] = { at: num(v?.at), deleted: !!v?.deleted };
  const tomb = {};
  for (const [k, v] of Object.entries(s.tombstones || {}).slice(0, 50000)) tomb[str(k, 64)] = num(v);
  const accents = {};
  for (const [k, v] of Object.entries(s.accents || {}).slice(0, 500)) if (/^#[0-9a-fA-F]{6}$/.test(v)) accents[str(k, 200)] = v;
  return {
    v: 1,
    subjects: s.subjects.map(x => str(x, 200)).filter(Boolean),
    subjectMeta: meta, subjectsAt: num(s.subjectsAt), accents,
    cards: s.cards.filter(c => c && typeof c.id === "string").map(c => ({
      id: str(c.id, 64), subject: str(c.subject, 200), title: str(c.title, 500),
      lines: (Array.isArray(c.lines) ? c.lines : []).slice(0, 500).map(l => ({
        id: str(l?.id, 64), level: Math.max(0, Math.min(4, Math.floor(num(l?.level)))), text: str(l?.text, 4000),
      })),
      status: ["neu", "unsicher", "sicher"].includes(c.status) ? c.status : "neu",
      box: Math.max(0, Math.min(10, Math.floor(num(c.box)))), due: date(c.due),
      at: num(c.at), srsAt: num(c.srsAt), tAt: num(c.tAt), lAt: num(c.lAt), sAt: num(c.sAt),
    })),
    tombstones: tomb,
    examDate: date(s.examDate), pointByPoint: s.pointByPoint !== false, settingsAt: num(s.settingsAt),
  };
}

// Order-independent comparison: same cards in a different order count as equal.
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
export function fingerprint(s) {
  if (!s) return "";
  return JSON.stringify(sortKeys({ ...s, cards: [...s.cards].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) }));
}

// ── Mapping to Firestore documents ─────────────────────────────
const META_KEYS = ["subjects", "subjectMeta", "subjectsAt", "accents", "examDate", "pointByPoint", "settingsAt"];
const cardFP = c => fingerprint({ cards: [c] });
const metaOf = s => Object.fromEntries(META_KEYS.map(k => [k, s[k]]));
const metaFP = m => (m ? JSON.stringify(sortKeys(metaOf(m))) : "");

// Card documents (deleted ones are { id, deleted: true, at }) + meta document → sync state.
export function fromDocs(cardDocs, meta) {
  const tombstones = {}, cards = [];
  for (const d of cardDocs) {
    if (!d || typeof d.id !== "string") continue;
    if (d.deleted) tombstones[d.id] = Math.max(tombstones[d.id] || 0, d.at || 0);
    else cards.push(d);
  }
  return sanitizeState({ v: 1, subjects: [], ...(meta || {}), cards, tombstones });
}

// What has to be written so the server matches the (already merged) local state.
export function diffForServer(local, remoteDocs, remoteMeta) {
  const byId = new Map(remoteDocs.map(d => [d.id, d]));
  const cards = [];
  for (const c of local.cards) {
    const r = byId.get(c.id);
    if (!r || r.deleted || cardFP(r) !== cardFP(c)) cards.push(c);
  }
  for (const [id, at] of Object.entries(local.tombstones)) {
    const r = byId.get(id);
    // Also for cards the server never saw, so every device ends with the same deletion list.
    if (!r || !(r.deleted && r.at >= at)) cards.push({ id, deleted: true, at });
  }
  const meta = metaFP(local) !== metaFP(remoteMeta) ? metaOf(local) : null;
  return { cards, meta };
}
