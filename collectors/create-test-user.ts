import { config } from "dotenv";
config({ path: ".env.local" });
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";
import { scoreAllProfiles } from "./score-engine";

const EMAIL = "test@apparthunter.dev";
const PASSWORD = "TestPass123!";
const TARGETS = [
  { label: "UPEC", lat: 48.7906, lng: 2.4433, weight: 0.6, maxCommuteMin: 50, hard: true },
  { label: "42", lat: 48.8975, lng: 2.3235, weight: 0.4, maxCommuteMin: 50, hard: true },
];

async function main() {
  const auth = getAuth();
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(EMAIL)).uid;
  } catch {
    uid = (await auth.createUser({ email: EMAIL, password: PASSWORD })).uid;
  }
  console.log("test user uid:", uid, EMAIL, PASSWORD);

  await adminDb.collection("profiles").doc(uid).set({ email: EMAIL, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await adminDb.collection("profiles").doc(uid).collection("search_profiles").doc("default").set(
    { name: "42 + UPEC", budgetMax: 1400, surfaceMin: 30, roomsMin: 1, furnished: null, arrondissements: null, targets: TARGETS, active: true },
    { merge: true }
  );

  const res = await scoreAllProfiles(Date.now());
  console.log("scoring:", JSON.stringify(res));
}
main().catch((e) => { console.error(e); process.exit(1); });
