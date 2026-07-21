import webpush from "web-push";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebase/admin";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Clés VAPID manquantes (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  webpush.setVapidDetails("mailto:alerts@apparthunter.app", pub, priv);
  configured = true;
}

/** Envoie une notif Web Push par user pour ses NOUVEAUX matchs (anti-doublon via alert_deliveries). */
export async function sendNewMatchAlerts(): Promise<{ users: number; pushed: number }> {
  configure();
  const users = await adminDb.collection("profiles").get();
  let pushed = 0;

  for (const u of users.docs) {
    // Matchs qui passent les filtres durs, sur toutes les recherches actives.
    const sps = await u.ref.collection("search_profiles").where("active", "==", true).get();
    const hard: { id: string; score: number; priceTotal: number | null; arr: number | null }[] = [];
    for (const sp of sps.docs) {
      const ms = await sp.ref.collection("matches").get();
      ms.forEach((m) => {
        if (m.get("passesHard")) hard.push({ id: m.id, score: m.get("score") ?? 0, priceTotal: m.get("priceTotal"), arr: m.get("arrondissement") });
      });
    }
    if (hard.length === 0) continue;

    // Déjà notifiés ?
    const delivered = new Set((await u.ref.collection("alert_deliveries").get()).docs.map((d) => d.id));
    const fresh = hard.filter((m) => !delivered.has(m.id));
    if (fresh.length === 0) continue;

    // Abonnements push de l'user.
    const subs = await u.ref.collection("push_subscriptions").get();
    if (subs.empty) continue; // pas d'abonnement → on notifiera quand il s'abonnera

    fresh.sort((a, b) => b.score - a.score);
    const top = fresh[0];
    const payload = JSON.stringify({
      title: fresh.length === 1 ? "🏠 Nouvel appart qui matche" : `🏠 ${fresh.length} nouveaux apparts`,
      body: `Top : ${top.priceTotal ?? "?"} € · Paris ${top.arr ?? "?"}e · score ${Math.round(top.score)}`,
      url: "/listings",
      tag: "new-matches",
    });

    for (const s of subs.docs) {
      const d = s.data();
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
        pushed++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await s.ref.delete(); // abonnement expiré
      }
    }

    // Marque tous les matchs frais comme notifiés.
    let batch = adminDb.batch();
    let ops = 0;
    for (const m of fresh) {
      batch.set(u.ref.collection("alert_deliveries").doc(m.id), { channel: "webpush", sentAt: FieldValue.serverTimestamp() });
      if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
  }

  return { users: users.size, pushed };
}
