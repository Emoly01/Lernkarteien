// Firebase for cross-device sync. Loaded lazily (dynamic import) so the app starts
// without the SDK until sync is actually used.
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth,
  browserPopupRedirectResolver,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch,
} from "firebase/firestore";

// Shared project with Goldhort, Sturmauge, Command-Center and the Witchlight chronicle.
// The web config is public by design; access is controlled by Firestore security rules.
const PROD_HOST = "lernkarteien.vercel.app";
const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

const firebaseConfig = {
  apiKey: "AIzaSyDNgGC-3qksHbOWsKcEh50_5ZE6wH3n8aQ",
  // Everywhere: the normal Firebase login page, like Goldhort (no extra setup needed).
  // iPhone/iPad only: login runs through our own domain (vercel.json rewrites /__/auth to
  // Firebase), because Safari's storage isolation breaks the cross-domain redirect there.
  // That path additionally needs https://lernkarteien.vercel.app/__/auth/handler as an
  // authorized redirect URI of the OAuth client in the Google Cloud console.
  authDomain: ios && location.hostname === PROD_HOST ? PROD_HOST : "dnd-tools-1dd87.firebaseapp.com",
  projectId: "dnd-tools-1dd87",
  storageBucket: "dnd-tools-1dd87.appspot.com",
  messagingSenderId: "866582352851",
  appId: "1:866582352851:web:269ec8b40fc5764425d526",
};

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Popup like Goldhort; only the iPhone home-screen app can't return from a popup, so it redirects.

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (ios && standalone) return signInWithRedirect(auth, provider);
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
export const signOutUser = () => signOut(auth);
export const onUser = cb => onAuthStateChanged(auth, cb);
export const currentUser = () => auth.currentUser;
export const redirectResult = () => getRedirectResult(auth);

// Data lives next to Goldhort's under the user's own folder:
//   users/{uid}/lernkarten-cards/{cardId}   one document per card (deleted cards: { deleted, at })
//   users/{uid}/lernkarten/meta             decks, colours, exam date, settings
const cardsCol = uid => collection(db, "users", uid, "lernkarten-cards");
const metaDoc = uid => doc(db, "users", uid, "lernkarten", "meta");

export function watchCards(uid, cb, onError) {
  return onSnapshot(cardsCol(uid), { includeMetadataChanges: true },
    snap => cb(snap.docs.map(d => d.data()), snap.metadata), onError);
}
export function watchMeta(uid, cb, onError) {
  return onSnapshot(metaDoc(uid), { includeMetadataChanges: true },
    snap => cb(snap.exists() ? snap.data() : null, snap.metadata), onError);
}

// Firestore rejects `undefined`; JSON round-trip drops it like localStorage does.
const clean = o => JSON.parse(JSON.stringify(o));

// Applied to the local cache immediately; sent to the server now or once back online.
// The returned promise only settles when the server confirms, so callers don't wait on it.
export function writeChanges(uid, { cards = [], meta = null }) {
  const commits = [];
  for (let i = 0; i < cards.length || (i === 0 && meta); i += 450) {
    const batch = writeBatch(db);
    for (const c of cards.slice(i, i + 450)) batch.set(doc(cardsCol(uid), c.id), clean(c));
    if (i === 0 && meta) batch.set(metaDoc(uid), clean(meta));
    commits.push(batch.commit());
  }
  return Promise.all(commits);
}
