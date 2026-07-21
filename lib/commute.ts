import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebase/admin";

const BASE = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys";
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours

export type CommuteResult = { durationMin: number; transfers: number } | null;

/** Hash de la cible (géo arrondie) → cache partagé entre profils visant le même lieu. */
export function targetHash(lat: number, lng: number): string {
  return `${lat.toFixed(3)}_${lng.toFixed(3)}`;
}

/** Prochain mardi 09:00 (heure de pointe stable et comparable entre annonces). */
function peakDatetime(now: Date): string {
  const d = new Date(now);
  const delta = ((2 - d.getDay() + 7) % 7) || 7; // prochain mardi (jamais aujourd'hui)
  d.setDate(d.getDate() + delta);
  d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T090000`;
}

async function callPrim(fromLat: number, fromLng: number, toLat: number, toLng: number, now: Date): Promise<CommuteResult> {
  const key = process.env.PRIM_API_KEY;
  if (!key) throw new Error("PRIM_API_KEY manquant");
  const url = `${BASE}?from=${fromLng};${fromLat}&to=${toLng};${toLat}&datetime=${peakDatetime(now)}`;
  const res = await fetch(url, { headers: { apikey: key, Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const j = data.journeys?.[0];
  if (!j || typeof j.duration !== "number") return null;
  return { durationMin: Math.round(j.duration / 60), transfers: j.nb_transfers ?? 0 };
}

/**
 * Temps de trajet transit (annonce → cible), avec cache Firestore `commute_times`.
 * @param nowMs date de référence (injectée pour testabilité)
 */
export async function getCommute(
  listingId: string,
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  nowMs: number
): Promise<CommuteResult> {
  const cacheId = `${listingId}_${targetHash(toLat, toLng)}`;
  const ref = adminDb.collection("commute_times").doc(cacheId);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data()!;
    const computedMs = d.computedAt?.toMillis?.() ?? 0;
    if (nowMs - computedMs < CACHE_TTL_MS) {
      return d.durationMin == null ? null : { durationMin: d.durationMin, transfers: d.transfers ?? 0 };
    }
  }
  const result = await callPrim(fromLat, fromLng, toLat, toLng, new Date(nowMs));
  await ref.set({
    listingId,
    targetHash: targetHash(toLat, toLng),
    durationMin: result?.durationMin ?? null,
    transfers: result?.transfers ?? null,
    computedAt: FieldValue.serverTimestamp(),
  });
  return result;
}
