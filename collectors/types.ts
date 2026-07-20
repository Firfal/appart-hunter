// Interface commune à tous les collecteurs. C'est ELLE qui rend le swap vers une
// source licenciée (Melo) trivial : on change l'implémentation, pas le pipeline.

export type NormalizedListing = {
  source: string; // 'bienici' | 'pap' | 'leboncoin' | 'seloger' | 'melo'
  externalId: string; // id de l'annonce chez la source
  url: string;
  title: string | null;
  priceTotal: number | null; // loyer charges comprises (le comparable), en €
  rent: number | null; // hors charges si dispo
  charges: number | null;
  surface: number | null; // m²
  rooms: number | null;
  bedrooms: number | null;
  furnished: boolean | null;
  floor: number | null;
  dpe: string | null; // A..G
  postalCode: string | null;
  city: string | null;
  arrondissement: number | null; // 1..20 pour Paris
  lat: number | null;
  lng: number | null;
  photos: string[];
  isPro: boolean | null; // agence vs particulier
  description: string | null;
  postedAt: string | null; // ISO si dispo
  raw?: unknown; // payload brut (debug)
};

export interface Collector {
  key: string;
  /** Récupère un lot d'annonces normalisées. L'implémentation varie, le pipeline non. */
  fetchListings(opts?: { maxPages?: number }): Promise<NormalizedListing[]>;
}

/** 75001 → 1, 92100 → null (hors Paris). */
export function parisArrondissement(postalCode: string | null | undefined): number | null {
  if (!postalCode) return null;
  const m = /^75(\d{3})$/.exec(postalCode);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 20 ? n : null;
}
