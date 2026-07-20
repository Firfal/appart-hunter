// Firebase Admin SDK (serveur uniquement : API routes, collecteurs, scoring).
// Bypasse les security rules → utilisé pour écrire le pool partagé (listings, matches...).
// NB : à n'importer QUE côté serveur (API routes, scripts) — jamais dans un composant client.
import { initializeApp, getApps, getApp, cert, applicationDefault, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function adminApp(): App {
  if (getApps().length) return getApp();
  // En local : clé de service explicite via .env.local.
  // En prod (App Hosting / Cloud Run) : Application Default Credentials automatiques.
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // La clé privée arrive avec des \n échappés dans les env vars → on les restaure.
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }
  return initializeApp({ credential: applicationDefault() });
}

export const adminDb = getFirestore(adminApp());
