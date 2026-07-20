import { Collector, NormalizedListing, parisArrondissement } from "./types";

// Bien'ici expose une API JSON publique (pas d'anti-bot). Paris = zoneId "-71525".
const BASE = "https://www.bienici.com/realEstateAds.json";
const PARIS_ZONE = "-71525";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildUrl(page: number, size: number) {
  const filters = {
    size,
    from: (page - 1) * size,
    filterType: "rent",
    propertyType: ["house", "flat", "loft", "castle", "townhouse"],
    page,
    sortBy: "publicationDate", // le plus récent d'abord → « être le premier »
    sortOrder: "desc",
    onTheMarket: [true],
    zoneIdsByTypes: { zoneIds: [PARIS_ZONE] },
  };
  const qs = new URLSearchParams({
    filters: JSON.stringify(filters),
    extensionType: "extendedIfNoResult",
  });
  return `${BASE}?${qs.toString()}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(ad: any): NormalizedListing {
  const postalCode: string | null = ad.postalCode ?? null;
  const photos: string[] = Array.isArray(ad.photos)
    ? ad.photos.map((p: any) => p?.url ?? p?.url_photo ?? p).filter((u: any): u is string => typeof u === "string")
    : [];
  // Bien'ici floute parfois la position exacte → on prend ce qui est dispo.
  const pos = ad.blurInfo?.position ?? ad.position ?? {};
  const lat = pos.lat ?? pos.latitude ?? null;
  const lng = pos.lon ?? pos.lng ?? pos.longitude ?? null;

  const rent: number | null = typeof ad.price === "number" ? ad.price : null;
  const charges: number | null = typeof ad.charges === "number" ? ad.charges : null;
  // price Bien'ici = loyer affiché ; si charges séparées non incluses, on les ajoute.
  const chargesIncluded = ad.chargesIncludedInRent ?? true;
  const priceTotal =
    rent == null ? null : chargesIncluded || charges == null ? rent : rent + charges;

  return {
    source: "bienici",
    externalId: String(ad.id),
    url: `https://www.bienici.com/annonce/${ad.id}`,
    title: ad.title || null,
    priceTotal,
    rent,
    charges,
    surface: typeof ad.surfaceArea === "number" ? ad.surfaceArea : null,
    rooms: ad.roomsQuantity ?? null,
    bedrooms: ad.bedroomsQuantity ?? null,
    furnished: ad.isFurnished ?? null,
    floor: ad.floor ?? null,
    dpe: ad.energyClassification ?? null,
    postalCode,
    city: ad.city ?? null,
    arrondissement: parisArrondissement(postalCode),
    lat,
    lng,
    photos,
    isPro: ad.accountType ? ad.accountType !== "individual" : ad.adCreatedByPro ?? null,
    description: ad.description ?? null,
    postedAt: ad.publicationDate ?? null,
    raw: ad,
  };
}

export const bieniciCollector: Collector = {
  key: "bienici",
  async fetchListings({ maxPages = 2 }: { maxPages?: number } = {}) {
    const size = 24;
    const out: NormalizedListing[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(buildUrl(page, size), {
        headers: { "User-Agent": UA, Referer: "https://www.bienici.com/", Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`bienici HTTP ${res.status} page ${page}`);
      const data = await res.json();
      const ads = data.realEstateAds ?? [];
      if (ads.length === 0) break;
      out.push(...ads.map(normalize));
    }
    return out;
  },
};
