import { chromium } from "playwright";
import { execFile } from "child_process";
import { promisify } from "util";
import { Collector, NormalizedListing, parisArrondissement } from "./types";
import { geocode } from "../lib/geocode";

const exec = promisify(execFile);

// Cache la fenêtre Chromium (équiv. Cmd+H). Nécessite la permission Accessibilité.
// Les flags anti-throttling (au lancement) évitent qu'App Nap ralentisse le JS DataDome.
async function hideChromium(): Promise<void> {
  try {
    await exec("osascript", [
      "-e",
      'tell application "System Events" to set visible of (every process whose name is "Chromium") to false',
    ]);
    console.log("[seloger] fenêtre masquée (osascript OK)");
  } catch (e) {
    console.log("[seloger] masquage refusé (Accessibilité manquante ?) :", (e as Error).message.slice(0, 80));
  }
}

// SeLoger : DataDome le plus agressif → curl ET headless bloqués ; seul un navigateur
// HEADFUL (fenêtre hors-écran) passe, par intermittence → retries. Local (Mac GUI) uniquement.
// Pas de géo dans la liste → on géocode le quartier (approx). Source « best effort », fragile.
const SEARCH = "https://www.seloger.com/immobilier/locations/immo-paris-75/bien-appartement/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Centroïdes approximatifs des arrondissements (fallback si le géocodage du quartier échoue).
const ARR_CENTROID: Record<number, [number, number]> = {
  1: [48.8626, 2.3363], 2: [48.8679, 2.3417], 3: [48.8637, 2.3615], 4: [48.8544, 2.3574],
  5: [48.8445, 2.3502], 6: [48.8496, 2.3339], 7: [48.8565, 2.3126], 8: [48.8726, 2.3122],
  9: [48.8769, 2.3378], 10: [48.8760, 2.3595], 11: [48.8594, 2.3765], 12: [48.8399, 2.3877],
  13: [48.8322, 2.3555], 14: [48.8331, 2.3264], 15: [48.8417, 2.2996], 16: [48.8637, 2.2769],
  17: [48.8872, 2.3076], 18: [48.8925, 2.3444], 19: [48.8817, 2.3822], 20: [48.8635, 2.3985],
};

type Raw = { href: string; text: string };

function num(re: RegExp, s: string): number | null {
  const m = s.match(re);
  return m ? Number(m[1].replace(/\s/g, "").replace(",", ".")) : null;
}

const geoCache = new Map<string, { lat: number; lng: number } | null>();

async function geoFor(neighborhood: string | null, zipcode: string | null, arr: number | null): Promise<{ lat: number | null; lng: number | null }> {
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

async function normalize(r: Raw): Promise<NormalizedListing | null> {
  const t = r.text;
  const idm = r.href.match(/(\d{6,})/);
  if (!idm) return null;
  const priceM = t.match(/([\d\s]+)\s*€\s*\/mois/);
  const price = priceM ? Number(priceM[1].replace(/\s/g, "")) : null;
  const dpeM = t.match(/([A-G])\d[\d\s]*€\s*\/mois/);
  const locM = t.match(/([\wÀ-ÿ'’.\- ]+?),\s*Paris\s+(\d+)(?:er|ème|e)?\s*arrondissement\s*\((\d{5})\)/);
  const neighborhood = locM ? locM[1].trim() : null;
  const zipcode = locM ? locM[3] : null;
  const arr = zipcode ? parisArrondissement(zipcode) : null;
  const g = await geoFor(neighborhood, zipcode, arr);

  return {
    source: "seloger",
    externalId: idm[1],
    url: r.href,
    title: neighborhood ? `Appartement ${neighborhood}` : "Appartement",
    priceTotal: price, // "charges comprises"
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
    isPro: true, // SeLoger = agences
    description: null,
    postedAt: null,
    raw: undefined,
  };
}

export const selogerCollector: Collector = {
  key: "seloger",
  async fetchListings({ maxPages = 1 }: { maxPages?: number } = {}) {
    const browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-position=10000,10000",
        // Empêche macOS/Chromium de throttler le JS quand la fenêtre est cachée/occultée.
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
    });
    try {
      const ctx = await browser.newContext({ userAgent: UA, locale: "fr-FR", viewport: { width: 1400, height: 900 } });
      const page = await ctx.newPage();
      await hideChromium(); // masque la fenêtre dès son apparition
      const raws: Raw[] = [];
      for (let pg = 1; pg <= maxPages; pg++) {
        const url = pg === 1 ? SEARCH : `${SEARCH}?LISTING-LISTpg=${pg}`;
        let ok = false;
        for (let i = 0; i < 4 && !ok; i++) {
          try {
            const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
            await page.waitForTimeout(9000);
            if (r?.status() === 200 && (await page.content()).length > 200000) ok = true;
            else await page.waitForTimeout(4000);
          } catch {
            await page.waitForTimeout(3000);
          }
        }
        if (!ok) break; // DataDome nous a bloqués ce coup-ci
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll("[data-testid='serp-core-classified-card-testid']")].map((el) => ({
            href: (el.querySelector("a[href*='.htm']") as HTMLAnchorElement | null)?.getAttribute("href")?.split("?")[0] || "",
            text: el.textContent!.replace(/\s+/g, " ").trim(),
          }))
        );
        raws.push(...cards.filter((c) => c.href));
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
