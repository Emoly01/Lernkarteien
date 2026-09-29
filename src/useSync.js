import { useState, useEffect, useRef, useCallback } from "react";
import { toSyncState, mergeStates, fingerprint, newCode, normalizeCode, isValidCode } from "./sync.js";
import { applySyncState } from "./data.js";

const CODE_KEY = "lernkarten-sync-code";
const POLL_MS = 2 * 60 * 1000;
const DEBOUNCE_MS = 1500;

const readCode = () => { try { return localStorage.getItem(CODE_KEY); } catch (e) { return null; } };
const writeCode = c => { try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch (e) {} };

async function callServer(code, state) {
  let res;
  try {
    res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, state }) });
  } catch (e) {
    const err = new Error("Offline – wird synchronisiert, sobald du wieder Netz hast."); err.offline = true; throw err;
  }
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error(body?.error || `Sync-Fehler (${res.status})`); err.status = res.status; throw err; }
  return body.state;
}

// Keeps `data` in sync with the server whenever a sync code is set on this device.
// status: off | syncing | ok | offline | error
export function useSync(data, setData) {
  const [code, setCode] = useState(readCode);
  const [status, setStatus] = useState(code ? "syncing" : "off");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(null);

  const dataRef = useRef(data);
  dataRef.current = data;
  const codeRef = useRef(code);
  codeRef.current = code;
  const synced = useRef(null);   // fingerprint of what the server last confirmed
  const running = useRef(false);
  const queued = useRef(false);
  const retryTimer = useRef(null);
  const failures = useRef(0);

  // Merge the server's state into whatever is local *now* (the user may have typed meanwhile).
  const applyRemote = useCallback(remote => {
    synced.current = fingerprint(remote);
    setData(prev => {
      const local = toSyncState(prev);
      const merged = mergeStates(local, remote);
      return fingerprint(merged) === fingerprint(local) ? prev : applySyncState(prev, merged);
    });
  }, [setData]);

  const sync = useCallback(async () => {
    const c = codeRef.current;
    if (!c) return;
    if (running.current) { queued.current = true; return; }
    running.current = true;
    setStatus("syncing");
    try {
      const remote = await callServer(c, toSyncState(dataRef.current));
      if (codeRef.current !== c) return; // sync was switched off meanwhile
      applyRemote(remote);
      setStatus("ok"); setError(""); setLastSync(Date.now());
      failures.current = 0;
    } catch (e) {
      setStatus(e.offline ? "offline" : "error"); setError(e.message);
      // Busy server or a hiccup: try again soon (5 s, 15 s, 45 s, then every 2 min). Offline waits for "online".
      if (!e.offline && e.status !== 400 && e.status !== 413) {
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(sync, Math.min(5000 * 3 ** failures.current++, POLL_MS));
      }
    } finally {
      running.current = false;
      if (queued.current) { queued.current = false; sync(); }
    }
  }, [applyRemote]);

  // Local change → sync shortly after (debounced), but not for changes that came from the server.
  useEffect(() => {
    if (!code || fingerprint(toSyncState(data)) === synced.current) return;
    const t = setTimeout(sync, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [data, code, sync]);

  // Coming back to the app, getting signal back, and a slow poll while it's open.
  useEffect(() => {
    if (!code) return;
    sync();
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    const poll = setInterval(() => { if (document.visibilityState === "visible") sync(); }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      clearInterval(poll);
    };
  }, [code, sync]);

  // First device: create a code and upload everything.
  const create = useCallback(async () => {
    const c = newCode();
    setStatus("syncing");
    try {
      const remote = await callServer(c, toSyncState(dataRef.current));
      writeCode(c); setCode(c); applyRemote(remote);
      setStatus("ok"); setError(""); setLastSync(Date.now());
      return c;
    } catch (e) {
      setStatus("off"); setError(e.message); throw e;
    }
  }, [applyRemote]);

  // Other device, step 1: check the code and see what's stored (nothing is changed yet).
  const peek = useCallback(async typed => {
    const c = normalizeCode(typed);
    if (!isValidCode(c)) throw new Error("Der Code hat 20 Zeichen, z. B. ABCD-EFGH-JKLM-NPQR-STUV.");
    const remote = await callServer(c, null);
    return { code: c, remote };
  }, []);

  // Other device, step 2: "merge" keeps this device's cards too, "replace" takes only the synced ones.
  const join = useCallback(async (c, remote, mode) => {
    if (mode === "replace") {
      synced.current = fingerprint(remote);
      setData(prev => applySyncState(prev, remote));
    }
    writeCode(c); setCode(c); codeRef.current = c;
    if (mode !== "replace") await sync();
    else { setStatus("ok"); setError(""); setLastSync(Date.now()); }
  }, [setData, sync]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const leave = useCallback(() => {
    clearTimeout(retryTimer.current);
    writeCode(null); setCode(null); synced.current = null; setStatus("off"); setError("");
  }, []);

  return { code, status, error, lastSync, sync, create, peek, join, leave };
}
