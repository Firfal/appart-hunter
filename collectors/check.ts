import { config } from "dotenv";
config({ path: ".env.local" });
import { adminDb } from "../lib/firebase/admin";

async function main() {
  const snap = await adminDb.collection("listings").get();
  let latest = 0;
  let recent = 0;
  const now = Date.now();
  snap.forEach((d) => {
    const ts = d.get("lastSeenAt");
    const ms = ts?.toMillis?.() ?? 0;
    if (ms > latest) latest = ms;
    if (now - ms < 3 * 60 * 1000) recent++;
  });
  console.log(`Total listings: ${snap.size}`);
  console.log(`lastSeenAt le plus récent: ${new Date(latest).toISOString()}`);
  console.log(`Docs mis à jour dans les 3 dernières min: ${recent}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
