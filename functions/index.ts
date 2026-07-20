import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { bieniciCollector } from "../collectors/bienici";
import { storeListings } from "../collectors/store";

setGlobalOptions({ region: "europe-west1", memory: "256MiB", maxInstances: 2 });

// Collecte Bien'ici toutes les 5 min, 9h→19h (rien la nuit → coût ~0). ADC auto en runtime.
export const collectBienici = onSchedule(
  { schedule: "*/5 9-19 * * *", timeZone: "Europe/Paris", timeoutSeconds: 120 },
  async () => {
    const listings = await bieniciCollector.fetchListings({ maxPages: 3 });
    const res = await storeListings(listings);
    console.log(`bienici: ${res.created} créées, ${res.updated} maj (${listings.length} vues)`);
  }
);
