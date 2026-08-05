import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";

/**
 * Purge les annonces non revues depuis `days` jours (disparues de toutes les sources)
 * ET leurs matchs orphelins dans chaque recherche → collection bornée + feed sans annonces mortes.
 */
export async function purgeStale(days = 3, cap = 500): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - days * 86_400_000);
  const stale = await adminDb.collection("listings").where("lastSeenAt", "<", cutoff).limit(cap).get();
  if (stale.empty) return 0;

  // Toutes les recherches (pour supprimer les matchs orphelins).
  const users = await adminDb.collection("profiles").get();
  const spRefs = [];
  for (const u of users.docs) {
    const sps = await u.ref.collection("search_profiles").get();
    spRefs.push(...sps.docs.map((d) => d.ref));
  }

  let batch = adminDb.batch();
  let ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = adminDb.batch(); ops = 0; } };
  for (const d of stale.docs) {
    batch.delete(d.ref);
    ops++;
    for (const sp of spRefs) { batch.delete(sp.collection("matches").doc(d.id)); ops++; }
    if (ops >= 400) await flush();
  }
  await flush();
  return stale.size;
}
