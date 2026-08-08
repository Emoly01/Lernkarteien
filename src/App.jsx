import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CARDS_KEY, SUBJECTS_KEY,
  EMPTY_CARD, EMPTY_POINT, EMPTY_SUB, EMPTY_DETAIL,
  load, save, normalizeCards, normalizeSubjects,
} from "./storage.js";

const ACCENTS = ["#6ecece", "#90d490", "#f0c080", "#d090c8", "#90b8e0", "#e09090", "#a8c870", "#c8a870"];

const clone = (v) => JSON.parse(JSON.stringify(v));
const plural = (n) => (n === 1 ? "Karte" : "Karten");
const splitValues = (v) => v.split(";").map(s => s.trim()).filter(Boolean).join(" · ");

// ── Card renderer (like the physical card) ───────────────────
function CardView({ card, onEdit, onDelete, compact }) {
  return (
    <div className={`card-paper ${compact ? "card-compact" : ""}`}>
      <div className="card-title-bar">
        <span className="card-title-text">{card.title || "Ohne Titel"}</span>
        {!compact && (
          <div className="card-actions">
            <button className="card-act-btn" onClick={onEdit} aria-label="Karte bearbeiten" title="Bearbeiten">✎</button>
            <button className="card-act-btn del" onClick={onDelete} aria-label="Karte löschen" title="Löschen">✕</button>
          </div>
        )}
      </div>
      <div className="card-body">
        {card.points.map(p => (
          <div key={p.id} className="point-block">
            <div className="point-main">
              <span className="point-bullet" aria-hidden="true">•</span>
              <span className="point-label">{p.text}</span>
            </div>
            {p.subs.map(s => (
              <div key={s.id} className="sub-block">
                <div className="sub-row">
                  <span className="sub-marker" aria-hidden="true">×</span>
                  <span className="sub-text">{s.text}</span>
                </div>
                {s.details.some(d => d.label || d.values) && (
                  <div className="details-block">
                    {s.details.filter(d => d.label || d.values).map(d => (
                      <div key={d.id} className="detail-row">
                        <span className="detail-dash" aria-hidden="true">—</span>
                        <span className="detail-text">
                          {d.label && <span className="detail-label-text">{d.label}{d.values ? ": " : ""}</span>}
                          {splitValues(d.values)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Card editor ──────────────────────────────────────────────
function CardEditor({ card, subjects, onSave, onCancel }) {
  const [form, setForm] = useState(() => clone(card));
  const pristine = useRef(JSON.stringify(card));
  const isDirty = JSON.stringify(form) !== pristine.current;

  const setTitle = (v) => setForm(f => ({ ...f, title: v }));
  const setSubject = (v) => setForm(f => ({ ...f, subject: v }));

  const mapPoints = (fn) => setForm(f => ({ ...f, points: f.points.map(fn) }));
  const mapSubs = (pid, fn) => mapPoints(p => (p.id === pid ? { ...p, subs: p.subs.map(fn) } : p));

  const addPoint = () => setForm(f => ({ ...f, points: [...f.points, EMPTY_POINT()] }));
  const removePoint = (pid) => setForm(f => ({ ...f, points: f.points.filter(p => p.id !== pid) }));
  const updatePoint = (pid, text) => mapPoints(p => (p.id === pid ? { ...p, text } : p));

  const addSub = (pid) => mapPoints(p => (p.id === pid ? { ...p, subs: [...p.subs, EMPTY_SUB()] } : p));
  const removeSub = (pid, sid) => mapPoints(p => (p.id === pid ? { ...p, subs: p.subs.filter(s => s.id !== sid) } : p));
  const updateSub = (pid, sid, key, val) => mapSubs(pid, s => (s.id === sid ? { ...s, [key]: val } : s));

  const addDetail = (pid, sid) => mapSubs(pid, s => (s.id === sid ? { ...s, details: [...s.details, EMPTY_DETAIL()] } : s));
  const removeDetail = (pid, sid, did) =>
    mapSubs(pid, s => (s.id === sid ? { ...s, details: s.details.filter(d => d.id !== did) } : s));
  const updateDetail = (pid, sid, did, key, val) =>
    mapSubs(pid, s => (s.id === sid ? { ...s, details: s.details.map(d => (d.id === did ? { ...d, [key]: val } : d)) } : s));

  const cancel = () => {
    if (isDirty && !window.confirm("Änderungen verwerfen?")) return;
    onCancel();
  };

  const canSave = form.title.trim() && form.subject;

  return (
    <div className="editor-wrap">
      <div className="editor-fields">
        <div className="ef-row">
          <div className="ef-group" style={{ flex: 2 }}>
            <label className="ef-label" htmlFor="card-title">Titel der Karte</label>
            <input id="card-title" className="ef-input title-input" value={form.title}
              onChange={e => setTitle(e.target.value)}
              placeholder="z.B. Atemwegsmanagement I" autoFocus />
          </div>
          <div className="ef-group" style={{ flex: 1 }}>
            <label className="ef-label" htmlFor="card-subject">Fach / Mappe</label>
            <select id="card-subject" className="ef-select" value={form.subject} onChange={e => setSubject(e.target.value)}>
              <option value="">— wählen —</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="points-section">
          {form.points.map((p, pi) => (
            <div key={p.id} className="point-editor">
              <div className="point-editor-hdr">
                <span className="pe-bullet" aria-hidden="true">•</span>
                <input className="pe-input point-input" value={p.text}
                  onChange={e => updatePoint(p.id, e.target.value)}
                  aria-label={`Hauptpunkt ${pi + 1}`}
                  placeholder={`Hauptpunkt ${pi + 1} (z.B. Anatomie)`} />
                <button className="pe-del" onClick={() => removePoint(p.id)}
                  aria-label={`Hauptpunkt ${pi + 1} entfernen`}>✕</button>
              </div>

              {p.subs.map(s => (
                <div key={s.id} className="sub-editor">
                  <div className="sub-editor-hdr">
                    <span className="se-marker" aria-hidden="true">×</span>
                    <input className="pe-input sub-input" value={s.text}
                      onChange={e => updateSub(p.id, s.id, "text", e.target.value)}
                      aria-label="Unterpunkt"
                      placeholder="Unterpunkt (z.B. nervale Versorgung)" />
                    <button className="pe-del" onClick={() => removeSub(p.id, s.id)}
                      aria-label="Unterpunkt entfernen">✕</button>
                  </div>
                  <div className="detail-editor-rows">
                    {s.details.map(d => (
                      <div key={d.id} className="detail-editor-row">
                        <span className="detail-hint" aria-hidden="true">—</span>
                        <input className="pe-input detail-label-input" value={d.label}
                          onChange={e => updateDetail(p.id, s.id, d.id, "label", e.target.value)}
                          aria-label="Detail-Bezeichnung"
                          placeholder="z.B. N. Vagus" />
                        <span className="detail-colon" aria-hidden="true">:</span>
                        <input className="pe-input detail-values-input" value={d.values}
                          onChange={e => updateDetail(p.id, s.id, d.id, "values", e.target.value)}
                          aria-label="Detail-Inhalt"
                          placeholder="Details mit ; trennen" />
                        <button className="pe-del" onClick={() => removeDetail(p.id, s.id, d.id)}
                          aria-label="Detail-Zeile entfernen">✕</button>
                      </div>
                    ))}
                    <button className="add-detail-btn" onClick={() => addDetail(p.id, s.id)}>+ Detail-Zeile</button>
                  </div>
                </div>
              ))}

              <button className="add-sub-btn" onClick={() => addSub(p.id)}>+ Unterpunkt</button>
            </div>
          ))}
        </div>

        <button className="add-point-btn" onClick={addPoint}>+ Hauptpunkt hinzufügen</button>
      </div>

      {/* Live preview */}
      {(form.title || form.points.some(p => p.text)) && (
        <div className="preview-section">
          <p className="preview-label">Vorschau</p>
          <CardView card={form} compact />
        </div>
      )}

      <div className="editor-footer">
        <button className="save-btn" onClick={() => onSave(form)} disabled={!canSave}>
          Karte speichern
        </button>
        <button className="cancel-btn" onClick={cancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function StudyCards() {
  const [{ cards, subjects }, setData] = useState(load);
  const [view, setView] = useState("home"); // home | browse | create | edit
  const [activeSubject, setActiveSubject] = useState(null);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [editingCard, setEditingCard] = useState(null);
  const [newSubject, setNewSubject] = useState("");
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const importRef = useRef(null);

  // Persist as a side effect of state, so no update path can forget to save.
  useEffect(() => { if (!save(CARDS_KEY, cards)) setStorageError(true); }, [cards]);
  useEffect(() => { if (!save(SUBJECTS_KEY, subjects)) setStorageError(true); }, [subjects]);

  const browsable = useMemo(
    () => (activeSubject ? cards.filter(c => c.subject === activeSubject) : cards),
    [cards, activeSubject],
  );

  // Deleting a card, or moving one to another subject while editing, can shrink
  // the list under the cursor — clamp before it indexes past the end.
  const index = Math.min(browseIndex, Math.max(0, browsable.length - 1));
  useEffect(() => { if (index !== browseIndex) setBrowseIndex(index); }, [index, browseIndex]);

  const go = useCallback((delta) => {
    setBrowseIndex(i => Math.min(Math.max(0, i + delta), Math.max(0, browsable.length - 1)));
  }, [browsable.length]);

  useEffect(() => {
    if (view !== "browse") return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, go]);

  const saveCard = (form) => {
    setData(d => ({
      ...d,
      cards: d.cards.some(c => c.id === form.id)
        ? d.cards.map(c => (c.id === form.id ? form : c))
        : [...d.cards, form],
    }));
    setView(activeSubject ? "browse" : "home");
    setEditingCard(null);
  };

  const deleteCard = (id) => {
    if (!window.confirm("Diese Karte löschen?")) return;
    setData(d => ({ ...d, cards: d.cards.filter(c => c.id !== id) }));
  };

  const startCreate = () => {
    setEditingCard({ ...EMPTY_CARD(), subject: activeSubject || "" });
    setView("create");
  };

  const startEdit = (card) => { setEditingCard(clone(card)); setView("edit"); };

  const addSubject = () => {
    const name = newSubject.trim();
    if (!name || subjects.includes(name)) return;
    setData(d => ({ ...d, subjects: [...d.subjects, name] }));
    setNewSubject(""); setShowAddSubject(false);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ version: 1, cards, subjects }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lernkarten-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const nextCards = normalizeCards(parsed.cards);
      const nextSubjects = normalizeSubjects(parsed.subjects);
      if (!nextCards.length && !nextSubjects.length) throw new Error("leer");
      if (!window.confirm(`${nextCards.length} ${plural(nextCards.length)} importieren? Der aktuelle Bestand wird ersetzt.`)) return;
      setData({ cards: nextCards, subjects: nextSubjects.length ? nextSubjects : subjects });
      setActiveSubject(null); setBrowseIndex(0); setView("home");
    } catch {
      window.alert("Datei konnte nicht gelesen werden.");
    }
  };

  const leaveEditor = () => { setView(activeSubject ? "browse" : "home"); setEditingCard(null); };

  return (
    <div className="app-shell">
      {/* ── Header ── */}
      <div className="hdr">
        <div className="hdr-top">
          <div>
            <p className="hdr-title">Lernkarten</p>
            <p className="hdr-sub">{cards.length} {plural(cards.length)} · {subjects.length} Fächer</p>
          </div>
          {view !== "home" && (
            <button className="back-btn" onClick={() => {
              if (view === "browse") { setActiveSubject(null); setBrowseIndex(0); setView("home"); }
              else leaveEditor();
            }}>
              ← {view === "browse" ? "Fächer" : activeSubject || "Übersicht"}
            </button>
          )}
        </div>
      </div>

      {storageError && (
        <p className="empty" role="alert" style={{ padding: "0.6rem", color: "#a04a4a" }}>
          Speichern nicht möglich — bitte exportiere deine Karten als Sicherung.
        </p>
      )}

      {/* ── Home ── */}
      {view === "home" && (
        <div className="home-page">
          <p className="home-greeting">
            {cards.length === 0
              ? "Willkommen! Wähle ein Fach und erstelle deine erste Karte. Eine Karte, wann immer du magst. 🌿"
              : "Welches Fach lernst du heute?"}
          </p>

          <div className="subject-grid">
            {subjects.map((sub, i) => {
              const count = cards.filter(c => c.subject === sub).length;
              return (
                <button key={sub} type="button" className="subject-card"
                  style={{ "--accent": ACCENTS[i % ACCENTS.length] }}
                  onClick={() => { setActiveSubject(sub); setBrowseIndex(0); setView("browse"); }}>
                  <p className="subject-name">{sub}</p>
                  <p className="subject-count">{count} {plural(count)}</p>
                  <div className="subject-bar" aria-hidden="true">
                    {Array.from({ length: Math.min(count, 8) }).map((_, j) => <div key={j} className="mini-card" />)}
                  </div>
                </button>
              );
            })}
          </div>

          {showAddSubject ? (
            <div className="add-subject-area">
              <input className="add-subj-input" value={newSubject} onChange={e => setNewSubject(e.target.value)}
                aria-label="Fachname"
                placeholder="Fachname..." autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter") addSubject();
                  if (e.key === "Escape") { setShowAddSubject(false); setNewSubject(""); }
                }} />
              <button className="tiny-btn" onClick={addSubject}>Hinzufügen</button>
              <button className="tiny-btn ghost" onClick={() => { setShowAddSubject(false); setNewSubject(""); }}
                aria-label="Abbrechen">✕</button>
            </div>
          ) : (
            <button className="add-mappe-btn" onClick={() => setShowAddSubject(true)}>+ Neue Mappe erstellen</button>
          )}

          <div className="backup-row">
            <button className="backup-btn" onClick={exportBackup} disabled={!cards.length}>Sicherung exportieren</button>
            <button className="backup-btn" onClick={() => importRef.current?.click()}>Sicherung importieren</button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden
              onChange={e => { importBackup(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </div>
      )}

      {/* ── Browse ── */}
      {view === "browse" && (
        <div className="browse-page">
          {browsable.length === 0 ? (
            <div className="empty">
              Noch keine Karten in {activeSubject}.<br />
              <span style={{ fontSize: "0.85rem" }}>Erstelle deine erste Karte!</span>
              <br /><br />
              <button className="browse-add-btn" style={{ margin: "0 auto", display: "block" }} onClick={startCreate}>
                + Erste Karte erstellen
              </button>
            </div>
          ) : (
            <>
              <div className="browse-nav">
                <button className="nav-btn" onClick={() => go(-1)} disabled={index === 0} aria-label="Vorherige Karte">←</button>
                <span className="browse-counter">{index + 1} / {browsable.length} — {activeSubject}</span>
                <button className="nav-btn" onClick={() => go(1)} disabled={index === browsable.length - 1} aria-label="Nächste Karte">→</button>
              </div>

              <CardView
                key={browsable[index].id}
                card={browsable[index]}
                onEdit={() => startEdit(browsable[index])}
                onDelete={() => deleteCard(browsable[index].id)}
              />

              <div className="dot-row">
                {browsable.map((c, i) => (
                  <button key={c.id} type="button" className={`dot ${i === index ? "active" : ""}`}
                    aria-label={`Karte ${i + 1}: ${c.title || "Ohne Titel"}`}
                    aria-current={i === index}
                    onClick={() => setBrowseIndex(i)} />
                ))}
              </div>

              <p className="browse-hint">← → zum Blättern</p>

              <div className="browse-actions">
                <button className="browse-add-btn" onClick={startCreate}>+ Neue Karte</button>
                <button className="browse-edit-btn" onClick={() => startEdit(browsable[index])}>Bearbeiten</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Create / Edit ── */}
      {(view === "create" || view === "edit") && editingCard && (
        <CardEditor
          key={editingCard.id}
          card={editingCard}
          subjects={subjects}
          onSave={saveCard}
          onCancel={leaveEditor}
        />
      )}
    </div>
  );
}
