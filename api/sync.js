// POST /api/sync  { code, state }
//   state = null  → read only: returns the stored state, 404 if the code is unknown (used when joining)
//   state = {...} → merges it into the stored state and returns the result
// Each sync code maps to one private blob. The blob name is a hash of the code, so the
// store never reveals codes, and the code itself is the only credential.
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { createHash } from "node:crypto";
import { mergeStates, sanitizeState, normalizeCode, isValidCode, fingerprint } from "../src/sync.js";

const MAX_BYTES = 4_000_000;
const ATTEMPTS = 10;
const pause = attempt => new Promise(r => setTimeout(r, Math.random() * 40 * (attempt + 1)));

async function readStored(path) {
  const r = await get(path, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return { stored: null, etag: null };
  const text = await new Response(r.stream).text();
  let parsed = null;
  try { parsed = sanitizeState(JSON.parse(text)); } catch (e) {}
  return { stored: parsed, etag: r.blob.etag };
}

const isConflict = e => e instanceof BlobPreconditionFailedError || /already exists|precondition/i.test(e?.message || "");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST." });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return res.status(503).json({ error: "Sync ist auf dem Server noch nicht eingerichtet (Blob-Speicher fehlt)." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const code = normalizeCode(body?.code);
  if (!isValidCode(code)) return res.status(400).json({ error: "Ungültiger Sync-Code." });

  const incoming = body.state == null ? null : sanitizeState(body.state);
  if (body.state != null && !incoming) return res.status(400).json({ error: "Ungültige Daten." });

  const path = `sync/${createHash("sha256").update("lernkarten:" + code).digest("hex")}.json`;

  try {
    // Optimistic concurrency: if another device wrote in between, re-read and merge again.
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt) await pause(attempt);
      const { stored, etag } = await readStored(path);
      if (!incoming) {
        return stored ? res.status(200).json({ state: stored }) : res.status(404).json({ error: "Diesen Sync-Code gibt es nicht." });
      }
      const merged = mergeStates(stored, incoming);
      if (stored && fingerprint(merged) === fingerprint(stored)) return res.status(200).json({ state: stored });

      const json = JSON.stringify(merged);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: "Zu viele Daten für den Sync." });
      try {
        await put(path, json, {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: !!etag,
          ...(etag ? { ifMatch: etag } : {}),
        });
        return res.status(200).json({ state: merged });
      } catch (e) {
        if (!isConflict(e)) throw e;
      }
    }
    return res.status(409).json({ error: "Gerade viel los, bitte gleich nochmal." });
  } catch (e) {
    console.error("sync failed", e);
    return res.status(500).json({ error: "Sync-Server nicht erreichbar." });
  }
}
