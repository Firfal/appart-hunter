// Formule de scoring (pure, testable). Voir PLAN.md §5.
// Filtres durs d'abord (budget/surface/pièces/zone + trajet hard) → exclu si non respecté.
// Score 0-100 = 0.40 trajet + 0.30 prix + 0.20 fraîcheur + 0.10 base, × malus arnaque.

export type Target = {
  label: string;
  weight: number;
  maxCommuteMin: number;
  hard: boolean;
};

export type ScoringListing = {
  priceTotal: number | null;
  surface: number | null;
  rooms: number | null;
  furnished: boolean | null;
  dpe: string | null;
  arrondissement: number | null;
  firstSeenMs: number | null;
};

export type SearchCriteria = {
  budgetMin: number | null; // loyer CC min (null = pas de plancher)
  budgetMax: number | null;
  surfaceMin: number | null;
  roomsMin: number | null;
  furnished: boolean | null; // null = indifférent
  arrondissements: number[] | null; // null/[] = toutes
};

export type ScoreInput = {
  listing: ScoringListing;
  criteria: SearchCriteria;
  targets: Target[];
  commuteByTarget: Record<string, number | null>; // label -> minutes (null = non calculable)
  medianPpm2: number | null; // médiane marché du quartier
  fraudFlags: string[];
  nowMs: number;
};

export type ScoreResult = {
  passesHard: boolean;
  reason?: string; // pourquoi éliminé
  score: number; // 0-100
  pricePerM2: number | null;
  priceGapPct: number | null;
  breakdown: { trajet: number; prix: number; fraicheur: number; base: number; mArnaque: number };
};

const WEIGHTS = { trajet: 0.4, prix: 0.3, fraicheur: 0.2, base: 0.1 };

const FRAUD_MULT: Record<string, number> = {
  prix_trop_bas: 0.4,
  paiement_avant_visite: 0.3,
  contact_hors_plateforme: 0.5,
  photos_reutilisees: 0.4,
  sans_photo: 0.7,
  incoherence: 0.6,
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function scoreListing(input: ScoreInput): ScoreResult {
  const { listing: l, criteria: c, targets, commuteByTarget, medianPpm2, fraudFlags, nowMs } = input;

  const empty: ScoreResult["breakdown"] = { trajet: 0, prix: 0, fraicheur: 0, base: 0, mArnaque: 1 };
  const fail = (reason: string): ScoreResult => ({
    passesHard: false,
    reason,
    score: 0,
    pricePerM2: l.surface ? (l.priceTotal ?? 0) / l.surface : null,
    priceGapPct: null,
    breakdown: empty,
  });

  // ---- Filtres durs ----
  if (c.budgetMin != null && l.priceTotal != null && l.priceTotal < c.budgetMin) return fail("sous le budget min");
  if (c.budgetMax != null && l.priceTotal != null && l.priceTotal > c.budgetMax) return fail("hors budget");
  if (c.surfaceMin != null && l.surface != null && l.surface < c.surfaceMin) return fail("surface < min");
  if (c.roomsMin != null && l.rooms != null && l.rooms < c.roomsMin) return fail("pièces < min");
  if (c.furnished != null && l.furnished != null && l.furnished !== c.furnished) return fail("meublé non conforme");
  if (c.arrondissements && c.arrondissements.length > 0 && l.arrondissement != null && !c.arrondissements.includes(l.arrondissement))
    return fail("hors zone");

  // Filtre dur trajet par cible (hard = true)
  for (const t of targets) {
    if (!t.hard) continue;
    const cm = commuteByTarget[t.label];
    if (cm == null) return fail(`trajet ${t.label} non calculable (cible obligatoire)`);
    if (cm > t.maxCommuteMin) return fail(`trajet ${t.label} > ${t.maxCommuteMin} min`);
  }

  // ---- s_trajet : moyenne pondérée des sous-scores par cible ----
  let sumW = 0;
  let sumWS = 0;
  for (const t of targets) {
    const cm = commuteByTarget[t.label];
    if (cm == null) continue; // cible non-hard non calculable → ignorée
    const s = clamp01(1 - Math.pow(cm / t.maxCommuteMin, 1.3));
    sumW += t.weight;
    sumWS += t.weight * s;
  }
  const sTrajet = sumW > 0 ? (sumWS / sumW) * 100 : 50; // pas de cible → neutre

  // ---- s_prix : vs médiane marché ----
  const ppm2 = l.surface && l.priceTotal != null ? l.priceTotal / l.surface : null;
  let sPrix = 50;
  let gapPct: number | null = null;
  if (ppm2 != null && medianPpm2 != null && medianPpm2 > 0) {
    gapPct = (medianPpm2 - ppm2) / medianPpm2; // >0 = moins cher que le marché
    sPrix = clamp01(0.5 + gapPct / 0.6) * 100;
  }

  // ---- s_fraicheur : demi-vie 12h ----
  let sFraicheur = 50;
  if (l.firstSeenMs != null) {
    const ageH = Math.max(0, (nowMs - l.firstSeenMs) / 3_600_000);
    sFraicheur = 100 * Math.pow(0.5, ageH / 12);
  }

  // ---- s_base : marge budget + DPE ----
  let base = 50;
  if (c.budgetMax && l.priceTotal != null) base = clamp01((c.budgetMax - l.priceTotal) / c.budgetMax) * 60 + 20;
  if (l.dpe && ["A", "B", "C"].includes(l.dpe)) base = Math.min(100, base + 15);
  if (l.dpe && ["F", "G"].includes(l.dpe)) base = Math.max(0, base - 15);

  // ---- m_arnaque ----
  let mArnaque = 1;
  for (const f of fraudFlags) mArnaque *= FRAUD_MULT[f] ?? 1;
  mArnaque = Math.max(0.1, mArnaque);

  const raw = WEIGHTS.trajet * sTrajet + WEIGHTS.prix * sPrix + WEIGHTS.fraicheur * sFraicheur + WEIGHTS.base * base;
  const score = Math.round(raw * mArnaque * 100) / 100;

  return {
    passesHard: true,
    score,
    pricePerM2: ppm2 != null ? Math.round(ppm2 * 100) / 100 : null,
    priceGapPct: gapPct != null ? Math.round(gapPct * 1000) / 10 : null,
    breakdown: {
      trajet: Math.round(sTrajet),
      prix: Math.round(sPrix),
      fraicheur: Math.round(sFraicheur),
      base: Math.round(base),
      mArnaque: Math.round(mArnaque * 100) / 100,
    },
  };
}
