import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { bieniciCollector } from "../collectors/bienici";
import { storeListings } from "../collectors/store";
import { scoreAllProfiles } from "../collectors/score-engine";
import { sendNewMatchAlerts } from "../lib/notify";

setGlobalOptions({ region: "europe-west1", memory: "256MiB", maxInstances: 2 });

const PRIM_API_KEY = defineSecret("PRIM_API_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");

// 1) Collecte Bien'ici toutes les 5 min, 9h→19h. ADC auto en runtime.
export const collectBienici = onSchedule(
  { schedule: "*/5 9-19 * * *", timeZone: "Europe/Paris", timeoutSeconds: 120 },
  async () => {
    const listings = await bieniciCollector.fetchListings({ maxPages: 3 });
    const res = await storeListings(listings);
    console.log(`bienici: ${res.created} créées, ${res.updated} maj (${listings.length} vues)`);
  }
);

// 2) Scoring toutes les 15 min (décalé après la collecte), 9h→19h. Utilise le secret PRIM.
export const scoreProfiles = onSchedule(
  {
    schedule: "3,18,33,48 9-19 * * *",
    timeZone: "Europe/Paris",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [PRIM_API_KEY, VAPID_PRIVATE_KEY],
  },
  async () => {
    const res = await scoreAllProfiles(Date.now());
    console.log("scoring:", JSON.stringify(res));
    const alerts = await sendNewMatchAlerts();
    console.log("alerts:", JSON.stringify(alerts));
  }
);
