"use client";

import { useEffect, useRef } from "react";

export type MapMatch = {
  id: string;
  score: number;
  lat?: number | null;
  lng?: number | null;
  priceTotal: number | null;
  surface: number | null;
  commute: Record<string, number | null>;
};

export type MapTarget = { label: string; lat: number; lng: number };

function color(score: number) {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#a1a1aa";
}

export default function MapView({
  matches,
  targets,
  onOpen,
}: {
  matches: MapMatch[];
  targets: MapTarget[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;

      map = L.map(ref.current).setView([48.845, 2.38], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const pts: [number, number][] = [];

      // Pôles (42 / UPEC) — gros marqueurs bleus étiquetés.
      for (const t of targets) {
        L.circleMarker([t.lat, t.lng], {
          radius: 9, color: "#1d4ed8", weight: 3, fillColor: "#3b82f6", fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip(t.label, { permanent: true, direction: "top", className: "font-semibold" });
        pts.push([t.lat, t.lng]);
      }

      // Annonces — cercles colorés par score.
      for (const m of matches) {
        if (m.lat == null || m.lng == null) continue;
        const commute = Object.entries(m.commute || {}).map(([k, v]) => `${k} ${v ?? "?"}min`).join(" · ");
        const mk = L.circleMarker([m.lat, m.lng], {
          radius: 7, color: "#fff", weight: 1.5, fillColor: color(m.score), fillOpacity: 0.9,
        })
          .addTo(map)
          .bindTooltip(`${Math.round(m.score)} · ${m.priceTotal ?? "?"}€ · ${m.surface ?? "?"}m²<br>🚇 ${commute}`);
        mk.on("click", () => onOpen(m.id));
        pts.push([m.lat, m.lng]);
      }

      if (pts.length) map.fitBounds(pts as [number, number][], { padding: [40, 40] });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [matches, targets, onOpen]);

  return <div ref={ref} className="mt-4 h-[70vh] w-full rounded-lg overflow-hidden border border-black/10 dark:border-white/10" />;
}
