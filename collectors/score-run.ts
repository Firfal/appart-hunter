import { config } from "dotenv";
config({ path: ".env.local" });
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "../lib/firebase/admin";
import { getCommute } from "../lib/commute";
import { scoreListing, type Target, type SearchCriteria } from "../lib/scoring";

// Cibles du couple (École 42 Paris 17e + UPEC Créteil).
const TARGETS: (Target & { lat: number; lng: number })[] = [
  { label: "UPEC", lat: 48.7906, lng: 2.4433, weight: 0.6, maxCommuteMin: 50, hard: true },
  { label: "42", lat: 48.8975, lng: 2.3235, weight: 0.4, maxCommuteMin: 50, hard: true },
];

const CRITERIA: SearchCriteria = {
  budgetMax: 1400,
  surfaceMin: 30,
  roomsMin: 1,
  furnished: null,
  arrondissements: null,
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const now = Date.now();
  // uid = premier utilisateur Auth (le compte créé en P0). Crée le doc profiles si absent.
  const users = await getAuth().listUsers(1);
  if (!users.users.length) throw new Error("aucun utilisateur Auth — connecte-toi d'abord dans l'app");
  const uid = users.users[0].uid;
  console.log("uid:", uid, "|", users.users[0].email);
  await adminDb.collection("profiles").doc(uid).set(
    { email: users.users[0].email ?? null, createdAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  // Seed du search_profile (idempotent).
  const spRef = adminDb.collection("profiles").doc(uid).collection("search_profiles").doc("default");
  await spRef.set({ name: "42 + UPEC", ...CRITERIA, targets: TARGETS, active: true }, { merge: true });

  // Listings (limités pour le test).
  const snap = await adminDb.collection("listings").where("isActive", "==", true).limit(40).get();
  const listings = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

  // Médiane €/m² par arrondissement.
  const byArr: Record<number, number[]> = {};
  for (const l of listings) {
    const p = l.priceTotal as number | null, s = l.surface as number | null, a = l.arrondissement as number | null;
    if (p && s && a) (byArr[a] ??= []).push(p / s);
  }
  const medByArr: Record<number, number | null> = {};
  for (const a of Object.keys(byArr)) medByArr[+a] = median(byArr[+a]);

  let kept = 0;
  const batch = adminDb.batch();
  const rows: { score: number; line: string }[] = [];

  for (const l of listings) {
    const lat = (l.geo as { latitude?: number })?.latitude;
    const lng = (l.geo as { longitude?: number })?.longitude;
    const commuteByTarget: Record<string, number | null> = {};
    if (lat != null && lng != null) {
      for (const t of TARGETS) {
        const r = await getCommute(l.id, lat, lng, t.lat, t.lng, now);
        commuteByTarget[t.label] = r?.durationMin ?? null;
      }
    } else {
      for (const t of TARGETS) commuteByTarget[t.label] = null;
    }

    const arr = l.arrondissement as number | null;
    const res = scoreListing({
      listing: {
        priceTotal: (l.priceTotal as number) ?? null,
        surface: (l.surface as number) ?? null,
        rooms: (l.rooms as number) ?? null,
        furnished: (l.furnished as boolean) ?? null,
        dpe: (l.dpe as string) ?? null,
        arrondissement: arr,
        firstSeenMs: (l.firstSeenAt as { toMillis?: () => number })?.toMillis?.() ?? null,
      },
      criteria: CRITERIA,
      targets: TARGETS,
      commuteByTarget,
      medianPpm2: arr != null ? medByArr[arr] ?? null : null,
      fraudFlags: [],
      nowMs: now,
    });

    const mRef = spRef.collection("matches").doc(l.id);
    batch.set(mRef, {
      listingId: l.id,
      score: res.score,
      passesHard: res.passesHard,
      reason: res.reason ?? null,
      commute: commuteByTarget,
      pricePerM2: res.pricePerM2,
      priceGapPct: res.priceGapPct,
      breakdown: res.breakdown,
      // Champs d'affichage dénormalisés (le feed lit les matches en une requête).
      url: l.url ?? null,
      source: l.source ?? null,
      priceTotal: (l.priceTotal as number) ?? null,
      surface: (l.surface as number) ?? null,
      rooms: (l.rooms as number) ?? null,
      furnished: (l.furnished as boolean) ?? null,
      dpe: (l.dpe as string) ?? null,
      arrondissement: arr,
      thumbUrl: (l.thumbUrl as string) ?? null,
      isPro: (l.isPro as boolean) ?? null,
      computedAt: FieldValue.serverTimestamp(),
    });

    if (res.passesHard) {
      kept++;
      rows.push({
        score: res.score,
        line: `  ${res.score.toFixed(0)} | UPEC ${commuteByTarget.UPEC ?? "?"}min · 42 ${commuteByTarget["42"] ?? "?"}min | ` +
          `${l.surface}m² ${l.priceTotal}€ P${arr} | trajet ${res.breakdown.trajet} prix ${res.breakdown.prix} frais ${res.breakdown.fraicheur}`,
      });
    }
  }
  await batch.commit();

  console.log(`\n${listings.length} annonces évaluées, ${kept} passent les filtres durs (trajet ≤50min des deux côtés).`);
  rows.sort((a, b) => b.score - a.score).slice(0, 10).forEach((r) => console.log(r.line));
}

main().catch((e) => { console.error(e); process.exit(1); });
