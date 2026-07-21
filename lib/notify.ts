import webpush from "web-push";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebase/admin";

let vapidReady = false;
function configureVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:alerts@apparthunter.app", pub, priv);
  vapidReady = true;
  return true;
}

type Fresh = {
  id: string;
  score: number;
  priceTotal: number | null;
  surface: number | null;
  arr: number | null;
  url: string | null;
  commute: Record<string, number | null>;
};

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Chasseur d'appart <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}

function emailHtml(fresh: Fresh[]): string {
  const rows = fresh.slice(0, 6).map((m) => {
    const commute = Object.entries(m.commute || {}).map(([k, v]) => `${k} ${v ?? "?"} min`).join(" · ");
    return `<tr>
      <td style="padding:8px 10px;font-weight:600">${Math.round(m.score)}</td>
      <td style="padding:8px 10px">${m.priceTotal ?? "?"} € · ${m.surface ?? "?"} m² · Paris ${m.arr ?? "?"}e</td>
      <td style="padding:8px 10px;color:#555">🚇 ${commute}</td>
      <td style="padding:8px 10px"><a href="${m.url ?? "#"}">voir</a></td>
    </tr>`;
  }).join("");
  return `<div style="font-family:system-ui,sans-serif">
    <h2>🏠 ${fresh.length} nouvel${fresh.length > 1 ? "s" : ""} appart${fresh.length > 1 ? "s" : ""} qui matche${fresh.length > 1 ? "nt" : ""}</h2>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="margin-top:16px"><a href="https://appart-hunter--appart-hunter-2d81b.europe-west4.hosted.app/listings">Ouvrir le feed →</a></p>
  </div>`;
}

/** Envoie push + email par user pour ses NOUVEAUX matchs (anti-doublon via alert_deliveries). */
export async function sendNewMatchAlerts(): Promise<{ users: number; pushed: number; emailed: number }> {
  const hasVapid = configureVapid();
  const users = await adminDb.collection("profiles").get();
  let pushed = 0;
  let emailed = 0;

  for (const u of users.docs) {
    const email = u.get("email") as string | undefined;
    const sps = await u.ref.collection("search_profiles").where("active", "==", true).get();
    const hard: Fresh[] = [];
    for (const sp of sps.docs) {
      const ms = await sp.ref.collection("matches").get();
      ms.forEach((m) => {
        if (m.get("passesHard"))
          hard.push({
            id: m.id, score: m.get("score") ?? 0, priceTotal: m.get("priceTotal"),
            surface: m.get("surface"), arr: m.get("arrondissement"), url: m.get("url"),
            commute: m.get("commute") ?? {},
          });
      });
    }
    if (hard.length === 0) continue;

    const delivered = new Set((await u.ref.collection("alert_deliveries").get()).docs.map((d) => d.id));
    const fresh = hard.filter((m) => !delivered.has(m.id)).sort((a, b) => b.score - a.score);
    if (fresh.length === 0) continue;

    let attempted = false;

    // --- Web Push ---
    if (hasVapid) {
      const subs = await u.ref.collection("push_subscriptions").get();
      if (!subs.empty) {
        const top = fresh[0];
        const payload = JSON.stringify({
          title: fresh.length === 1 ? "🏠 Nouvel appart qui matche" : `🏠 ${fresh.length} nouveaux apparts`,
          body: `Top : ${top.priceTotal ?? "?"} € · Paris ${top.arr ?? "?"}e · score ${Math.round(top.score)}`,
          url: "/listings", tag: "new-matches",
        });
        for (const s of subs.docs) {
          const d = s.data();
          try {
            await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload);
            pushed++; attempted = true;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await s.ref.delete();
          }
        }
      }
    }

    // --- Email (Resend) ---
    if (process.env.RESEND_API_KEY && email) {
      const subject = fresh.length === 1 ? "🏠 Nouvel appart qui matche" : `🏠 ${fresh.length} nouveaux apparts qui matchent`;
      const ok = await sendEmail(email, subject, emailHtml(fresh));
      if (ok) { emailed++; attempted = true; }
    }

    // Marque livré seulement si un canal a été tenté (sinon on réessaie plus tard).
    if (attempted) {
      let batch = adminDb.batch();
      let ops = 0;
      for (const m of fresh) {
        batch.set(u.ref.collection("alert_deliveries").doc(m.id), { channel: "push+email", sentAt: FieldValue.serverTimestamp() });
        if (++ops >= 400) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
    }
  }

  return { users: users.size, pushed, emailed };
}
