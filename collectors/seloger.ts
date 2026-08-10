import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { Collector, NormalizedListing, parisArrondissement } from "./types";
import { geocode } from "../lib/geocode";

chromium.use(stealth());

// SeLoger : DataDome agressif. Solution : Playwright HEADLESS + plugin stealth (aucune fenêtre)
// sur classified-search (respecte priceMax). Pagination via CLIC « page suivante » (les params
// d'URL sont ignorés ; c'est un SPA) après avoir retiré la bannière cookies qui bloque les clics.
// Pas de géo dans la liste → géocodage du quartier (BAN, cache) + fallback centroïde arrondissement.
const PARIS = "AD08FR31096"; // code localisation SeLoger pour Paris
const PRICE_MAX = 2500; // plafond de collecte (le budget par user affine ensuite)
const searchUrl = () =>
  `https://www.seloger.com/classified-search?distributionTypes=Rent&estateTypes=Apartment&locations=${PARIS}&priceMax=${PRICE_MAX}&sort=d_dt_crea`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ARR_CENTROID: Record<number, [number, number]> = {
  1: [48.8626, 2.3363], 2: [48.8679, 2.3417], 3: [48.8637, 2.3615], 4: [48.8544, 2.3574],
  5: [48.8445, 2.3502], 6: [48.8496, 2.3339], 7: [48.8565, 2.3126], 8: [48.8726, 2.3122],
  9: [48.8769, 2.3378], 10: [48.8760, 2.3595], 11: [48.8594, 2.3765], 12: [48.8399, 2.3877],
  13: [48.8322, 2.3555], 14: [48.8331, 2.3264], 15: [48.8417, 2.2996], 16: [48.8637, 2.2769],
  17: [48.8872, 2.3076], 18: [48.8925, 2.3444], 19: [48.8817, 2.3822], 20: [48.8635, 2.3985],
};

type Raw = { href: string; text: string };
const geoCache = new Map<string, { lat: number; lng: number } | null>();

async function geoFor(neighborhood: string | null, zipcode: string | null, arr: number | null) {
  const key = `${neighborhood ?? ""}|${zipcode ?? ""}`;
  if (neighborhood && !geoCache.has(key)) {
    try {
      const res = await geocode(`${neighborhood} ${zipcode ?? "Paris"}`);
      const hit = res.find((r) => !zipcode || r.label.includes(zipcode)) ?? res[0];
      geoCache.set(key, hit ? { lat: hit.lat, lng: hit.lng } : null);
    } catch {
      geoCache.set(key, null);
    }
  }
  const g = neighborhood ? geoCache.get(key) : null;
  if (g) return g;
  if (arr && ARR_CENTROID[arr]) return { lat: ARR_CENTROID[arr][0], lng: ARR_CENTROID[arr][1] };
  return { lat: null, lng: null };
}

function num(re: RegExp, s: string): number | null {
  const m = s.match(re);
  return m ? Number(m[1].replace(/\s/g, "").replace(",", ".")) : null;
}

