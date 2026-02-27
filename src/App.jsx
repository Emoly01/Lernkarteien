import { useState, useEffect } from "react";

function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

const DEFAULT_SUBJECTS = ["Anästhesiologie", "Pflegewissenschaft", "Pharmakologie", "Anatomie"];

const EMPTY_CARD = () => ({
  id: makeId(),
  subject: "",
  title: "",
  points: [],
  createdAt: Date.now(),
});

const EMPTY_POINT = () => ({ id: makeId(), text: "", subs: [] });
const EMPTY_SUB = () => ({ id: makeId(), text: "", details: [] });
const EMPTY_DETAIL = () => ({ id: makeId(), label: "", values: "" });

// ── Storage ──────────────────────────────────────────────────
function load() {
  try {
    const c = localStorage.getItem("studycards-v1"); 
    const s = localStorage.getItem("studycards-subjects-v1");
    return {
      cards: c ? JSON.parse(c) : [],
      subjects: s ? JSON.parse(s) : DEFAULT_SUBJECTS,
    };
  } catch { return { cards: [], subjects: DEFAULT_SUBJECTS }; }
}

function saveCards(cards) { try { localStorage.setItem("studycards-v1", JSON.stringify(cards)); } catch {} }
function saveSubjects(s) { try { localStorage.setItem("studycards-subjects-v1", JSON.stringify(s)); } catch {} }

