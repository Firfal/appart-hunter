import { createHash } from "crypto";
import type { NormalizedListing } from "../collectors/types";

/** Empreinte du CONTENU mutable → détecte qu'une annonce a changé (re-scoring). */
export function contentHash(l: NormalizedListing): string {
  const s = [l.priceTotal, l.surface, l.rooms, l.furnished, l.dpe, l.floor].join("|");
  return createHash("sha1").update(s).digest("hex");
}

/** Clé de dédup INTER-sources : signaux stables normalisés (même appart posté ailleurs). */
export function dedupKey(l: NormalizedListing): string {
  const s = [
    l.arrondissement ?? l.postalCode ?? "?",
    l.surface != null ? Math.round(l.surface) : "?",
    l.priceTotal != null ? Math.round(l.priceTotal / 10) * 10 : "?",
    l.rooms ?? "?",
    l.floor ?? "?",
  ].join("|");
  return createHash("sha1").update(s).digest("hex");
}
