"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";
import { enablePush } from "@/lib/push-client";
import FichePanel from "./FichePanel";
import MapView, { type MapTarget } from "./MapView";

type Ts = { toMillis?: () => number; seconds?: number } | null;
type Match = {
  id: string;
  score: number;
  passesHard: boolean;
  url: string | null;
  source: string | null;
  priceTotal: number | null;
  surface: number | null;
  rooms: number | null;
  furnished: boolean | null;
  dpe: string | null;
  arrondissement: number | null;
  thumbUrl: string | null;
  isPro: boolean | null;
  priceGapPct: number | null;
  pricePerM2: number | null;
  lat: number | null;
  lng: number | null;
  firstSeenAt?: Ts;
  commute: Record<string, number | null>;
  breakdown?: { trajet: number; prix: number; fraicheur: number; base: number; mArnaque: number };
};

type State = { starred?: boolean; hidden?: boolean; status?: string };
type Tab = "feed" | "shortlist" | "hidden";
type Sort = "score" | "fresh" | "price";

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  bienici: { label: "Bien'ici", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-300" },
  leboncoin: { label: "leboncoin", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-300" },
  seloger: { label: "SeLoger", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-300" },
};

function scoreCls(s: number) {
  if (s >= 70) return "bg-emerald-500";
  if (s >= 50) return "bg-amber-500";
  return "bg-zinc-400";
}
function ms(ts: Ts | undefined): number | null {
  if (!ts) return null;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return null;
}
function ago(t: number | null): string {
  if (!t) return "";
  const d = Date.now() - t;
  const m = Math.floor(d / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export default function ListingsPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [states, setStates] = useState<Record<string, State>>({});
  const [tab, setTab] = useState<Tab>("feed");
  const [sort, setSort] = useState<Sort>("score");
  const [sel, setSel] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [targets, setTargets] = useState<MapTarget[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "profiles", user.uid, "search_profiles", "default", "matches"),
      orderBy("score", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => setMatches(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Match, "id">) }))));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "profiles", user.uid, "listing_states"), (snap) => {
      const m: Record<string, State> = {};
      snap.docs.forEach((d) => (m[d.id] = d.data() as State));
      setStates(m);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "profiles", user.uid, "search_profiles", "default")).then((snap) => {
      const ts = (snap.data()?.targets ?? []) as { label: string; lat: number; lng: number }[];
      setTargets(ts.filter((t) => t.lat != null && t.lng != null));
    });
  }, [user]);

  const passing = useMemo(() => (matches ?? []).filter((m) => m.passesHard), [matches]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = {};
    passing.forEach((m) => { if (m.source) c[m.source] = (c[m.source] ?? 0) + 1; });
    return c;
  }, [passing]);

  const visible = useMemo(() => {
    const all = matches ?? [];
    let list: Match[];
    if (tab === "shortlist") list = all.filter((m) => states[m.id]?.starred);
    else if (tab === "hidden") list = all.filter((m) => states[m.id]?.hidden);
    else list = all.filter((m) => m.passesHard && !states[m.id]?.hidden);
    const sorted = [...list];
    if (sort === "score") sorted.sort((a, b) => b.score - a.score);
    else if (sort === "price") sorted.sort((a, b) => (a.priceTotal ?? 9e9) - (b.priceTotal ?? 9e9));
    else sorted.sort((a, b) => (ms(b.firstSeenAt) ?? 0) - (ms(a.firstSeenAt) ?? 0));
    return sorted;
  }, [matches, states, tab, sort]);

  useEffect(() => setSel(0), [tab, sort]);

  async function setState(id: string, patch: State) {
    if (!user) return;
    await setDoc(doc(db, "profiles", user.uid, "listing_states", id), patch, { merge: true });
  }
  const toggleStar = (id: string) => setState(id, { starred: !states[id]?.starred });
  const toggleHide = (id: string) => setState(id, { hidden: !states[id]?.hidden });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const cur = visible[sel];
      if (e.key === "j" || e.key === "ArrowDown") { setSel((s) => Math.min(visible.length - 1, s + 1)); e.preventDefault(); }
      else if (e.key === "k" || e.key === "ArrowUp") { setSel((s) => Math.max(0, s - 1)); e.preventDefault(); }
      else if (e.key === "s" && cur) toggleStar(cur.id);
      else if (e.key === "x" && cur) toggleHide(cur.id);
      else if (e.key === "Enter" && cur) setOpenId(cur.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, sel, states]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Chargement…</p>
      </main>
    );
  }

  const btn = "text-sm rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2 transition-colors";
  const seg = (active: boolean) => `text-sm rounded-md px-3 py-1.5 transition-colors ${active ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`;

  return (
    <div className="flex-1 w-full">
      {/* Barre du haut */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-semibold leading-tight">Chasseur d&apos;appart</h1>
            <p className="text-xs text-muted truncate">{user.email}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => enablePush(user.uid).then(setPushMsg).catch((e) => setPushMsg(String(e?.message ?? e)))}
              title={pushMsg ?? "Être notifié d'un nouvel appart qui matche"}
              className={btn}
            >
              {pushMsg === "🔔 Alertes activées" ? "🔔 Activées" : "🔔"}
            </button>
            <Link href="/criteres" className={btn}>Critères</Link>
            <button onClick={() => signOut()} className={btn} title="Se déconnecter">Sortir</button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
        {/* Stats par source */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{passing.length} apparts matchent</span>
          <span className="text-muted">·</span>
          {Object.entries(sourceCounts).map(([s, n]) => (
            <span key={s} className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_META[s]?.cls ?? "bg-surface-2 text-muted"}`}>
              {SOURCE_META[s]?.label ?? s} {n}
            </span>
          ))}
        </div>

        {/* Contrôles */}
        <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
            {([["feed", "Feed"], ["shortlist", "★"], ["hidden", "Masqués"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={seg(tab === k)}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
              className="text-sm rounded-lg border border-border bg-surface px-2 py-1.5">
              <option value="score">Trier : score</option>
              <option value="fresh">Trier : récence</option>
              <option value="price">Trier : prix ↑</option>
            </select>
            <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5">
              {(["list", "map"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={seg(view === v)}>{v === "list" ? "Liste" : "🗺"}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Contenu */}
        {view === "map" ? (
          <MapView matches={visible} targets={targets} onOpen={setOpenId} />
        ) : matches === null ? (
          <ul className="mt-4 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <li key={i} className="skeleton h-24" />)}
          </ul>
        ) : visible.length === 0 ? (
          <div className="mt-16 text-center text-sm text-muted">
            {tab === "feed" ? (
              <>
                <p className="text-2xl mb-2">🔍</p>
                <p>Aucun appart ne matche encore tes critères.</p>
                <p className="mt-1">Vérifie tes <Link href="/criteres" className="text-accent underline">critères</Link> (budget, trajet max…).</p>
              </>
            ) : tab === "shortlist" ? "Aucune annonce en shortlist. Appuie sur ★ pour en ajouter." : "Aucune annonce masquée."}
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {visible.map((m, i) => {
              const st = states[m.id] ?? {};
              const src = m.source ? SOURCE_META[m.source] : undefined;
              return (
                <li key={m.id}>
                  <div
                    onClick={() => { setSel(i); setOpenId(m.id); }}
                    className={`group flex gap-3 p-3 rounded-xl border bg-surface cursor-pointer transition-all hover:shadow-sm ${i === sel ? "border-accent ring-1 ring-accent/30" : "border-border"}`}
                  >
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className={`${scoreCls(m.score)} text-white text-base font-bold rounded-lg w-11 h-11 flex items-center justify-center`}>
                        {Math.round(m.score)}
                      </span>
                    </div>
                    {m.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbUrl} alt="" className="h-[70px] w-24 object-cover rounded-lg shrink-0 bg-surface-2" />
                    ) : (
                      <div className="h-[70px] w-24 rounded-lg shrink-0 bg-surface-2 flex items-center justify-center text-muted text-xs">📷</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold">{m.priceTotal != null ? `${m.priceTotal.toLocaleString("fr")} €` : "?"}</span>
                        <span className="text-sm text-muted">{m.surface ?? "?"} m² · {m.rooms ?? "?"}p{m.furnished ? " · meublé" : ""}</span>
                        {m.priceGapPct != null && (
                          <span className={`text-xs font-medium ${m.priceGapPct > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                            {m.priceGapPct > 0 ? "−" : "+"}{Math.abs(m.priceGapPct)}% vs marché
                          </span>
                        )}
                      </div>
                      <div className="text-sm mt-0.5 flex flex-wrap gap-x-3">
                        {Object.entries(m.commute || {}).map(([k, v]) => (
                          <span key={k} className={v != null && v <= 50 ? "text-foreground" : "text-rose-500"}>
                            🚇 {k} <b className="font-semibold">{v ?? "?"}</b> min
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {m.arrondissement ? <span>Paris {m.arrondissement}e</span> : null}
                        {m.dpe && m.dpe !== "NS" ? <span>· DPE {m.dpe}</span> : null}
                        {src ? <span className={`px-1.5 py-0.5 rounded ${src.cls}`}>{src.label}</span> : <span>· {m.source}</span>}
                        <span>· {m.isPro ? "agence" : "particulier"}</span>
                        {ms(m.firstSeenAt) ? <span>· {ago(ms(m.firstSeenAt))}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button title="Shortlist (s)" onClick={(e) => { e.stopPropagation(); toggleStar(m.id); }} className={`text-lg leading-none ${st.starred ? "" : "grayscale opacity-50 hover:opacity-100"}`}>⭐</button>
                      <button title="Masquer (x)" onClick={(e) => { e.stopPropagation(); toggleHide(m.id); }} className={`text-lg leading-none ${st.hidden ? "" : "grayscale opacity-50 hover:opacity-100"}`}>🚫</button>
                      {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir la source" className="text-sm text-muted hover:text-accent">↗</a>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>s</kbd> shortlist · <kbd>x</kbd> masquer · <kbd>⏎</kbd> ouvrir la fiche
        </p>
      </main>

      {openId && matches && (() => {
        const om = matches.find((x) => x.id === openId);
        return om ? (
          <FichePanel match={om} state={states[om.id] ?? {}} onClose={() => setOpenId(null)} onSetState={(patch) => setState(om.id, patch)} />
        ) : null;
      })()}
    </div>
  );
}
