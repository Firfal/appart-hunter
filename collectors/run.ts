// Runner LOCAL (Mac, IP résidentielle) : collecte toutes les sources + écrit Firestore.
// Bien'ici tourne aussi dans le cloud ; Leboncoin (DataDome) ne marche QUE d'ici.
import { config } from "dotenv";
config({ path: ".env.local" });

import type { Collector } from "./types";
import { bieniciCollector } from "./bienici";
import { leboncoinCollector } from "./leboncoin";

const COLLECTORS: Collector[] = [bieniciCollector, leboncoinCollector];

async function main() {
  const hasCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CLIENT_EMAIL;
  const storeListings = hasCreds ? (await import("./store")).storeListings : null;

  for (const c of COLLECTORS) {
    try {
      const listings = await c.fetchListings({ maxPages: 3 });
      const has = (k: keyof (typeof listings)[number]) => listings.filter((l) => l[k] != null).length;
      console.log(
        `\n[${c.key}] ${listings.length} annonces · prix ${has("priceTotal")} · surface ${has("surface")} · ` +
          `pièces ${has("rooms")} · geo ${has("lat")} · CP ${has("postalCode")}`
      );
      if (storeListings) {
        const r = await storeListings(listings);
        console.log(`[${c.key}] Firestore : ${r.created} créées, ${r.updated} maj`);
      }
    } catch (e) {
      console.error(`[${c.key}] ERREUR :`, (e as Error).message);
    }
  }
  if (!storeListings) console.log("\nℹ Pas de creds Admin → pas d'écriture Firestore.");
}

main().catch((e) => { console.error(e); process.exit(1); });
