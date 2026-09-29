import { useState, useEffect, useRef, useCallback } from "react";
import { toSyncState, mergeStates, fingerprint, fromDocs, diffForServer } from "./sync.js";
import { applySyncState } from "./data.js";

// Remembers which Google account this device's cards belong to. Once linked, the device
// merges automatically; the first time, you choose whether to merge or take the cloud cards.
const LINK_KEY = "lernkarten-linked-uid";
const PENDING_KEY = "lernkarten-login-pending"; // set before a login redirect leaves the page
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};

function message(e) {
  const code = e?.code || "";
  if (code === "permission-denied") return "Keine Berechtigung – in Firestore fehlen noch die Regeln für Lernkarten.";
  if (code === "auth/unauthorized-domain") return "Diese Adresse ist in Firebase noch nicht für den Login freigegeben.";
  if (code === "auth/network-request-failed") return "Keine Verbindung – versuch es gleich nochmal.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  return e?.message || "Unbekannter Fehler beim Sync.";
}

// status: off | connecting | syncing | ok | offline | error
export function useCloudSync(data, setData) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(ls.get(LINK_KEY) || ls.get(PENDING_KEY) ? "connecting" : "off");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [choice, setChoice] = useState(null); // { remoteCards } while waiting for merge/replace
  const [decided, setDecided] = useState(false);

  const fb = useRef(null);
  const remote = useRef({ docs: new Map(), meta: null, cardsFromServer: false, metaFromServer: false, meta_: {}, cards_: {} });
  const unsubs = useRef([]);
  const decidedRef = useRef(false);
  decidedRef.current = decided;
  const dataRef = useRef(data);
  dataRef.current = data;
  const listening = useRef(false);

  const load = useCallback(async () => {
    if (!fb.current) fb.current = await import("./firebase.js");
    return fb.current;
  }, []);

  const remoteState = () => fromDocs([...remote.current.docs.values()], remote.current.meta);

  const applyRemote = useCallback(() => {
    const r = remoteState();
    if (!r) return;
    setData(prev => {
      const local = toSyncState(prev);
      const merged = mergeStates(local, r);
      return fingerprint(merged) === fingerprint(local) ? prev : applySyncState(prev, merged);
    });
  }, [setData]);

  const refreshStatus = useCallback(() => {
    const { cards_, meta_ } = remote.current;
    if (cards_.hasPendingWrites || meta_.hasPendingWrites) return setStatus("syncing");
    if (cards_.fromCache || meta_.fromCache) return setStatus(navigator.onLine ? "connecting" : "offline");
    setStatus("ok"); setLastSync(Date.now());
  }, []);

  // First time on this device for this account: decide once both lists have come from the server.
  const maybeDecide = useCallback(uid => {
    if (decidedRef.current) return;
    const r = remote.current;
    if (ls.get(LINK_KEY) === uid) { setDecided(true); return; }
    if (!r.cardsFromServer || !r.metaFromServer) return;
    const remoteCards = [...r.docs.values()].filter(d => !d.deleted).length;
    const cloudEmpty = remoteCards === 0 && !r.meta;
    if (cloudEmpty || dataRef.current.cards.length === 0) { ls.set(LINK_KEY, uid); setDecided(true); return; }
    setChoice({ remoteCards });
  }, []);

  const stop = () => { unsubs.current.forEach(u => u()); unsubs.current = []; };

  const start = useCallback(async u => {
    const f = await load();
    stop();
    remote.current = { docs: new Map(), meta: null, cardsFromServer: false, metaFromServer: false, meta_: {}, cards_: {} };
    const onError = e => { setStatus("error"); setError(message(e)); };
    unsubs.current.push(f.watchCards(u.uid, (docs, meta) => {
      const r = remote.current;
      r.docs = new Map(docs.map(d => [d.id, d])); r.cards_ = meta;
      if (!meta.fromCache) r.cardsFromServer = true;
      maybeDecide(u.uid);
      if (decidedRef.current) applyRemote();
      refreshStatus();
    }, onError));
    unsubs.current.push(f.watchMeta(u.uid, (m, meta) => {
      const r = remote.current;
      r.meta = m; r.meta_ = meta;
      if (!meta.fromCache) r.metaFromServer = true;
      maybeDecide(u.uid);
      if (decidedRef.current) applyRemote();
      refreshStatus();
    }, onError));
  }, [load, applyRemote, refreshStatus, maybeDecide]);

  const listen = useCallback(f => {
    if (listening.current) return;
    listening.current = true;
    f.onUser(u => {
      setUser(u);
      if (u) start(u);
      else { stop(); setStatus(ls.get(PENDING_KEY) ? "connecting" : "off"); }
    });
  }, [start]);

  // Boot Firebase only if this device was signed in before (or is coming back from a login redirect).
  useEffect(() => {
    if (!ls.get(LINK_KEY) && !ls.get(PENDING_KEY)) return;
    load().then(f => {
      f.redirectResult().catch(e => { const m = message(e); if (m) { setError(m); setStatus("error"); } })
        .finally(() => { ls.set(PENDING_KEY, null); if (!f.currentUser()) setStatus(s => (s === "connecting" ? "off" : s)); });
      listen(f);
    });
    return () => stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once decided: merge what's in the cloud, then keep pushing local changes.
  useEffect(() => { if (decided) { applyRemote(); if (user) ls.set(LINK_KEY, user.uid); } }, [decided]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!decided || !user || !fb.current) return;
    const t = setTimeout(() => {
      const r = remote.current;
      const diff = diffForServer(toSyncState(data), [...r.docs.values()], r.meta);
      if (!diff.cards.length && !diff.meta) return;
      // Optimistic: treat these as on the server so we don't send them twice before the snapshot arrives.
      for (const c of diff.cards) r.docs.set(c.id, c);
      if (diff.meta) r.meta = diff.meta;
      setStatus("syncing");
      fb.current.writeChanges(user.uid, diff).catch(e => { setStatus("error"); setError(message(e)); });
    }, 400);
    return () => clearTimeout(t);
  }, [data, decided, user]);

  useEffect(() => {
    const on = () => refreshStatus();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, [refreshStatus]);

  const signIn = useCallback(async () => {
    setError(""); setStatus("connecting");
    ls.set(PENDING_KEY, "1");
    try {
      const f = await load();
      listen(f);
      await f.signIn(); // on phones this navigates away and comes back signed in
    } catch (e) {
      ls.set(PENDING_KEY, null);
      const m = message(e); setError(m); setStatus(m ? "error" : "off");
    }
  }, [load, listen]);

  const resolveChoice = useCallback(mode => {
    if (mode === "replace") {
      const r = remoteState();
      setData(prev => applySyncState(prev, r));
    }
    if (user) ls.set(LINK_KEY, user.uid);
    setChoice(null); setDecided(true);
  }, [setData, user]);

  const signOut = useCallback(async () => {
    stop(); ls.set(LINK_KEY, null); ls.set(PENDING_KEY, null);
    setDecided(false); setChoice(null); setUser(null); setStatus("off"); setError("");
    try { await fb.current?.signOutUser(); } catch (e) {}
  }, []);

  return { user, status, error, lastSync, choice, signIn, signOut, resolveChoice };
}
