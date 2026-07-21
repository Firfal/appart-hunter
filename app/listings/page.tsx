"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";

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
  commute: Record<string, number | null>;
};

type State = { starred?: boolean; hidden?: boolean };
type Tab = "feed" | "shortlist" | "hidden";

function scoreColor(s: number) {
  if (s >= 70) return "bg-emerald-500";
  if (s >= 50) return "bg-amber-500";
  return "bg-zinc-400";
}

export default function ListingsPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [states, setStates] = useState<Record<string, State>>({});
  const [tab, setTab] = useState<Tab>("feed");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Temps réel : les nouveaux matchs apparaissent en direct (alerte in-app).
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "profiles", user.uid, "search_profiles", "default", "matches"),
      orderBy("score", "desc"),
      limit(120)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMatches(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Match, "id">) })));
    });
    return () => unsub();
  }, [user]);

  // États perso (shortlist / masqué).
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "profiles", user.uid, "listing_states"), (snap) => {
      const m: Record<string, State> = {};
      snap.docs.forEach((d) => (m[d.id] = d.data() as State));
      setStates(m);
    });
    return () => unsub();
  }, [user]);

  const visible = useMemo(() => {
    const all = matches ?? [];
    if (tab === "shortlist") return all.filter((m) => states[m.id]?.starred);
    if (tab === "hidden") return all.filter((m) => states[m.id]?.hidden);
    return all.filter((m) => m.passesHard && !states[m.id]?.hidden);
  }, [matches, states, tab]);

  useEffect(() => setSel(0), [tab]);

  async function setState(id: string, patch: State) {
    if (!user) return;
    await setDoc(doc(db, "profiles", user.uid, "listing_states", id), patch, { merge: true });
  }
  const toggleStar = (id: string) => setState(id, { starred: !states[id]?.starred });
  const toggleHide = (id: string) => setState(id, { hidden: !states[id]?.hidden });

  // Navigation clavier (power-user).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const cur = visible[sel];
      if (e.key === "j" || e.key === "ArrowDown") { setSel((s) => Math.min(visible.length - 1, s + 1)); e.preventDefault(); }
      else if (e.key === "k" || e.key === "ArrowUp") { setSel((s) => Math.max(0, s - 1)); e.preventDefault(); }
      else if (e.key === "s" && cur) toggleStar(cur.id);
      else if (e.key === "x" && cur) toggleHide(cur.id);
      else if (e.key === "Enter" && cur?.url) window.open(cur.url, "_blank");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, sel, states]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm opacity-60">Chargement…</p>
      </main>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "feed", label: "Feed" },
    { key: "shortlist", label: "Shortlist" },
    { key: "hidden", label: "Masqués" },
  ];

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/15 pb-4">
        <div>
          <h1 className="text-lg font-semibold">Mes annonces classées</h1>
          <p className="text-sm opacity-60">
            {matches ? `${visible.length} affichées` : "…"} · <span className="opacity-50">j/k · s ⭐ · x 🚫 · ⏎ ouvrir</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/criteres" className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">
            Mes critères
          </Link>
          <button onClick={() => signOut()} className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">
            Déconnexion
          </button>
        </div>
      </header>

      <nav className="mt-4 flex gap-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-sm rounded-md px-3 py-1.5 ${tab === t.key ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {matches === null ? (
        <p className="mt-8 text-sm opacity-60">Calcul du classement…</p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-sm opacity-60">
          {tab === "feed" ? "Aucune annonce ne matche encore tes critères." : tab === "shortlist" ? "Aucune annonce en shortlist." : "Aucune annonce masquée."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((m, i) => {
            const st = states[m.id] ?? {};
            return (
              <li key={m.id}>
                <div
                  onClick={() => setSel(i)}
                  className={`flex gap-3 p-3 rounded-lg border ${i === sel ? "border-blue-500 ring-1 ring-blue-500/40" : "border-black/10 dark:border-white/10"}`}
                >
                  <span className={`${scoreColor(m.score)} text-white text-sm font-semibold rounded-md w-10 h-10 flex items-center justify-center shrink-0`}>
                    {Math.round(m.score)}
                  </span>
                  {m.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbUrl} alt="" className="h-16 w-20 object-cover rounded-md shrink-0 bg-black/10" />
                  ) : (
                    <div className="h-16 w-20 rounded-md shrink-0 bg-black/10 dark:bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{m.priceTotal != null ? `${m.priceTotal} €` : "?"}</span>
                      <span className="text-sm opacity-70">
                        {m.surface ?? "?"} m² · {m.rooms ?? "?"}p{m.furnished ? " · meublé" : ""}
                        {m.priceGapPct != null ? ` · ${m.priceGapPct > 0 ? "-" : "+"}${Math.abs(m.priceGapPct)}% marché` : ""}
                      </span>
                    </div>
                    <div className="text-sm opacity-70">🚇 UPEC {m.commute?.UPEC ?? "?"} min · 42 {m.commute?.["42"] ?? "?"} min</div>
                    <div className="text-xs opacity-50 truncate">
                      {m.arrondissement ? `Paris ${m.arrondissement}e` : ""}{m.dpe && m.dpe !== "NS" ? ` · DPE ${m.dpe}` : ""}{m.isPro ? " · agence" : " · particulier"} · {m.source}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <button title="Shortlist (s)" onClick={(e) => { e.stopPropagation(); toggleStar(m.id); }} className={`text-lg ${st.starred ? "" : "opacity-30 hover:opacity-70"}`}>⭐</button>
                    <button title="Masquer (x)" onClick={(e) => { e.stopPropagation(); toggleHide(m.id); }} className={`text-lg ${st.hidden ? "" : "opacity-30 hover:opacity-70"}`}>🚫</button>
                    {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ouvrir (⏎)" className="text-sm opacity-40 hover:opacity-100">↗</a>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
