"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type FicheMatch = {
  id: string;
  score: number;
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
  pricePerM2: number | null;
  priceGapPct: number | null;
  commute: Record<string, number | null>;
  breakdown?: { trajet: number; prix: number; fraicheur: number; base: number; mArnaque: number };
};

type Extra = {
  rent?: number | null;
  charges?: number | null;
  floor?: number | null;
  bedrooms?: number | null;
  city?: string | null;
  photos?: string[];
};

const STATUSES: { key: string; label: string }[] = [
  { key: "new", label: "Nouveau" },
  { key: "to_contact", label: "À contacter" },
  { key: "contacted", label: "Contacté" },
  { key: "visit", label: "Visite" },
  { key: "applied", label: "Dossier envoyé" },
  { key: "taken", label: "Pris" },
  { key: "rejected", label: "Refusé" },
];

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 opacity-60">{label}</span>
      <div className="flex-1 h-2 rounded bg-black/10 dark:bg-white/10 overflow-hidden">
        <div className="h-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums">{Math.round(value)}</span>
    </div>
  );
}

export default function FichePanel({
  match,
  state,
  onClose,
  onSetState,
}: {
  match: FicheMatch;
  state: { starred?: boolean; hidden?: boolean; status?: string };
  onClose: () => void;
  onSetState: (patch: { starred?: boolean; hidden?: boolean; status?: string }) => void;
}) {
  const [extra, setExtra] = useState<Extra | null>(null);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "listings", match.id));
      setExtra(snap.exists() ? (snap.data() as Extra) : {});
    })();
  }, [match.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const b = match.breakdown;
  const photos = extra?.photos?.length ? extra.photos : match.thumbUrl ? [match.thumbUrl] : [];

  function contact() {
    onSetState({ status: "contacted" });
    if (match.url) window.open(match.url, "_blank");
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md h-full overflow-y-auto bg-white dark:bg-zinc-950 border-l border-black/10 dark:border-white/15 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-semibold">{match.priceTotal != null ? `${match.priceTotal} € CC` : "?"}</div>
            <div className="text-sm opacity-70">
              {match.surface ?? "?"} m² · {match.rooms ?? "?"} pièces
              {extra?.bedrooms != null ? ` · ${extra.bedrooms} ch` : ""}
              {match.furnished ? " · meublé" : " · vide"}
              {extra?.floor != null ? ` · ét. ${extra.floor}` : ""}
            </div>
            <div className="text-xs opacity-50 mt-0.5">
              {match.arrondissement ? `Paris ${match.arrondissement}e` : extra?.city ?? ""}
              {match.dpe && match.dpe !== "NS" ? ` · DPE ${match.dpe}` : ""}
              {match.isPro ? " · agence" : " · particulier"} · {match.source}
            </div>
          </div>
          <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">✕</button>
        </div>

        {photos.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p} alt="" className="h-28 rounded-md object-cover shrink-0" />
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <span className="text-3xl font-bold tabular-nums">{Math.round(match.score)}</span>
          <span className="text-sm opacity-60">score /100</span>
        </div>

        {b && (
          <div className="mt-3 space-y-1.5">
            <Bar label="Trajet" value={b.trajet} />
            <Bar label="Prix" value={b.prix} />
            <Bar label="Fraîcheur" value={b.fraicheur} />
            <Bar label="Base" value={b.base} />
            {b.mArnaque < 1 && <div className="text-xs text-red-500">⚠ malus arnaque ×{b.mArnaque}</div>}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-black/10 dark:border-white/10 p-3 text-sm">
          <div className="font-medium mb-1">🚇 Trajets (transit, heure de pointe)</div>
          {Object.entries(match.commute || {}).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="opacity-70">{k}</span>
              <span className={v != null && v <= 50 ? "" : "text-red-500"}>{v ?? "?"} min</span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-lg border border-black/10 dark:border-white/10 p-3 text-sm">
          <div className="flex justify-between">
            <span className="opacity-70">Prix / m²</span>
            <span>{match.pricePerM2 != null ? `${match.pricePerM2} €` : "?"}</span>
          </div>
          {match.priceGapPct != null && (
            <div className="flex justify-between">
              <span className="opacity-70">vs marché quartier</span>
              <span className={match.priceGapPct > 0 ? "text-emerald-600" : "text-red-500"}>
                {match.priceGapPct > 0 ? "-" : "+"}{Math.abs(match.priceGapPct)}%
              </span>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="text-xs opacity-70">Suivi</label>
          <select
            value={state.status ?? "new"}
            onChange={(e) => onSetState({ status: e.target.value })}
            className="w-full mt-1 rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key} className="bg-white dark:bg-zinc-900">{s.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => onSetState({ starred: !state.starred })}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
            {state.starred ? "★ En shortlist" : "☆ Shortlist"}
          </button>
          <button onClick={() => onSetState({ hidden: !state.hidden })}
            className="rounded-md border border-black/15 dark:border-white/20 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
            {state.hidden ? "Démasquer" : "🚫 Masquer"}
          </button>
        </div>

        <button onClick={contact}
          className="mt-2 w-full rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium">
          Contacter (ouvre l&apos;annonce) →
        </button>
      </div>
    </div>
  );
}
