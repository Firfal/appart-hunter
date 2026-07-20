import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";
import { contentHash, dedupKey } from "../lib/dedup";
import type { NormalizedListing } from "./types";

/**
 * Upsert idempotent dans la collection `listings`.
 * Dédup intra-source : docId = `${source}_${externalId}` → un re-scrape ne crée pas de doublon.
 */
export async function storeListings(listings: NormalizedListing[]) {
  if (listings.length === 0) return { created: 0, updated: 0 };
  const col = adminDb.collection("listings");
  const refs = listings.map((l) => col.doc(`${l.source}_${l.externalId}`));
  const snaps = await adminDb.getAll(...refs);

  const batch = adminDb.batch();
  let created = 0;
  let updated = 0;

  listings.forEach((l, i) => {
    const ref = refs[i];
    const exists = snaps[i].exists;
    // On construit le doc explicitement (pas de `raw` volumineux, pas d'`undefined`).
    const doc = {
      source: l.source,
      externalId: l.externalId,
      url: l.url,
      title: l.title,
      priceTotal: l.priceTotal,
      rent: l.rent,
      charges: l.charges,
      surface: l.surface,
      rooms: l.rooms,
      bedrooms: l.bedrooms,
      furnished: l.furnished,
      floor: l.floor,
      dpe: l.dpe,
      postalCode: l.postalCode,
      city: l.city,
      arrondissement: l.arrondissement,
      geo: l.lat != null && l.lng != null ? new GeoPoint(l.lat, l.lng) : null,
      thumbUrl: l.photos[0] ?? null,
      photoCount: l.photos.length,
      isPro: l.isPro,
      contentHash: contentHash(l),
      dedupKey: dedupKey(l),
      postedAt: l.postedAt,
      lastSeenAt: FieldValue.serverTimestamp(),
      isActive: true,
    };
    if (exists) {
      batch.set(ref, doc, { merge: true });
      updated++;
    } else {
      batch.set(ref, { ...doc, firstSeenAt: FieldValue.serverTimestamp() });
      created++;
    }
  });

  await batch.commit();
  return { created, updated };
}
