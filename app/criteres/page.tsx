"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";
import { geocode, type GeoSuggestion } from "@/lib/geocode";

type TargetForm = {
  label: string;
  lat: number | null;
  lng: number | null;
  weight: number;
  maxCommuteMin: number;
  hard: boolean;
  query: string;
  suggestions: GeoSuggestion[];
};

const emptyTarget = (): TargetForm => ({
  label: "",
  lat: null,
  lng: null,
  weight: 0.5,
  maxCommuteMin: 50,
  hard: true,
  query: "",
  suggestions: [],
});

export default function CriteresPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [name, setName] = useState("Ma recherche");
  const [budgetMax, setBudgetMax] = useState<number | "">("");
  const [surfaceMin, setSurfaceMin] = useState<number | "">("");
  const [roomsMin, setRoomsMin] = useState<number | "">("");
  const [furnished, setFurnished] = useState<"any" | "yes" | "no">("any");
  const [targets, setTargets] = useState<TargetForm[]>([emptyTarget()]);
  const [status, setStatus] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const debounce = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Charge le profil existant.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const ref = doc(db, "profiles", user.uid, "search_profiles", "default");
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        setName(d.name ?? "Ma recherche");
        setBudgetMax(d.budgetMax ?? "");
        setSurfaceMin(d.surfaceMin ?? "");
        setRoomsMin(d.roomsMin ?? "");
        setFurnished(d.furnished === true ? "yes" : d.furnished === false ? "no" : "any");
        const ts = (d.targets ?? []) as Omit<TargetForm, "query" | "suggestions">[];
        if (ts.length)
          setTargets(ts.map((t) => ({ ...t, query: t.label, suggestions: [] })));
      }
      setReady(true);
    })();
  }, [user]);

  function updateTarget(i: number, patch: Partial<TargetForm>) {
    setTargets((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  function onQueryChange(i: number, q: string) {
    updateTarget(i, { query: q, lat: null, lng: null });
    clearTimeout(debounce.current[i]);
    debounce.current[i] = setTimeout(async () => {
      const sugg = await geocode(q);
      updateTarget(i, { suggestions: sugg });
    }, 300);
  }

  function pickSuggestion(i: number, s: GeoSuggestion) {
    updateTarget(i, { lat: s.lat, lng: s.lng, query: s.label, suggestions: [] });
  }

  async function save() {
    if (!user) return;
    const clean = targets
      .filter((t) => t.lat != null && t.lng != null && t.label.trim())
      .map((t) => ({
        label: t.label.trim(),
        lat: t.lat,
        lng: t.lng,
        weight: t.weight,
        maxCommuteMin: t.maxCommuteMin,
        hard: t.hard,
      }));
    if (clean.length === 0) {
      setStatus("Ajoute au moins une destination (avec une adresse localisée).");
      return;
    }
    setStatus("Enregistrement…");
    await setDoc(
      doc(db, "profiles", user.uid, "search_profiles", "default"),
      {
        name,
        budgetMax: budgetMax === "" ? null : Number(budgetMax),
        surfaceMin: surfaceMin === "" ? null : Number(surfaceMin),
        roomsMin: roomsMin === "" ? null : Number(roomsMin),
        furnished: furnished === "any" ? null : furnished === "yes",
        arrondissements: null,
        targets: clean,
        active: true,
      },
      { merge: true }
    );
    setStatus("✓ Enregistré. Le classement se met à jour au prochain scoring (≤ 15 min).");
  }

  if (loading || !user || !ready) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm opacity-60">Chargement…</p>
      </main>
    );
  }

  const inputCls =
    "w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm";

  return (
    <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/15 pb-4">
        <h1 className="text-lg font-semibold">Mes critères</h1>
        <Link href="/listings" className="text-sm opacity-60 hover:opacity-100">
          ← Retour au feed
        </Link>
      </header>

      <section className="mt-6 space-y-4">
        <div>
          <label className="text-sm opacity-70">Nom de la recherche</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm opacity-70">Budget max (€ CC)</label>
            <input type="number" className={inputCls} value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm opacity-70">Surface min (m²)</label>
            <input type="number" className={inputCls} value={surfaceMin}
              onChange={(e) => setSurfaceMin(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div>
            <label className="text-sm opacity-70">Pièces min</label>
            <input type="number" className={inputCls} value={roomsMin}
              onChange={(e) => setRoomsMin(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className="text-sm opacity-70">Meublé</label>
          <div className="flex gap-2 mt-1">
            {(["any", "yes", "no"] as const).map((v) => (
              <button key={v} onClick={() => setFurnished(v)}
                className={`text-sm rounded-md px-3 py-1.5 border ${
                  furnished === v ? "bg-foreground text-background border-transparent" : "border-black/15 dark:border-white/20"
                }`}>
                {v === "any" ? "Indifférent" : v === "yes" ? "Meublé" : "Vide"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Destinations (trajet transit)</h2>
          <button onClick={() => setTargets((t) => [...t, emptyTarget()])}
            className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">
            + Ajouter
          </button>
        </div>
        <p className="text-xs opacity-50 mt-1">
          Le score favorise les poids plus élevés. « Obligatoire » = éliminé si le trajet dépasse le seuil.
        </p>

        <div className="mt-4 space-y-4">
          {targets.map((t, i) => (
            <div key={i} className="rounded-lg border border-black/10 dark:border-white/10 p-3 space-y-3">
              <div className="flex gap-2">
                <input className={inputCls} placeholder="Nom (ex. École 42)" value={t.label}
                  onChange={(e) => updateTarget(i, { label: e.target.value })} />
                {targets.length > 1 && (
                  <button onClick={() => setTargets((prev) => prev.filter((_, j) => j !== i))}
                    className="text-sm opacity-50 hover:opacity-100 px-2">✕</button>
                )}
              </div>

              <div className="relative">
                <input className={inputCls} placeholder="Adresse (ex. 96 bd Bessières Paris)"
                  value={t.query} onChange={(e) => onQueryChange(i, e.target.value)} />
                {t.lat != null && <p className="text-xs text-emerald-600 mt-1">📍 localisé</p>}
                {t.suggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-md border border-black/15 dark:border-white/20 bg-white dark:bg-zinc-900 shadow">
                    {t.suggestions.map((s, k) => (
                      <li key={k}>
                        <button onClick={() => pickSuggestion(i, s)}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-xs opacity-70">Poids ({t.weight})</label>
                  <input type="range" min={0} max={1} step={0.1} value={t.weight}
                    onChange={(e) => updateTarget(i, { weight: Number(e.target.value) })} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-70">Trajet max (min)</label>
                  <input type="number" className={inputCls} value={t.maxCommuteMin}
                    onChange={(e) => updateTarget(i, { maxCommuteMin: Number(e.target.value) })} />
                </div>
                <label className="flex items-center gap-2 text-sm pb-2">
                  <input type="checkbox" checked={t.hard}
                    onChange={(e) => updateTarget(i, { hard: e.target.checked })} />
                  Obligatoire
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8 flex items-center gap-4">
        <button onClick={save}
          className="rounded-md bg-foreground text-background px-5 py-2 text-sm font-medium">
          Enregistrer
        </button>
        {status && <span className="text-sm opacity-70">{status}</span>}
      </div>
    </main>
  );
}
