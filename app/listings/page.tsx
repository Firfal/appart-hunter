"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
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
  breakdown: { trajet: number; prix: number; fraicheur: number; base: number; mArnaque: number };
};

function scoreColor(s: number) {
  if (s >= 70) return "bg-emerald-500";
  if (s >= 50) return "bg-amber-500";
  return "bg-zinc-400";
}

export default function ListingsPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [matches, setMatches] = useState<Match[] | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const q = query(
        collection(db, "profiles", user.uid, "search_profiles", "default", "matches"),
        orderBy("score", "desc"),
        limit(80)
      );
      const snap = await getDocs(q);
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Match, "id">) }));
      setMatches(all.filter((m) => m.passesHard));
    })();
  }, [user]);

  if (loading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm opacity-60">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/15 pb-4">
        <div>
          <h1 className="text-lg font-semibold">Mes annonces classées</h1>
          <p className="text-sm opacity-60">
            {matches ? `${matches.length} matchent (42 + UPEC ≤ 50 min)` : "…"} · {user.email}
          </p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          Se déconnecter
        </button>
      </header>

      {matches === null ? (
        <p className="mt-8 text-sm opacity-60">Calcul du classement…</p>
      ) : matches.length === 0 ? (
        <p className="mt-8 text-sm opacity-60">Aucune annonce ne matche encore tes critères.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {matches.map((m) => (
            <li key={m.id}>
              <a
                href={m.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 p-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <div className="flex flex-col items-center shrink-0 w-10">
                  <span
                    className={`${scoreColor(m.score)} text-white text-sm font-semibold rounded-md w-10 h-10 flex items-center justify-center`}
                  >
                    {Math.round(m.score)}
                  </span>
                </div>
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
                  <div className="text-sm opacity-70">
                    🚇 UPEC {m.commute?.UPEC ?? "?"} min · 42 {m.commute?.["42"] ?? "?"} min
                  </div>
                  <div className="text-xs opacity-50 truncate">
                    {m.arrondissement ? `Paris ${m.arrondissement}e` : ""}
                    {m.dpe && m.dpe !== "NS" ? ` · DPE ${m.dpe}` : ""}
                    {m.isPro ? " · agence" : " · particulier"} · {m.source}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
