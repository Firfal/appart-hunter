import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { Collector, NormalizedListing, parisArrondissement } from "./types";

// API interne Leboncoin (non contractuelle), protégée par DataDome.
// Ne marche que depuis une IP RÉSIDENTIELLE (Mac de l'user), ET via curl :
// le fetch de Node est détecté par son empreinte TLS/JA3 → 403. curl passe.
const SEARCH = "https://api.leboncoin.fr/finder/search";
const API_KEY = "ba0c2dad52b3ec"; // clé web publique LBC (peut changer)
const exec = promisify(execFile);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function curl(args: string[]): Promise<string> {
  const { stdout } = await exec("curl", args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

const lbcUA = () =>
  `LBC;iOS;17.5;iPhone;phone;${crypto.randomUUID()};wifi;101.44.0`;

function attrMap(a: any): Record<string, string> {
  const m: Record<string, string> = {};
  for (const x of a.attributes ?? []) if (x.key) m[x.key] = x.value;
  return m;
}

function normalize(a: any): NormalizedListing {
  const loc = a.location ?? {};
  const at = attrMap(a);
  const zipcode: string | null = loc.zipcode ?? null;
  const price = Array.isArray(a.price) ? a.price[0] : a.price ?? null;
  const photos: string[] = a.images?.urls_large ?? a.images?.urls ?? [];
  return {
    source: "leboncoin",
    externalId: String(a.list_id),
    url: a.url ?? `https://www.leboncoin.fr/ad/locations/${a.list_id}`,
    title: a.subject ?? null,
    priceTotal: typeof price === "number" ? price : price ? Number(price) : null,
    rent: typeof price === "number" ? price : null,
    charges: at.charges ? Number(at.charges) : null,
    surface: at.square ? Number(at.square) : null,
    rooms: at.rooms ? Number(at.rooms) : null,
    bedrooms: at.bedrooms ? Number(at.bedrooms) : null,
    furnished: at.furnished === "1" ? true : at.furnished === "2" ? false : null,
    floor: at.floor_number ? Number(at.floor_number) : null,
    dpe: at.energy_rate ? at.energy_rate.toUpperCase() : null,
    postalCode: zipcode,
    city: loc.city ?? null,
    arrondissement: parisArrondissement(zipcode),
    lat: typeof loc.lat === "number" ? loc.lat : null,
    lng: typeof loc.lng === "number" ? loc.lng : null,
    photos: Array.isArray(photos) ? photos : [],
    isPro: a.owner?.type ? a.owner.type === "pro" : null,
    description: a.body ?? null,
    postedAt: a.first_publication_date ? a.first_publication_date.replace(" ", "T") : null,
    raw: undefined,
  };
}

export const leboncoinCollector: Collector = {
  key: "leboncoin",
  async fetchListings({ maxPages = 3 }: { maxPages?: number } = {}) {
    const jar = join(tmpdir(), `lbc_${crypto.randomUUID()}.txt`);
    // 1) Récupère le cookie DataDome.
    await curl([
      "-s", "-c", jar, "-o", "/dev/null", "--max-time", "20",
      "-A", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
      "https://www.leboncoin.fr/",
    ]);

    const out: NormalizedListing[] = [];
    const limit = 35;
    for (let page = 0; page < maxPages; page++) {
      const body = JSON.stringify({
        filters: {
          category: { id: "10" },
          enums: { real_estate_type: ["2"], ad_type: ["offer"] },
          location: { locations: [{ locationType: "department", department_id: "75" }] },
        },
        limit,
        offset: page * limit,
        sort_by: "time",
        sort_order: "desc",
      });
      const stdout = await curl([
        "-s", "-b", jar, "-c", jar, "--max-time", "25",
        "-A", lbcUA(),
        "-H", "Content-Type: application/json",
        "-H", `api_key: ${API_KEY}`,
        "-H", "Sec-Fetch-Dest: empty",
        "-H", "Sec-Fetch-Mode: cors",
        "-H", "Sec-Fetch-Site: same-site",
        "-X", "POST", SEARCH, "-d", body,
      ]);
      let data: any;
      try {
        data = JSON.parse(stdout);
      } catch {
        throw new Error(`leboncoin réponse non-JSON (DataDome ?) page ${page}: ${stdout.slice(0, 80)}`);
      }
      const ads = data.ads ?? [];
      if (ads.length === 0) break;
      out.push(...ads.map(normalize));
    }
    return out;
  },
};
