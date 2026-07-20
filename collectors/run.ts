// Point d'entrée du collecteur (appelé par le cron plus tard).
// fetch + normalise + affiche, puis écrit dans Firestore SI les creds Admin sont présentes.
import { config } from "dotenv";
config({ path: ".env.local" });

import { bieniciCollector } from "./bienici";

async function main() {
  const listings = await bieniciCollector.fetchListings({ maxPages: 2 });

  console.log(`\n${listings.length} annonces normalisées (Bien'ici / Paris)\n`);
  for (const l of listings.slice(0, 6)) {
    console.log(
      `- [${l.arrondissement ?? "?"}] ${l.surface ?? "?"}m² · ${l.priceTotal ?? "?"}€CC · ${l.rooms ?? "?"}p` +
        ` · ${l.furnished ? "meublé" : "vide"} · DPE ${l.dpe ?? "?"} · ${l.isPro ? "pro" : "particulier"}` +
        ` · geo ${l.lat ?? "∅"},${l.lng ?? "∅"} · ${l.photos.length}📷`
    );
  }

  const has = (k: keyof (typeof listings)[number]) => listings.filter((l) => l[k] != null).length;
  console.log(
    `\nComplétude: prix ${has("priceTotal")}/${listings.length}, surface ${has("surface")}, ` +
      `pièces ${has("rooms")}, DPE ${has("dpe")}, geo ${has("lat")}, CP ${has("postalCode")}`
  );

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const { storeListings } = await import("./store");
    const res = await storeListings(listings);
    console.log(`\n✔ Firestore : ${res.created} créées, ${res.updated} mises à jour.`);
  } else {
    console.log(
      "\nℹ Firestore non écrit (creds Admin absentes). Renseigne FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY dans .env.local pour activer l'écriture."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
