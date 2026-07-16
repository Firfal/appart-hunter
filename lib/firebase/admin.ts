// Firebase Admin SDK (serveur uniquement : API routes, collecteurs, scoring).
// Bypasse les security rules → utilisé pour écrire le pool partagé (listings, matches...).
import "server-only";
import { initializeApp, getApps, getApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function adminApp(): App {
  if (getApps().length) return getApp();
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // La clé privée arrive avec des \n échappés dans les env vars → on les restaure.
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const adminDb = getFirestore(adminApp());
