import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";
import { getCommute } from "../lib/commute";
import { scoreListing, type Target, type SearchCriteria } from "../lib/scoring";

type StoredTarget = Target & { lat: number; lng: number };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Score toutes les recherches actives (tous users) contre les annonces actives. */
export async function scoreAllProfiles(nowMs: number, listingLimit = 300) {
  // Annonces récentes (tri simple = pas d'index composite), filtre isActive en code.
  const lsnap = await adminDb.collection("listings").orderBy("firstSeenAt", "desc").limit(listingLimit).get();
  const listings = lsnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    .filter((l) => l.isActive !== false);

  // Médiane €/m² par arrondissement.
  const byArr: Record<number, number[]> = {};
  for (const l of listings) {
    const p = l.priceTotal as number | null, s = l.surface as number | null, a = l.arrondissement as number | null;
    if (p && s && a) (byArr[a] ??= []).push(p / s);
  }
  const medByArr: Record<number, number | null> = {};
  for (const a of Object.keys(byArr)) medByArr[+a] = median(byArr[+a]);

  // Toutes les recherches actives : on itère les users puis leurs recherches
  // (sous-collection normale = index simple auto, pas d'index collection-group à créer).
  const users = await adminDb.collection("profiles").get();
  const profileDocs = [];
  for (const u of users.docs) {
    const sps = await u.ref.collection("search_profiles").where("active", "==", true).get();
    profileDocs.push(...sps.docs);
  }

  let totalMatches = 0;
  for (const sp of profileDocs) {
    const data = sp.data();
    const targets = (data.targets ?? []) as StoredTarget[];
    const criteria: SearchCriteria = {
      budgetMin: data.budgetMin ?? null,
      budgetMax: data.budgetMax ?? null,
      surfaceMin: data.surfaceMin ?? null,
      roomsMin: data.roomsMin ?? null,
      furnished: data.furnished ?? null,
      arrondissements: data.arrondissements ?? null,
    };

    let batch = adminDb.batch();
    let ops = 0;
    for (const l of listings) {
      const geo = l.geo as { latitude?: number; longitude?: number } | undefined;
      const commuteByTarget: Record<string, number | null> = {};
      for (const t of targets) {
        if (geo?.latitude != null && geo?.longitude != null) {
          const r = await getCommute(l.id, geo.latitude, geo.longitude, t.lat, t.lng, nowMs);
          commuteByTarget[t.label] = r?.durationMin ?? null;
        } else {
          commuteByTarget[t.label] = null;
        }
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
        criteria,
        targets,
        commuteByTarget,
        medianPpm2: arr != null ? medByArr[arr] ?? null : null,
        fraudFlags: [],
        nowMs,
      });

      batch.set(sp.ref.collection("matches").doc(l.id), {
        listingId: l.id,
        score: res.score,
        passesHard: res.passesHard,
        reason: res.reason ?? null,
        commute: commuteByTarget,
        pricePerM2: res.pricePerM2,
        priceGapPct: res.priceGapPct,
        breakdown: res.breakdown,
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
        lat: geo?.latitude ?? null,
        lng: geo?.longitude ?? null,
        firstSeenAt: (l.firstSeenAt as unknown) ?? null,
        dedupKey: (l.dedupKey as string) ?? null,
        computedAt: FieldValue.serverTimestamp(),
      });
      if (res.passesHard) totalMatches++;
      // Firestore batch max 500 writes → on commit par paquets.
      if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
  }
  return { profiles: profileDocs.length, listings: listings.length, matches: totalMatches };
}