// ── Card renderer (like the physical card) ───────────────────
function CardView({ card, onEdit, onDelete, compact }) {
  return (
    <div className={`card-paper ${compact ? "card-compact" : ""}`}>
      <div className="card-title-bar">
        <span className="card-title-text">{card.title || "Ohne Titel"}</span>
        {!compact && (
          <div className="card-actions">
            <button className="card-act-btn" onClick={onEdit}>✎</button>
            <button className="card-act-btn del" onClick={onDelete}>✕</button>
          </div>
        )}
      </div>
      <div className="card-body">
        {card.points.map(p => (
          <div key={p.id} className="point-block">
            <div className="point-main">
              <span className="point-bullet">•</span>
              <span className="point-label">{p.text}</span>
            </div>
            {p.subs.map(s => (
              <div key={s.id} className="sub-block">
                <div className="sub-row">
                  <span className="sub-marker">×</span>
                  <span className="sub-text">{s.text}</span>
                </div>
                {(s.details || []).length > 0 && (
                  <div className="details-block">
                    {s.details.map((d, i) => (d.label || d.values) && (
                      <div key={i} className="detail-row">
                        <span className="detail-dash">—</span>
                        <span className="detail-text">
                          {d.label && <span className="detail-label-text">{d.label}{d.values ? ": " : ""}</span>}
                          {d.values}
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
  const [form, setForm] = useState(() => JSON.parse(JSON.stringify(card)));

  const setTitle = (v) => setForm(f => ({ ...f, title: v }));
  const setSubject = (v) => setForm(f => ({ ...f, subject: v }));

  const addPoint = () => setForm(f => ({ ...f, points: [...f.points, EMPTY_POINT()] }));
  const removePoint = (pid) => setForm(f => ({ ...f, points: f.points.filter(p => p.id !== pid) }));
  const updatePoint = (pid, text) => setForm(f => ({ ...f, points: f.points.map(p => p.id === pid ? { ...p, text } : p) }));

  const addSub = (pid) => setForm(f => ({
    ...f, points: f.points.map(p => p.id === pid ? { ...p, subs: [...p.subs, EMPTY_SUB()] } : p)
  }));
  const removeSub = (pid, sid) => setForm(f => ({
    ...f, points: f.points.map(p => p.id === pid ? { ...p, subs: p.subs.filter(s => s.id !== sid) } : p)
  }));
  const addDetail = (pid, sid) => setForm(f => ({
    ...f, points: f.points.map(p => p.id === pid
      ? { ...p, subs: p.subs.map(s => s.id === sid ? { ...s, details: [...(s.details||[]), EMPTY_DETAIL()] } : s) }
      : p)
  }));
  const removeDetail = (pid, sid, did) => setForm(f => ({
    ...f, points: f.points.map(p => p.id === pid
      ? { ...p, subs: p.subs.map(s => s.id === sid ? { ...s, details: (s.details||[]).filter(d => d.id !== did) } : s) }
      : p)
  }));
  const updateDetail = (pid, sid, did, key, val) => setForm(f => ({
    ...f, points: f.points.map(p => p.id === pid
      ? { ...p, subs: p.subs.map(s => s.id === sid
          ? { ...s, details: (s.details||[]).map(d => d.id === did ? { ...d, [key]: val } : d) }
          : s) }
      : p)
  }));

  return (
    <div className="editor-wrap">
      <div className="editor-fields">
        <div className="ef-row">
          <div className="ef-group" style={{ flex: 2 }}>
            <label className="ef-label">Titel der Karte</label>
            <input className="ef-input title-input" value={form.title} onChange={e => setTitle(e.target.value)}
              placeholder="z.B. Atemwegsmanagement I" autoFocus />
          </div>
          <div className="ef-group" style={{ flex: 1 }}>
            <label className="ef-label">Fach / Mappe</label>
            <select className="ef-select" value={form.subject} onChange={e => setSubject(e.target.value)}>
              <option value="">— wählen —</option>
              {subjects.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="points-section">
          {form.points.map((p, pi) => (
            <div key={p.id} className="point-editor">
              <div className="point-editor-hdr">
                <span className="pe-bullet">•</span>
                <input className="pe-input point-input" value={p.text}
                  onChange={e => updatePoint(p.id, e.target.value)}
                  placeholder={`Hauptpunkt ${pi + 1} (z.B. Anatomie)`} />
                <button className="pe-del" onClick={() => removePoint(p.id)}>✕</button>
              </div>

              {p.subs.map(s => (
                <div key={s.id} className="sub-editor">
                  <div className="sub-editor-hdr">
                    <span className="se-marker">×</span>
                    <input className="pe-input sub-input" value={s.text}
                      onChange={e => updateSub(p.id, s.id, "text", e.target.value)}
                      placeholder="Unterpunkt (z.B. nervale Versorgung)" />
                    <button className="pe-del" onClick={() => removeSub(p.id, s.id)}>✕</button>
                  </div>
                  <div className="detail-editor-rows">
                    {(s.details||[]).map(d => (
                      <div key={d.id} className="detail-editor-row">
                        <span className="detail-hint">—</span>
                        <input className="pe-input detail-label-input" value={d.label}
                          onChange={e => updateDetail(p.id, s.id, d.id, "label", e.target.value)}
                          placeholder="z.B. N. Vagus" />
                        <span style={{ color: "#c0b090", fontSize: "0.8rem", flexShrink: 0 }}>:</span>
                        <input className="pe-input detail-values-input" value={d.values}
                          onChange={e => updateDetail(p.id, s.id, d.id, "values", e.target.value)}
                          placeholder="Details mit ; trennen" />
                        <button className="pe-del" onClick={() => removeDetail(p.id, s.id, d.id)}>✕</button>
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
        <button className="save-btn" onClick={() => onSave(form)}
          disabled={!form.title.trim() || !form.subject}>
          Karte speichern
        </button>
        <button className="cancel-btn" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function StudyCards() {
  const [data, setData] = useState(() => load());
  const [view, setView] = useState("home"); // home | browse | create | edit
  const [activeSubject, setActiveSubject] = useState(null);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [editingCard, setEditingCard] = useState(null);
  const [newSubject, setNewSubject] = useState("");
  const [showAddSubject, setShowAddSubject] = useState(false);

  const { cards, subjects } = data;

  const updateCards = (c) => { setData(d => ({ ...d, cards: c })); saveCards(c); };
  const updateSubjects = (s) => { setData(d => ({ ...d, subjects: s })); saveSubjects(s); };

  const subjectCards = (sub) => cards.filter(c => c.subject === sub);
  const browsable = activeSubject ? subjectCards(activeSubject) : cards;

  const saveCard = (form) => {
    const updated = editingCard?.id && cards.find(c => c.id === editingCard.id)
      ? cards.map(c => c.id === form.id ? form : c)
      : [...cards, form];
    updateCards(updated);
    setView(activeSubject ? "browse" : "home");
    setEditingCard(null);
  };

  const deleteCard = (id) => {
    if (!window.confirm("Diese Karte löschen?")) return;
    updateCards(cards.filter(c => c.id !== id));
    if (browseIndex >= browsable.length - 1) setBrowseIndex(Math.max(0, browseIndex - 1));
  };

  const startCreate = (subject) => {
    const blank = EMPTY_CARD();
    blank.subject = subject || activeSubject || "";
    setEditingCard(blank);
    setView("create");
  };

  const startEdit = (card) => { setEditingCard(JSON.parse(JSON.stringify(card))); setView("edit"); };

  const addSubject = () => {
    if (!newSubject.trim() || subjects.includes(newSubject.trim())) return;
    updateSubjects([...subjects, newSubject.trim()]);
    setNewSubject(""); setShowAddSubject(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f2ede3", fontFamily: "'Kalam', 'Comic Sans MS', cursive" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Kalam:wght@300;400;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #c8bfa8; }

        /* ── Header ── */
        .hdr { background: #e8e0cc; border-bottom: 2px solid #c8bfa8; padding: 0.8rem 1.2rem; position: sticky; top: 0; z-index: 30; }
        .hdr-top { display: flex; align-items: center; justify-content: space-between; }
        .hdr-title { font-family: 'Cinzel', serif; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #4a3e28; margin: 0; }
        .hdr-sub { font-family: 'Kalam', cursive; font-size: 0.75rem; color: #8a7a5a; margin: 0.1rem 0 0; }
        .back-btn { font-family: 'Cinzel', serif; font-size: 0.55rem; letter-spacing: 0.15em; text-transform: uppercase; color: #6a5a3a; background: none; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; gap: 0.3rem; transition: color 0.15s; }
        .back-btn:hover { color: #4a3e28; }

        /* ── Home: subject grid ── */
        .home-page { padding: 1.2rem; max-width: 600px; margin: 0 auto; }
        .home-greeting { font-family: 'Kalam', cursive; font-size: 1.1rem; color: #6a5a3a; margin-bottom: 1.2rem; line-height: 1.5; }
        .subject-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.8rem; margin-bottom: 1rem; }
        .subject-card { background: #fff; border: 1px solid #d8d0bc; border-top: 4px solid var(--accent); border-radius: 4px; padding: 1rem; cursor: pointer; transition: all 0.15s; box-shadow: 2px 3px 8px rgba(0,0,0,0.07); }
        .subject-card:hover { transform: translateY(-2px); box-shadow: 2px 6px 14px rgba(0,0,0,0.1); }
        .subject-card:active { transform: translateY(0); }
        .subject-name { font-family: 'Cinzel', serif; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; color: #3a2e18; margin: 0 0 0.4rem; line-height: 1.3; }
        .subject-count { font-family: 'Kalam', cursive; font-size: 0.85rem; color: #9a8a6a; }
        .subject-bar { display: flex; gap: 0.3rem; margin-top: 0.5rem; flex-wrap: wrap; }
        .mini-card { width: 12px; height: 16px; background: var(--accent); opacity: 0.4; border-radius: 1px; }

        .add-subject-area { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
        .add-subj-input { flex: 1; background: #fff; border: 1px solid #c8bfa8; color: #2a2218; font-family: 'Kalam', cursive; font-size: 0.9rem; padding: 0.4rem 0.7rem; outline: none; border-radius: 4px; }
        .add-subj-input::placeholder { color: #c0b090; }
        .tiny-btn { font-family: 'Cinzel', serif; font-size: 0.5rem; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; background: #5a7a4a; border: none; padding: 0.4rem 0.7rem; cursor: pointer; border-radius: 4px; transition: all 0.15s; }
        .tiny-btn.ghost { color: #8a7a5a; background: #e8e0cc; }
        .add-mappe-btn { font-family: 'Cinzel', serif; font-size: 0.52rem; letter-spacing: 0.12em; text-transform: uppercase; color: #7a8a5a; background: none; border: 1px dashed #a8b898; padding: 0.5rem 0.8rem; cursor: pointer; border-radius: 4px; transition: all 0.15s; width: 100%; margin-top: 0.4rem; }
        .add-mappe-btn:hover { background: #e8f0e0; }

        /* ── Card paper ── */
        .card-paper { background: #fff; border: 1px solid #d8d0bc; border-radius: 2px; box-shadow: 3px 4px 12px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255,255,255,0.8); overflow: hidden; }
        .card-compact { box-shadow: 2px 3px 8px rgba(0,0,0,0.07); }
        .card-title-bar { background: #6ecece; padding: 0.5rem 0.9rem; display: flex; align-items: center; justify-content: space-between; }
        .card-title-text { font-family: 'Kalam', cursive; font-size: 1.05rem; font-weight: 700; color: #1a3a3a; line-height: 1.2; }
        .card-actions { display: flex; gap: 0.4rem; }
        .card-act-btn { font-family: 'Cinzel', serif; font-size: 0.55rem; background: rgba(255,255,255,0.3); border: none; color: #1a3a3a; cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 2px; transition: all 0.15s; }
        .card-act-btn:hover { background: rgba(255,255,255,0.5); }
        .card-act-btn.del:hover { background: rgba(200,60,60,0.2); color: #8a2020; }

        .card-body { padding: 0.7rem 0.9rem; background-image: repeating-linear-gradient(transparent, transparent 27px, #ddd8cc 27px, #ddd8cc 28px); background-size: 100% 28px; min-height: 80px; }

        .point-block { margin-bottom: 0.4rem; }
        .point-main { display: flex; align-items: baseline; gap: 0.3rem; margin-bottom: 0.1rem; }
        .point-bullet { color: #2a2218; font-size: 1rem; flex-shrink: 0; }
        .point-label { font-family: 'Kalam', cursive; font-size: 0.95rem; font-weight: 700; background: #a8e8a8; padding: 0 0.3rem; border-radius: 1px; color: #1a2a1a; line-height: 1.6; }

        .sub-block { margin-left: 1.2rem; }
        .sub-row { display: flex; align-items: baseline; gap: 0.3rem; }
        .sub-marker { font-family: 'Kalam', cursive; font-size: 0.85rem; color: #4a7a4a; flex-shrink: 0; font-weight: 700; }
        .sub-text { font-family: 'Kalam', cursive; font-size: 0.88rem; color: #2a2218; line-height: 1.5; }

        .details-block { margin-left: 1rem; }
        .detail-row { display: flex; align-items: baseline; gap: 0.3rem; }
        .detail-dash { font-family: 'Kalam', cursive; font-size: 0.82rem; color: #7a6a4a; flex-shrink: 0; }
        .detail-text { font-family: 'Kalam', cursive; font-size: 0.82rem; color: #4a3e28; line-height: 1.5; }

        /* ── Browse view ── */
        .browse-page { padding: 0.8rem 1rem; max-width: 600px; margin: 0 auto; }
        .browse-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8rem; }
        .browse-counter { font-family: 'Cinzel', serif; font-size: 0.6rem; letter-spacing: 0.15em; color: #8a7a5a; }
        .nav-btn { font-family: 'Cinzel', serif; font-size: 0.8rem; background: #e8e0cc; border: 1px solid #c8bfa8; color: #4a3e28; cursor: pointer; padding: 0.4rem 0.9rem; border-radius: 4px; transition: all 0.15s; }
        .nav-btn:hover:not(:disabled) { background: #ddd6c0; }
        .nav-btn:disabled { opacity: 0.3; }
        .browse-actions { display: flex; gap: 0.5rem; margin-top: 0.8rem; }
        .browse-edit-btn { font-family: 'Cinzel', serif; font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #fff; background: #5a7a4a; border: none; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px; }
        .browse-add-btn { font-family: 'Cinzel', serif; font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #fff; background: #7a5c2e; border: none; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px; }

        .dot-row { display: flex; gap: 0.3rem; justify-content: center; margin-top: 0.6rem; flex-wrap: wrap; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: #c8bfa8; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .dot.active { background: #6ecece; width: 18px; border-radius: 3px; }

        /* ── Editor ── */
        .editor-wrap { padding: 0.8rem 1rem 2rem; max-width: 600px; margin: 0 auto; }
        .ef-row { display: flex; gap: 0.7rem; margin-bottom: 0.7rem; flex-wrap: wrap; }
        .ef-group { display: flex; flex-direction: column; gap: 0.25rem; min-width: 140px; }
        .ef-label { font-family: 'Cinzel', serif; font-size: 0.5rem; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: #7a6a4a; }
        .ef-input { background: #fff; border: 1px solid #c8bfa8; color: #2a2218; font-family: 'Kalam', cursive; font-size: 0.95rem; padding: 0.5rem 0.7rem; outline: none; border-radius: 4px; transition: border-color 0.15s; width: 100%; }
        .ef-input:focus { border-color: #6ecece; }
        .ef-input::placeholder { color: #c0b090; }
        .ef-select { background: #fff; border: 1px solid #c8bfa8; color: #2a2218; font-family: 'Kalam', cursive; font-size: 0.9rem; padding: 0.5rem 0.7rem; outline: none; border-radius: 4px; width: 100%; cursor: pointer; }
        .title-input { font-size: 1rem; font-weight: 700; border-color: #6ecece; background: #f0fafa; }

        .points-section { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
        .point-editor { background: #faf7f0; border: 1px solid #d8d0bc; border-left: 3px solid #a8e8a8; padding: 0.6rem 0.8rem; border-radius: 0 4px 4px 0; }
        .point-editor-hdr { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.5rem; }
        .pe-bullet { font-size: 1rem; color: #2a2218; flex-shrink: 0; }
        .pe-input { flex: 1; background: #fff; border: 1px solid #d8d0bc; color: #2a2218; font-family: 'Kalam', cursive; padding: 0.35rem 0.5rem; outline: none; border-radius: 3px; transition: border-color 0.15s; resize: vertical; }
        .pe-input:focus { border-color: #6ecece; }
        .pe-input::placeholder { color: #c0b090; }
        .point-input { font-size: 0.95rem; font-weight: 700; }
        .pe-del { background: none; border: none; color: #c0b090; cursor: pointer; font-size: 0.8rem; flex-shrink: 0; transition: color 0.15s; padding: 0.1rem; }
        .pe-del:hover { color: #c44a4a; }

        .sub-editor { margin-left: 0.8rem; margin-bottom: 0.4rem; background: #fff; border: 1px solid #d8d0bc; border-left: 2px solid #a8c8a8; padding: 0.4rem 0.6rem; border-radius: 0 3px 3px 0; }
        .sub-editor-hdr { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
        .se-marker { font-family: 'Kalam', cursive; font-size: 0.85rem; color: #4a7a4a; font-weight: 700; flex-shrink: 0; }
        .sub-input { font-size: 0.88rem; }
        .detail-editor-rows { display: flex; flex-direction: column; gap: 0.3rem; margin-left: 0.5rem; margin-bottom: 0.3rem; }
        .detail-editor-row { display: flex; align-items: center; gap: 0.3rem; }
        .detail-label-input { font-size: 0.82rem; max-width: 110px; }
        .detail-values-input { font-size: 0.82rem; flex: 1; }
        .add-detail-btn { font-family: 'Kalam', cursive; font-size: 0.75rem; color: #7a6a4a; background: none; border: 1px dashed #c8b898; padding: 0.2rem 0.5rem; cursor: pointer; border-radius: 3px; margin-left: 0.5rem; transition: all 0.15s; }
        .add-detail-btn:hover { background: #f5f0e0; }
        .detail-label-text { font-weight: 700; }
        .detail-hint { font-family: 'Kalam', cursive; font-size: 0.85rem; color: #7a6a4a; flex-shrink: 0; }
        .add-sub-btn { font-family: 'Kalam', cursive; font-size: 0.8rem; color: #5a7a4a; background: none; border: 1px dashed #a8c8a8; padding: 0.25rem 0.6rem; cursor: pointer; border-radius: 3px; margin-top: 0.3rem; transition: all 0.15s; display: block; width: 100%; }
        .add-sub-btn:hover { background: #f0f8f0; }
        .add-point-btn { font-family: 'Cinzel', serif; font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #5a7a4a; background: #f0f8f0; border: 1px solid #a8c8a8; padding: 0.5rem 1rem; cursor: pointer; border-radius: 4px; transition: all 0.15s; width: 100%; }
        .add-point-btn:hover { background: #e0f0e0; }

        .preview-section { margin: 1rem 0; }
        .preview-label { font-family: 'Cinzel', serif; font-size: 0.5rem; letter-spacing: 0.15em; text-transform: uppercase; color: #7a6a4a; margin: 0 0 0.4rem; }

        .editor-footer { display: flex; gap: 0.6rem; margin-top: 1rem; }
        .save-btn { font-family: 'Cinzel', serif; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #fff; background: #5a7a4a; border: none; padding: 0.7rem 1.5rem; cursor: pointer; border-radius: 4px; flex: 1; transition: all 0.15s; }
        .save-btn:disabled { opacity: 0.3; }
        .save-btn:hover:not(:disabled) { background: #4a6a3a; }
        .cancel-btn { font-family: 'Cinzel', serif; font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: #7a6a4a; background: #e8e0cc; border: 1px solid #c8bfa8; padding: 0.7rem 1rem; cursor: pointer; border-radius: 4px; }

        .empty { text-align: center; padding: 2.5rem 1.5rem; font-family: 'Kalam', cursive; font-size: 1rem; color: #b4a888; line-height: 1.8; }
        .ef-input[as="textarea"] { resize: vertical; }

        /* Accent colors per subject */
        .accent-0 { --accent: #6ecece; } .accent-1 { --accent: #90d490; }
        .accent-2 { --accent: #f0c080; } .accent-3 { --accent: #d090c8; }
        .accent-4 { --accent: #90b8e0; } .accent-5 { --accent: #e09090; }
        .accent-6 { --accent: #a8c870; } .accent-7 { --accent: #c8a870; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
        .card-paper { animation: fadeIn 0.2s ease; }
      `}</style>

      {/* ── Header ── */}
      <div className="hdr">
        <div className="hdr-top">
          <div>
            <p className="hdr-title">Lernkarten</p>
            <p className="hdr-sub">{cards.length} {cards.length === 1 ? "Karte" : "Karten"} · {subjects.length} Fächer</p>
          </div>
          {view !== "home" && (
            <button className="back-btn" onClick={() => { setView(activeSubject ? "browse" : "home"); setEditingCard(null); }}>
              ← {view === "browse" ? "Fächer" : activeSubject || "Übersicht"}
            </button>
          )}
        </div>
      </div>

      {/* ── Home ── */}
      {view === "home" && (
        <div className="home-page">
          {cards.length === 0
            ? <p className="home-greeting">Willkommen! Wähle ein Fach und erstelle deine erste Karte. Eine Karte, wann immer du magst. 🌿</p>
            : <p className="home-greeting">Welches Fach lernst du heute?</p>
          }

          <div className="subject-grid">
            {subjects.map((sub, i) => {
              const count = subjectCards(sub).length;
              return (
                <div key={sub} className={`subject-card accent-${i % 8}`} style={{ "--accent": ["#6ecece","#90d490","#f0c080","#d090c8","#90b8e0","#e09090","#a8c870","#c8a870"][i % 8] }}
                  onClick={() => { setActiveSubject(sub); setBrowseIndex(0); setView("browse"); }}>
                  <p className="subject-name">{sub}</p>
                  <p className="subject-count">{count} {count === 1 ? "Karte" : "Karten"}</p>
                  <div className="subject-bar">
                    {Array.from({ length: Math.min(count, 8) }).map((_, j) => <div key={j} className="mini-card" />)}
                  </div>
                </div>
              );
            })}
          </div>

          {showAddSubject ? (
            <div className="add-subject-area">
              <input className="add-subj-input" value={newSubject} onChange={e => setNewSubject(e.target.value)}
                placeholder="Fachname..." autoFocus onKeyDown={e => e.key === "Enter" && addSubject()} />
              <button className="tiny-btn" onClick={addSubject}>Hinzufügen</button>
              <button className="tiny-btn ghost" onClick={() => { setShowAddSubject(false); setNewSubject(""); }}>✕</button>
            </div>
          ) : (
            <button className="add-mappe-btn" onClick={() => setShowAddSubject(true)}>+ Neue Mappe erstellen</button>
          )}
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
              <button className="browse-add-btn" style={{ margin: "0 auto", display: "block" }} onClick={() => startCreate()}>+ Erste Karte erstellen</button>
            </div>
          ) : (
            <>
              <div className="browse-nav">
                <button className="nav-btn" onClick={() => setBrowseIndex(i => Math.max(0, i - 1))} disabled={browseIndex === 0}>←</button>
                <span className="browse-counter">{browseIndex + 1} / {browsable.length} — {activeSubject}</span>
                <button className="nav-btn" onClick={() => setBrowseIndex(i => Math.min(browsable.length - 1, i + 1))} disabled={browseIndex === browsable.length - 1}>→</button>
              </div>

              <CardView
                card={browsable[browseIndex]}
                onEdit={() => startEdit(browsable[browseIndex])}
                onDelete={() => deleteCard(browsable[browseIndex].id)}
              />

              <div className="dot-row">
                {browsable.map((_, i) => (
                  <div key={i} className={`dot ${i === browseIndex ? "active" : ""}`} onClick={() => setBrowseIndex(i)} />
                ))}
              </div>

              <div className="browse-actions">
                <button className="browse-add-btn" onClick={() => startCreate()}>+ Neue Karte</button>
                <button className="browse-edit-btn" onClick={() => startEdit(browsable[browseIndex])}>Bearbeiten</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Create / Edit ── */}
      {(view === "create" || view === "edit") && editingCard && (
        <CardEditor
          card={editingCard}
          subjects={subjects}
          onSave={saveCard}
          onCancel={() => { setView(activeSubject ? "browse" : "home"); setEditingCard(null); }}
        />
      )}
    </div>
  );
}
