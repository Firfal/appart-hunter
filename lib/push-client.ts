import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase/client";

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Enregistre le SW, demande la permission, s'abonne au push, stocke l'abonnement. */
export async function enablePush(uid: string): Promise<string> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "Push non supporté par ce navigateur.";
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!pub) return "Clé VAPID absente (config).";

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Permission de notification refusée.";

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(pub) as BufferSource,
  });
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  const id = btoa(sub.endpoint).replace(/[^a-zA-Z0-9]/g, "").slice(-40);
  await setDoc(doc(db, "profiles", uid, "push_subscriptions", id), {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? null,
    auth: json.keys?.auth ?? null,
    createdAt: serverTimestamp(),
  });
  return "🔔 Alertes activées";
}
