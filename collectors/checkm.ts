import { config } from "dotenv";
config({ path: ".env.local" });
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "../lib/firebase/admin";

async function main() {
  const u = (await getAuth().listUsers(1)).users[0];
  const ms = await adminDb
    .collection("profiles").doc(u.uid)
    .collection("search_profiles").doc("default")
    .collection("matches").get();
  let hard = 0, latest = 0;
  const now = Date.now();
  ms.forEach((d) => {
    if (d.get("passesHard")) hard++;
    const t = d.get("computedAt")?.toMillis?.() ?? 0;
    if (t > latest) latest = t;
  });
  console.log(
    `matches total: ${ms.size} | passent filtres durs: ${hard} | dernier calcul il y a ${Math.round((now - latest) / 60000)} min`
  );
}
main().catch((e) => { console.error(e.message); process.exit(1); });
