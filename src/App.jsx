import { useState, useEffect, useRef } from "react";
import { ACC, STATUS, LEVELS, mid, L, plural, load, persist, mapLines } from "./data.js";
import "./styles.css";

// ── Settings (were design-tool toggles in the prototype) ─────
const STUDY_ONLY = false;          // hides all editing UI
const POINT_BY_POINT = false;      // reveal back side one Hauptpunkt at a time
const SHUFFLE = true;              // shuffle study queue
const TITLE_TURQUOISE = false;     // true = every title bar turquoise, false = subject colour

// ── Card lines (read-only) ───────────────────────────────────
function Lines({ lines }) {
  return lines.map(ln => {
    if (ln.hidden) return <div key={ln.key} className="ln-ghost" style={{ paddingLeft: ln.pad }}><div style={{ width: ln.ghostW + "%" }} /></div>;
    if (ln.level === 0) return <div key={ln.key} className="ln"><span className="ln-bullet">•</span><span className="ln-0-text">{ln.text}</span></div>;
    if (ln.level === 1) return <div key={ln.key} className="ln ln-1"><span className="ln-1-mark">×</span><span className="ln-1-text">{ln.text}</span></div>;
    return <div key={ln.key} className="ln ln-2"><span className="ln-2-mark">—</span><span className="ln-2-text"><b>{ln.label}</b>{ln.rest}</span></div>;
  });
}

