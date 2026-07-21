import { config } from "dotenv";
config({ path: ".env.local" });
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "../lib/firebase/admin";
import { scoreAllProfiles } from "./score-engine";

// Cibles du couple (École 42 Paris 17e + UPEC Créteil).
const TARGETS = [
  { label: "UPEC", lat: 48.7906, lng: 2.4433, weight: 0.6, maxCommuteMin: 50, hard: true },
  { label: "42", lat: 48.8975, lng: 2.3235, weight: 0.4, maxCommuteMin: 50, hard: true },
];

async function main() {
  // uid = premier utilisateur Auth ; crée profiles/{uid} + le search_profile seedé si absents.
  const users = await getAuth().listUsers(1);
  if (!users.users.length) throw new Error("aucun utilisateur Auth — connecte-toi d'abord dans l'app");
  const uid = users.users[0].uid;
  console.log("uid:", uid, "|", users.users[0].email);
  await adminDb.collection("profiles").doc(uid).set(
    { email: users.users[0].email ?? null, createdAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await adminDb.collection("profiles").doc(uid).collection("search_profiles").doc("default").set(
    { name: "42 + UPEC", budgetMax: 1400, surfaceMin: 30, roomsMin: 1, furnished: null, arrondissements: null, targets: TARGETS, active: true },
    { merge: true }
  );

  const res = await scoreAllProfiles(Date.now());
  console.log(`\nScoring: ${res.profiles} recherche(s), ${res.listings} annonces, ${res.matches} matchs (filtres durs OK).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