async function normalize(r: Raw): Promise<NormalizedListing | null> {
  const t = r.text;
  // ID = dernier segment de l'URL (gère les 2 formats : 276136659.htm ancien, 26SQ7BJKWMAA nouveau,
  // et bellesdemeures .../{id}/detail.htm).
  const segs = r.href.split(/[?#]/)[0].split("/").filter(Boolean);
  let externalId = (segs.pop() || "").replace(/\.htm$/, "");
  if (externalId === "detail" || !externalId) externalId = segs.pop() || "";
  if (!externalId) return null;
  const priceM = t.match(/([\d\s]+)\s*€\s*\/mois/);
  let price = priceM ? Number(priceM[1].replace(/\s/g, "")) : null;
  // Garde-fou : un loyer > 6000 €/mois = quasi toujours une erreur de parsing
  // (prix de vente ou pub qui fuite dans le texte de la carte) → on écarte.
  if (price != null && (price > 6000 || price < 150)) price = null;
  if (price == null) return null;
  const dpeM = t.match(/([A-G])\d[\d\s]*€\s*\/mois/);
  const locM = t.match(/([\wÀ-ÿ'’.\- ]+?),\s*Paris\s+(\d+)(?:er|ème|e)?\s*arrondissement\s*\((\d{5})\)/);
  const neighborhood = locM ? locM[1].trim() : null;
  const zipcode = locM ? locM[3] : null;
  const arr = zipcode ? parisArrondissement(zipcode) : null;
  const g = await geoFor(neighborhood, zipcode, arr);
  return {
    source: "seloger",
    externalId,
    url: r.href,
    title: neighborhood ? `Appartement ${neighborhood}` : "Appartement",
    priceTotal: price,
    rent: price,
    charges: null,
    surface: num(/([\d,]+)\s*m²/, t),
    rooms: num(/(\d+)\s*pièces?/, t),
    bedrooms: num(/(\d+)\s*chambres?/, t),
    furnished: /meubl/i.test(t) ? true : null,
    floor: num(/Étage\s*(\d+)/, t) ?? num(/(\d+)(?:er|ème|e)?\s*étage/i, t),
    dpe: dpeM ? dpeM[1] : null,
    postalCode: zipcode,
    city: "Paris",
    arrondissement: arr,
    lat: g.lat,
    lng: g.lng,
    photos: [],
    isPro: true,
    description: null,
    postedAt: null,
    raw: undefined,
  };
}

export const selogerCollector: Collector = {
  key: "seloger",
  async fetchListings({ maxPages = 15 }: { maxPages?: number } = {}) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await (await browser.newContext({ userAgent: UA, locale: "fr-FR", viewport: { width: 1400, height: 1000 } })).newPage();

      // Chargement page 1 (avec retries DataDome).
      let ok = false;
      for (let i = 0; i < 4 && !ok; i++) {
        try {
          const r = await page.goto(searchUrl(), { waitUntil: "domcontentloaded", timeout: 40000 });
          await page.waitForTimeout(8000);
          const html = await page.content();
          if (r?.status() === 200 && html.length > 150000 && !/datadome|geo\.captcha/i.test(html)) ok = true;
          else await page.waitForTimeout(3000);
        } catch {
          await page.waitForTimeout(3000);
        }
      }
      if (!ok) return [];
      // Retire la bannière cookies qui intercepte les clics de pagination.
      await page.evaluate(() => document.getElementById("usercentrics-root")?.remove());

      const scrapeCards = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("[data-testid='serp-core-classified-card-testid']")].map((el) => ({
            // SeLoger a 2 formats de lien : /annonces/…-{id}.htm (ancien) et /annonce/…/{ID} (nouveau, sans .htm).
            href: (el.querySelector("a[href*='/annonce'], a[href*='.htm']") as HTMLAnchorElement | null)?.getAttribute("href")?.split("?")[0] || "",
            text: el.textContent!.replace(/\s+/g, " ").trim(),
          }))
        );

      const raws: Raw[] = [];
      const seen = new Set<string>();
      for (let pg = 1; pg <= maxPages; pg++) {
        for (const c of await scrapeCards()) if (c.href && !seen.has(c.href)) { seen.add(c.href); raws.push(c); }
        if (pg >= maxPages) break;
        // Clic « page suivante » via JS (le bouton est en bas d'une longue liste → le .click()
        // de Playwright timeout sur la visibilité ; un click() JS marche quelle que soit la position).
        const clicked = await page.evaluate(() => {
          const btn = document.querySelector("button[aria-label='page suivante']") as HTMLButtonElement | null;
          if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
          btn.click();
          return true;
        });
        if (!clicked) break;
        await page.waitForResponse((r) => /serp-bff\/search(\?|$)/.test(r.url()), { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3500);
      }

      const out: NormalizedListing[] = [];
      for (const r of raws) {
        const n = await normalize(r);
        if (n && n.externalId) out.push(n);
      }
      return out;
    } finally {
      await browser.close();
    }
  },
};