export default function App() {
  const [data, setData] = useState(load);
  const { subjects, cards } = data;
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

  const drag = useRef(null);
  const pendingFocus = useRef(null);
  const handlers = useRef({});

  useEffect(() => { persist(data); }, [data]);

  useEffect(() => {
    if (pendingFocus.current == null) return;
    const el = document.querySelector(`[data-line-idx="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) {} }
  });

  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  // ── Helpers ──
  const accent = (subject) => { const i = subjects.indexOf(subject); return ACC[(i < 0 ? 0 : i) % ACC.length]; };
  const titleColor = (subject) => (TITLE_TURQUOISE ? "#6ecece" : accent(subject));
  const dCards = deck ? cards.filter(c => c.subject === deck) : [];
  const weak = dCards.filter(c => c.status !== "sicher");
  const studyCard = cards.find(c => c.id === queue[qPos]);
  const groups = (card) => (card ? card.lines.filter(l => l.level === 0 && l.text.trim()).length : 0);
  const canRate = flipped && (!POINT_BY_POINT || reveal >= groups(studyCard));

  // ── Study ──
  const startStudy = (ids) => {
    if (!ids.length) return;
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
    setData(d => ({ ...d, cards: d.cards.map(c => c.id === card.id ? { ...c, status: kind === "sicher" ? "sicher" : "unsicher" } : c) }));
    const q = kind === "nochmal" ? [...queue, card.id] : queue;
    const next = qPos + 1;
    setQueue(q); setQPos(next);
    setTally(t => ({ ...t, [kind]: t[kind] + 1 }));
    setFlipped(false); setReveal(0); setNoAnim(true);
    setView(next >= q.length ? "done" : "study");
    setTimeout(() => setNoAnim(false), 40);
  };
  handlers.current = { view, tap, rate, canRate };

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
    setDraft(d); setReturnTo(back); setFocusIdx(0); setView("edit");
  };
  const newCard = () => openEditor({ id: mid(), subject: deck || subjects[0], title: "", status: "neu", lines: [] }, "deck");
  const setLines = (fn, focus) => {
    const lines = fn(draft.lines.slice());
    if (focus != null) { pendingFocus.current = focus; setFocusIdx(focus); }
    setDraft({ ...draft, lines });
  };
  const maxLevel = (lines, i) => (i === 0 ? 0 : Math.min(2, lines[i - 1].level + 1));
  const shift = (i, delta) => setLines(ls => {
    const lvl = Math.max(0, Math.min(maxLevel(ls, i), ls[i].level + delta));
    ls[i] = { ...ls[i], level: lvl };
    for (let j = i + 1; j < ls.length && ls[j].level > lvl + 1; j++) ls[j] = { ...ls[j], level: lvl + 1 };
    return ls;
  }, i);
  const lineKey = (i, e) => {
    const ls = draft.lines, ln = ls[i];
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
  const saveDraft = () => {
    const clean = { ...draft, title: draft.title.trim(), lines: draft.lines.filter(l => l.text.trim()) };
    const exists = cards.some(c => c.id === draft.id);
    const next = exists ? cards.map(c => c.id === draft.id ? clean : c) : [...cards, clean];
    setData(d => ({ ...d, cards: next }));
    setDeck(clean.subject);
    setCardIdx(Math.max(0, next.filter(c => c.subject === clean.subject).findIndex(c => c.id === clean.id)));
    setDraft(null); setView("card");
  };
  const deleteCard = () => {
    if (!window.confirm("Diese Karte löschen?")) return;
    setData(d => ({ ...d, cards: d.cards.filter(c => c.id !== draft.id) }));
    setDraft(null); setCardIdx(0); setView("deck");
  };

  // ── Subjects ──
  const addSubject = () => {
    const n = newSubject.trim();
    if (!n || subjects.includes(n)) return;
    setData(d => ({ ...d, subjects: [...d.subjects, n] }));
    setNewSubject(""); setAddingSubject(false);
  };
  const cancelSubject = () => { setAddingSubject(false); setNewSubject(""); };

  const goBack = () => {
    if (view === "deck") return setView("home");
    if (view === "edit") { setDraft(null); return setView(returnTo); }
    setView("deck");
  };

  // ── Header ──
  const cIdx = Math.min(cardIdx, dCards.length - 1);
  const counterText = view === "study" ? `${qPos + 1} / ${queue.length}` : view === "card" ? `${cIdx + 1} / ${dCards.length}` : "";
  const header = (
    <div className="hdr">
      <div className="hdr-inner">
        {view !== "home" && (
          <button className="back-btn" onClick={goBack}>
            <span className="back-arrow">‹</span>
            <span className="back-label">{view === "deck" ? "Mappen" : deck || "Zurück"}</span>
          </button>
        )}
        {view === "home" && (
          <div className="logo">
            <div className="logo-icon"><div className="logo-back" /><div className="logo-front"><div /></div></div>
            <span className="logo-text">Lernkarten</span>
          </div>
        )}
        <div className="spacer" />
        {view === "deck" && !STUDY_ONLY && <button className="pill-btn" onClick={newCard}>+ Karte</button>}
        {(view === "study" || view === "card") && <span className="counter">{counterText}</span>}
      </div>
      {view === "study" && <div className="progress"><div style={{ width: (qPos / queue.length * 100) + "%" }} /></div>}
    </div>
  );

  const learnWeakBtn = (cls) => weak.length > 0 && (
    <button className={cls} onClick={() => startStudy(weak.map(c => c.id))}>Nur unsichere &amp; neue ({weak.length})</button>
  );

  // ── Screens ──
  let screen = null;

  if (view === "home") {
    const total = cards.length, unsure = cards.filter(c => c.status === "unsicher").length;
    screen = (
      <div className="screen home">
        <div className="home-head">
          <h1>Welches Fach lernst du heute?</h1>
          <p className="muted">{total ? `${plural(total, "Karte", "Karten")} · ${unsure} noch unsicher` : "Leg eine Mappe an und schreib deine erste Karte."}</p>
        </div>
        <div className="deck-list">
          {subjects.map((name, i) => {
            const cs = cards.filter(c => c.subject === name), n = cs.length;
            const sure = cs.filter(c => c.status === "sicher").length, uns = cs.filter(c => c.status === "unsicher").length;
            return (
              <div key={name} className="deck-row">
                <button className="deck-open" onClick={() => { setDeck(name); setView("deck"); }}>
                  <div className="deck-icon">
                    <div className="deck-icon-back" />
                    <div className="deck-icon-front"><div className="strip" style={{ background: ACC[i % ACC.length] }} /><div className="il" /><div className="il" /><div className="il" /></div>
                  </div>
                  <div className="deck-info">
                    <span className="deck-name">{name}</span>
                    <span className="deck-meta">{n ? `${plural(n, "Karte", "Karten")} · ${sure} sicher` : "Noch leer"}</span>
                    {n > 0 && (
                      <div className="deck-bar">
                        <div style={{ background: "#5a7a4a", width: (sure / n * 100) + "%" }} />
                        <div style={{ background: "#e0a94a", width: (uns / n * 100) + "%" }} />
                      </div>
                    )}
                  </div>
                </button>
                {n > 0 && (
                  <div className="deck-learn-wrap">
                    <button className="btn-primary deck-learn" onClick={() => { setDeck(name); startStudy(cs.map(c => c.id)); }}>Lernen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {addingSubject && (
          <div className="add-row">
            <input className="add-input" value={newSubject} autoFocus placeholder="Name der Mappe"
              onChange={e => setNewSubject(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addSubject(); if (e.key === "Escape") cancelSubject(); }} />
            <button className="btn-primary add-ok" onClick={addSubject}>Anlegen</button>
            <button className="add-x" onClick={cancelSubject}>×</button>
          </div>
        )}
        {!addingSubject && !STUDY_ONLY && <button className="new-deck" onClick={() => setAddingSubject(true)}>+ Neue Mappe</button>}
      </div>
    );
  }

  if (view === "deck") {
    const sure = dCards.filter(c => c.status === "sicher").length;
    screen = (
      <div className="screen deck">
        <div className="deck-head">
          <div className="deck-swatch" style={{ background: accent(deck) }} />
          <h1>{deck}</h1>
          <p className="muted">{dCards.length ? `${plural(dCards.length, "Karte", "Karten")} · ${sure} sicher · ${dCards.length - sure} offen` : "Noch keine Karten"}</p>
        </div>
        {dCards.length > 0 ? (
          <>
            <div className="stack10">
              <button className="btn-primary h56 learn-all" onClick={() => startStudy(dCards.map(c => c.id))}>Alle lernen · {plural(dCards.length, "Karte", "Karten")}</button>
              {learnWeakBtn("btn-secondary h48")}
            </div>
            <div className="stack10">
              <span className="section-label">Karten</span>
              {dCards.map((c, i) => {
                const [label, color] = STATUS[c.status || "neu"];
                return (
                  <button key={c.id} className="card-row" onClick={() => { setCardIdx(i); setView("card"); }}>
                    <div className="card-row-accent" style={{ background: titleColor(c.subject) }} />
                    <div className="card-row-body">
                      <span className="card-row-title">{c.title}</span>
                      <span className="card-row-preview">{c.lines.filter(l => l.level === 0).map(l => l.text).join(" · ") || "leer"}</span>
                    </div>
                    <div className="card-row-status"><span className="dot" style={{ background: color }} />{label}</div>
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
        <div className="paper">
          <div className="paper-title" style={{ background: titleColor(c.subject) }}>{c.title}</div>
          <div className="paper-body" style={{ minHeight: 220 }}><Lines lines={mapLines(c.lines)} /></div>
        </div>
        <div className="spacer" />
        <div className="bottom-bar bottom-row">
          <button className="btn-secondary nav-arrow" disabled={cIdx === 0} onClick={() => setCardIdx(Math.max(0, cIdx - 1))}>‹</button>
          {!STUDY_ONLY && <button className="btn-secondary h52 spacer" onClick={() => openEditor(c, "card")}>Bearbeiten</button>}
          {STUDY_ONLY && <button className="btn-primary h52 spacer" onClick={() => startStudy(dCards.map(x => x.id))}>Mappe lernen</button>}
          <button className="btn-secondary nav-arrow" disabled={cIdx === dCards.length - 1} onClick={() => setCardIdx(Math.min(dCards.length - 1, cIdx + 1))}>›</button>
        </div>
      </div>
    );
  }

  if (view === "study" && studyCard) {
    const c = studyCard, g = groups(c), acc = titleColor(c.subject);
    screen = (
      <div className="screen study">
        <div className="flip-wrap" onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pCancel}
          style={{ transition: dragging ? "none" : "transform .25s ease", transform: `translateX(${dx}px) rotate(${dx / 22}deg)` }}>
          <div className="stamp stamp-sure" style={{ opacity: Math.max(0, Math.min(1, dx / 110)) }}>SICHER</div>
          <div className="stamp stamp-again" style={{ opacity: Math.max(0, Math.min(1, -dx / 110)) }}>NOCHMAL</div>
          <div className="flipper" style={{ transition: noAnim ? "none" : "transform .55s cubic-bezier(.2,.7,.2,1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="face face-front">
              <div className="face-strip" style={{ background: acc }} />
              <div className="face-subject">{c.subject}</div>
              <div className="face-title">{c.title}</div>
              <div className="face-hint">{plural(g, "Hauptpunkt", "Hauptpunkte")} — was weißt du dazu? Tippen zum Umdrehen.</div>
            </div>
            <div className="face face-back">
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
              <div className="rate-grid">
                <button className="rate rate-again" onClick={() => rate("nochmal")}>Nochmal<small>kommt gleich wieder</small></button>
                <button className="rate rate-unsure" onClick={() => rate("unsicher")}>Unsicher<small>fast gewusst</small></button>
                <button className="rate rate-sure" onClick={() => rate("sicher")}>Sicher<small>gewusst</small></button>
              </div>
              <p className="swipe-hint">oder Karte wischen: ← Nochmal · Sicher →</p>
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
        <p>{plural(n, "Karte", "Karten")} aus {deck} durchgearbeitet.</p>
        <div className="tally">
          <div><b style={{ color: "#5a7a4a" }}>{tally.sicher}</b><span>sicher</span></div>
          <div><b style={{ color: "#a8741e" }}>{tally.unsicher}</b><span>unsicher</span></div>
          <div><b style={{ color: "#a4482e" }}>{tally.nochmal}</b><span>wiederholt</span></div>
        </div>
        <div className="stack10" style={{ width: "100%" }}>
          {learnWeakBtn("btn-primary h56")}
          <button className="btn-secondary h52" onClick={() => setView("deck")}>Zurück zur Mappe</button>
        </div>
      </div>
    );
  }

  if (view === "edit" && draft) {
    const ls = draft.lines, fi = Math.min(focusIdx, ls.length - 1), fl = ls[fi];
    const placeholders = ["Hauptpunkt", "Unterpunkt", "Begriff: Detail; Detail"];
    const marks = ["•", "×", "—"];
    screen = (
      <div className="screen editor">
        <div className="chips">
          {subjects.map((name, i) => (
            <button key={name} className={"chip" + (draft.subject === name ? " sel" : "")} onClick={() => setDraft({ ...draft, subject: name })}>
              <span className="dot" style={{ background: ACC[i % ACC.length] }} />{name}
            </button>
          ))}
        </div>
        <div className="paper">
          <div className="e-title-bar" style={{ background: titleColor(draft.subject) }}>
            <input className="e-title" value={draft.title} placeholder="Titel der Karte"
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); pendingFocus.current = 0; setFocusIdx(0); } }} />
          </div>
          <div className="e-body">
            {ls.map((l, i) => (
              <div key={l.id} className={`e-ln e-ln-${l.level}`}>
                <span className="e-mark">{marks[l.level]}</span>
                <input data-line-idx={i} value={l.text} placeholder={placeholders[l.level]}
                  onChange={e => { const t = e.target.value; setLines(x => { x[i] = { ...x[i], text: t }; return x; }); }}
                  onKeyDown={e => lineKey(i, e)}
                  onFocus={() => { if (focusIdx !== i) setFocusIdx(i); }} />
              </div>
            ))}
          </div>
        </div>
        <p className="e-help">Enter = neue Zeile · Tab / ⇧Tab = ein- und ausrücken · Leere Zeile + ⌫ = löschen</p>
        {cards.some(c => c.id === draft.id) && <button className="e-delete" onClick={deleteCard}>Karte löschen</button>}
        <div className="spacer" />
        <div className="e-footer">
          <div className="toolbar">
            <button className="tool" disabled={!fl || fl.level === 0} onMouseDown={e => { e.preventDefault(); shift(fi, -1); }}>⇤ Aus</button>
            <button className="tool" disabled={!fl || fl.level >= maxLevel(ls, fi)} onMouseDown={e => { e.preventDefault(); shift(fi, 1); }}>Ein ⇥</button>
            <span className="tool-level">{fl ? `Zeile ${fi + 1}: ${LEVELS[fl.level]}` : ""}</span>
            <button className="tool" onMouseDown={e => { e.preventDefault(); setLines(x => { x.splice(fi + 1, 0, L(fl ? fl.level : 0, "")); return x; }, fi + 1); }}>+ Zeile</button>
          </div>
          <div className="bottom-row">
            <button className="btn-secondary h52 cancel" onClick={() => { setDraft(null); setView(returnTo); }}>Abbrechen</button>
            <button className="btn-primary h52 spacer" disabled={!draft.title.trim() || !draft.subject} onClick={saveDraft}>Karte speichern</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {header}
      <div className="main">{screen}</div>
    </div>
  );
}
