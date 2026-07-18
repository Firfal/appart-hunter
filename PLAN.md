# Chasseur d'appart Paris — Plan produit & technique

> **Version enrichie (raffinage ultraplan, juillet 2026).** Les 5 « points ouverts »
> (sources, API trajet, collecte gratuite, modèle de données, scoring) sont désormais
> **tranchés** avec une recommandation unique par point, un schéma SQL prêt à exécuter et
> une Phase 0 implémentable directement. Chaque recommandation s'appuie sur une recherche
> factuelle 2025-2026 (sources citées en fin de section).

## ⚠️ Mise à jour stack (Phase 0 — juillet 2026)

Décision prise au démarrage, **révise la stack ci-dessous** :
- **Backend = Firebase** (Firestore + Auth + Storage), **pas Supabase** — choix de familiarité,
  budget ~5-10 €/mois accepté. Conséquences assumées : la **géo passe en code** (geohash + turf.js
  + Cloud Functions au lieu de PostGIS), et le **schéma SQL §4 devient des collections Firestore +
  security rules** (voir `firestore.rules`). Le §4 reste la référence du **modèle de domaine**.
- **Front = Next.js sur Firebase App Hosting** (pas Vercel) — tout dans un seul écosystème
  Google, une seule facturation, pas de double maintenance. Nécessite le plan **Blaze**.
  Déploiement continu depuis le repo GitHub (privé), config via `apphosting.yaml`.
- **Collecte = Cloud Run Jobs + Cloud Scheduler, cron toutes les 5 min mais coupé la nuit**
  (`*/5 9-19 * * *`, Europe/Paris) — rien ne se poste la nuit → ~10 h/j, repasse ~sous le free tier.
  Jobs courts (≤30 s) pour rester bas. Priorité explicite : **être le premier sur chaque offre**.
- **Idée future à garder** : quand un onglet de l'app est ouvert, faire du **scraping côté client**
  (vrai navigateur = IP résidentielle + fingerprint réels → contourne mieux DataDome, décharge le
  serveur). Complément au scraping serveur, pas remplacement.

## Contexte

L'utilisateur cherche un appartement en location à **Paris / Île-de-France**, un marché
ultra-tendu où les bonnes annonces partent en quelques heures. Objectif en **deux temps** :
1. **Se loger** — un outil qui lui fait gagner la course.
2. **Commercialiser** — en faire un produit SaaS pour d'autres locataires parisiens.

L'app doit résoudre trois douleurs concrètes ressenties dans sa propre recherche :
- **Éparpillement** — devoir surveiller 5-6 sites en boucle.
- **Vitesse** — les bons apparts sont pris avant de réagir.
- **Tri rapide** — savoir en ~10s si une annonce vaut le coup (trajet réel, vrai prix, arnaque).
- (support) **Dossier** — parfois les bailleurs demandent des infos au-delà du lien DossierFacile.

On part de **zéro** (aucune base de code existante ; le dépôt actuel n'est que le dossier perso).

## Vision produit (une phrase)

> Un **dashboard web** qui agrège en quasi-temps-réel les annonces de location Paris/IDF de
> plusieurs sources, les **dédoublonne**, les **note selon les critères de chaque utilisateur**
> (surtout : temps de trajet réel + « ça vaut le coup ou pas »), **alerte vite**, et aide à
> **gérer le dossier** locatif.

## Décisions verrouillées

| Sujet | Choix |
|---|---|
| Marché | Paris / Île-de-France |
| Cœur produit | Collecte → Tri/scoring → Alerte (dossier en support) |
| Collecte | **Hybride** : scraping maison d'abord (gratuit, perso), puis API licenciée (ex: Melo) pour commercialiser |
| Forme | App web (dashboard) |
| Périmètre | **Multi-utilisateurs dès le départ** (auth, critères par user) |
| Hébergement | **Gratuit** |

---

# ⚡ Décisions tranchées sur les points ouverts

Résumé exécutif — le détail et les justifications suivent dans les sections dédiées.

| # | Point ouvert | **Décision tranchée** | Pourquoi en une ligne |
|---|---|---|---|
| 1 | 1re source à scraper | **PAP.fr** → **Bien'ici** → Leboncoin (API mobile) → SeLoger | PAP sans DataDome ; Bien'ici a une **API JSON** stable ; Leboncoin/SeLoger = DataDome, en dernier |
| 2 | API temps de trajet | **PRIM / Île-de-France Mobilités** (moteur Navitia) | Gratuit, **20 000 req/jour**, données IDFM natives, `apikey` en header |
| 3 | Collecte gratuite | **Cloud Run Jobs + Cloud Scheduler** (cron fiable ~15 min) ; GitHub Actions pour proto/fallback | La **vitesse** est le produit → cron ponctuel requis ; free tier permanent GCP |
| 4 | Modèle de données | Schéma ci-dessous, dédup **2 niveaux** (`content_hash` intra + `dedup_key`/`listing_groups` inter-sources) | RLS multi-tenant : pool `listings` partagé, dérivés user isolés |
| 5 | Scoring | Formule 0-100 pondérée **trajet 40 / prix-marché 30 / fraîcheur 20 / base 10**, ×malus anti-arnaque | Le trajet transit domine, l'arnaque agit en multiplicateur |

---

# 1. SOURCES — quelle première source scraper ?

## ✅ Décision : **démarrer par PAP.fr**, puis **Bien'ici**, puis Leboncoin (API mobile), puis SeLoger.

**Pourquoi PAP en premier.** C'est **la seule des trois sans DataDome**. Portail 100 %
particuliers, protections légères (rate-limit IP, éventuel reCAPTCHA en volume), scrapable
avec un **Playwright standard** — voire de simples requêtes HTTP. Site Next.js → le JSON complet
des annonces est dans `__NEXT_DATA__` / `self.__next_f.push()` du HTML (parsing trivial, robuste
aux redesigns visuels). C'est le **meilleur ratio valeur/effort pour prouver la chaîne complète**
(fetch → parse → normalise → dédup → stocke → score → alerte) sans se battre contre un anti-bot ML
dès le jour 1. Bonus : PAP est historiquement fort sur Paris/proche banlieue et 100 % particuliers,
donc des annonces exclusives pertinentes.

**Ordre d'ajout ensuite (logique : fiabilité d'abord, volume ensuite, coriace en dernier) :**

1. **PAP.fr** — MVP. Dérisque tout le pipeline sur une source qui ne se bat pas contre vous.
2. **Bien'ici** — SPA Angular **mais API JSON publique** (prix, €/m², DPE, GPS structurés) → bien
   plus **stable** qu'un scrape DOM et **sans DataDome**. Stock surtout agences (cap ~2500/recherche),
   mais c'est le meilleur « 2e » : gros gain de volume pour un effort faible et robuste.
3. **Leboncoin via API mobile non-officielle** — le **plus gros volume** (>1 M annonces,
   ~20 % PDM location IDF). L'API JSON mobile est plus tractable que le site web (protégé
   DataDome), **à condition** d'ajouter TLS-impersonation + proxies résidentiels FR. Fragile.
4. **SeLoger** (groupe Aviv) — **leader volume IDF (~33 % PDM, réseau agences)** donc très désirable,
   mais **le plus cher à scraper** : DataDome agressif, boucles de captcha, pas d'API mobile propre.
   À n'attaquer qu'une fois l'infra anti-DataDome rodée sur Leboncoin (elle se réutilise).

## Comparatif technique

| Critère | **PAP.fr** | **Leboncoin** | **SeLoger** (Aviv) |
|---|---|---|---|
| **Anti-bot** | ✅ Pas de DataDome ; rate-limit léger | ❌ **DataDome** (partenaire 7+ ans, ~9,5 M req malveillantes bloquées/j, 30 endpoints web+mobile) | ❌ **DataDome** agressif, captcha en boucle |
| **Difficulté Playwright** | ✅ Faible | ⚠️ Élevée sur le web (fingerprint/JA3 détectés) — **contourner via l'API mobile** | ❌ Élevée, instable |
| **Données structurées** | 🟠 `__NEXT_DATA__` (JSON dans HTML) | ✅ API mobile = **JSON direct** (`ads[]`) ; web = `props.pageProps.searchData.ads` | ✅ JSON présent mais **verrouillé** par DataDome |
| **Volume IDF** | 🟠 Faible mais Paris-centré, particuliers | ✅ Élevé (particuliers) | ✅ Élevé (agences) |
| **Risque légal** | 🟠 Droit BDD applicable | 🟠 + **précédent LBC agressif** | ❌ Aviv juridiquement agressif |
| **Priorité** | **1** | **2** | **3** |

## Leboncoin — API mobile non-officielle (pour la Phase 5, pas le MVP)

Faisable et documentée. Client de référence à jour : **`etienne-hd/lbc`** (GitHub, maintenu 2026).
- **Endpoint** : `POST https://api.leboncoin.fr/finder/search`
- **Payload** : JSON `{ filters: { category, location/départements, price, real_estate_type… }, limit, offset }` → réponse **JSON direct** (`ads[]`), pas de HTML.
- **Ce qui fait passer / bloquer DataDome** :
  - **User-Agent applicatif** propriétaire : `LBC;iOS;18.6;iPhone;phone;<uuid4>;wifi;101.44.0` (variante Android : `LBC;Android;13;Pixel 7;phone;<hex16>;wifi;100.85.2`). Randomiser OS/version/modèle/app_version.
  - **TLS impersonation obligatoire** (`curl_cffi` `impersonate=safari_ios/chrome_android`) — un client Python/Node nu est démasqué par sa signature JA3.
  - **Init cookies** : `GET https://www.leboncoin.fr/` d'abord (récupère le cookie DataDome), puis l'API.
  - Headers `Sec-Fetch-Dest: empty`, `Sec-Fetch-Mode: cors`, `Sec-Fetch-Site: same-site`.
  - **Proxies résidentiels FR** recommandés (IP datacenter filtrées).
- **Fragilité assumée** : `403` = blocage DataDome (baisser fréquence, rotation UA/proxy). DataDome
  a ajouté en 2025 la **détection par intention** (pattern de navigation) → randomiser délais et
  pagination. API interne non contractuelle → **isoler derrière l'interface `Collector`** pour la
  désactiver/remplacer vite. Ne pas partir de `tdurieux/leboncoin-api` (déprécié, tout bloqué).

## ⚠️ Cadre légal — à intégrer dès le design (pas juste avant la vente)

- **Le scraping n'est pas illégal en soi.** Ce qui est sanctionné = l'**extraction/réutilisation
  d'une partie substantielle, de façon répétée et systématique**, d'une base protégée (droit
  *sui generis* du producteur de BDD, art. L.341-1 / L.342-1 CPI).
- **Précédent direct et défavorable** : *CA Paris, 2 fév. 2021, n° 17/17688, Leboncoin c/
  Entreparticuliers* — extraction systématique de la base immo condamnée (**50 000 €** + cessation
  sous astreinte). Un agrégateur **commercial** qui **republie l'intégralité** des annonces tombe
  précisément dans ce cas.
- **Parade produit (adopter dès le MVP)** : modèle **« index + lien profond »** à la Google —
  stocker/afficher un **résumé** (prix, surface, quartier, 1re photo, score) + **lien vers la source**,
  **pas** la copie intégrale ni les **coordonnées perso** de l'annonceur (téléphone/nom/email).
- **RGPD/CNIL** : les annonces contiennent des données personnelles. Dès que vous **stockez** des
  coordonnées → traitement nécessitant base légale + information + opt-out. **Ne stockez pas les
  coordonnées** au MVP (le lien vers l'annonce suffit).
- **Avant commercialisation (Phase 6)** : bascule vers **source licenciée (Melo)** + revue CGU/RGPD
  par un juriste. Verrouillé, non négociable.

<sub>Sources : DataDome customer story (leboncoin) ; Scrapfly « How to Scrape Leboncoin/SeLoger 2026 » ;
github.com/etienne-hd/lbc ; CMS Law « Arrêt Leboncoin / droit sui generis » ; Leto.legal « Web scraping RGPD » ;
Pretto/Manda (parts de marché IDF).</sub>

---

# 2. TRAJET — quelle API pour le temps de trajet en transports ?

## ✅ Décision : **PRIM / Île-de-France Mobilités** (API Calculateur, moteur Navitia). Google Routes en plan B.

**Pourquoi PRIM.** C'est **le même moteur Navitia** que l'offre payante navitia.io, mais **hébergé
gratuitement par IDFM**, pré-chargé avec **toutes les données IDF** (métro, RER, Transilien, bus,
tram) + temps réel, avec un quota **très large : 20 000 requêtes/jour**. Votre pattern
**pré-calcul + cache** (volume = nb annonces neuves × nb profils, pas par pageview) y rentre
confortablement. Intégration REST simple.

- **Auth** : compte sur le portail PRIM → générer un jeton → header HTTP `apikey: <JETON>`.
- **Endpoint itinéraire** :
  `GET https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys?from=<lon>;<lat>&to=<lon>;<lat>&datetime=<YYYYMMDDTHHMMSS>`
- **Réponse** : JSON Navitia → `journeys[0].duration` (secondes), `nb_transfers`, `sections[]`.
- **Quota** : 20 000/j (relevable sur demande via « Ma consommation API »). Note : les comptes créés
  après le 13 mars 2024 ont des quotas par défaut plus bas → à relever au portail si besoin.

**Comparatif :**

| API | Gratuit | Quota gratuit | Précision IDF | Intégration | Verdict |
|---|---|---|---|---|---|
| **PRIM (Navitia IDFM)** | Oui | **20 000/jour** | Excellente (données IDFM + temps réel) | REST, header `apikey` | ✅ **Choix 1** |
| Google Routes (transit) | Partiel | ~5 000/mois puis ~10 $/1000 | Excellente | Très simple | 🥈 Plan B |
| navitia.io public | Partiel | 5 000/**mois** puis 49 €/mois | Bonne (même moteur) | REST | ❌ dominé par PRIM |
| OTP self-hosted | Oui | Illimité | Bonne (si branché SIRI) | Lourd (ops) | Réserve grande échelle |

**À savoir sur Google (2025) :** le crédit récurrent de **200 $/mois a été supprimé le 1er mars 2025**,
remplacé par des quotas gratuits par produit (~5 000 appels/mois pour le transit via la **Routes API**
`computeRoutes`, la Directions API étant passée « legacy »). Correct en **fallback qualité**, mais
économiquement dominé par PRIM sur l'IDF, et exige carte bancaire dès le départ.

**Stratégie d'intégration (importante pour tenir les quotas)** :
- **Cacher** le résultat par **(géo annonce arrondie × adresse cible du profil)** dans une table
  `commute_times` — deux profils visant le même lieu de travail partagent le cache.
- Calculer sur un `datetime` **standardisé** (ex. prochain mardi 9h00) pour un temps de trajet
  « heure de pointe » stable et comparable entre annonces.
- **Fallback** : si PRIM ne renvoie pas d'itinéraire (adresse hors réseau, erreur), tenter Google
  Routes, sinon stocker `NULL` (l'annonce reste scorée sur les autres critères, trajet neutralisé).

<sub>Sources : prim.iledefrance-mobilites.fr (fiche API Navitia v2, génération de jeton, playground) ;
doc.navitia.io ; developers.google.com/maps (changements mars 2025, Routes API billing).</sub>

---

# 3. COLLECTE GRATUITE — le montage cron GitHub Actions + Playwright tient-il ?

## ✅ Décision : **Google Cloud Run Jobs + Cloud Scheduler** en primaire (cron fiable ~5-10 min). GitHub Actions gardé comme démarrage rapide / fallback.

**Pourquoi Cloud Run et pas GitHub Actions.** Le produit vend la **vitesse** (« être le premier à
contacter »). Or le cron GitHub Actions **dérive de 20-90 min et saute des runs** → incompatible avec
« premier arrivé ». **Cloud Run Jobs + Cloud Scheduler** donne un cron **précis et fiable** (~5-10 min),
un **vrai container Playwright**, et reste **gratuit** dans le free tier permanent : **180 000 vCPU-s/mois**
(~50 h CPU), Scheduler 3 jobs gratuits (il en faut 1). Calcul : toutes les 10 min = 4 320 runs × ~60 s ×
1 vCPU = ~259 200 vCPU-s → **au-dessus des 180 000** → viser **toutes les 15 min** (~172 800 vCPU-s, ça passe)
ou raccourcir les jobs. Piège : compte GCP avec CB (mais free tier réel, pas un crédit d'essai) + image Docker.

**GitHub Actions reste utile** pour **prototyper le collecteur** en Phase 0/1 (zéro infra) avant de
conteneuriser, et comme **fallback** gratuit. Son montage détaillé (dépôt public, keepalive,
idempotence) est documenté ci-dessous car les mêmes garde-fous s'appliquent à Cloud Run.

Le montage **cron + Playwright + Supabase fonctionne et reste 100 % gratuit** ; sur GitHub Actions
c'est **seulement sur dépôt PUBLIC** et en acceptant une cadence **« best effort »**.

### Ce qui est vrai (faits chiffrés 2025-2026)

- **Dépôt public** = **minutes illimitées et gratuites** sur runners standard. **Dépôt privé (Free)**
  = seulement **2 000 min Linux/mois** → **insuffisant** : un scrape toutes les 30 min = ~1 440 runs ×
  ~2-3 min (setup Playwright inclus) ≈ **4 000 min/mois > 2 000**. **→ Le dépôt DOIT être public.**
- **Playwright tourne bien** sur runner Ubuntu (Chromium headless). Setup
  `npx playwright install chromium --with-deps` ≈ 1-3,5 min/run (cachable).
- **Le cron GitHub n'est PAS ponctuel** : retards routiniers de **5-30 min** (parfois >60 min aux
  pics), exécutions **silencieusement sautées** quand la file des runners est saturée. Pire au top
  de l'heure → **planifier à une minute décalée** (ex. `13,43 * * * *`).
- **Désactivation après 60 jours sans commit — CONFIRMÉ.** GitHub désactive un workflow planifié si
  le dépôt n'a **aucun commit** pendant 60 j (les runs du cron ne comptent pas). **Parade : keepalive**
  (`gautamkrishnar/keepalive-workflow`, commit trivial mensuel).

### Conséquences de conception (obligatoires)

1. **Split 2 dépôts** : un repo **collecteur PUBLIC** (minutes Actions illimitées, code de scraping
   isolé) + le repo **app PRIVÉ** (Next.js). Évite d'exposer l'app, découple la bascule Melo.
   ⚠️ Aucun secret dans le repo public : clés Supabase `service_role`/PRIM en **GitHub Secrets**.
2. **Keepalive workflow** anti-désactivation 60 j.
3. **Idempotence** : chaque run fait un **`upsert` par (source, external_id)** → absorbe les runs
   sautés **et** doublés sans créer de doublons.
4. **Écrire via `supabase-js` (API REST) ou le pooler**, **jamais** en connexion Postgres directe
   (le free tier limite les connexions directes).
5. Cron décalé, ex. `*/15` → en pratique préférer `7,22,37,52 * * * *`.

### Plan B fiable : **Google Cloud Run Jobs + Cloud Scheduler**

Si la dérive/les skips du cron GitHub deviennent gênants : free tier **permanent** (n'expire jamais)
**180 000 vCPU-s/mois** (~50 h CPU) + Cloud Scheduler (3 jobs gratuits, il en faut 1). Playwright dans
un **container Docker** custom, **cron précis et fiable**. Calcul : 30 min → ~86 400 vCPU-s (large
marge) ; 15 min → ~172 800 vCPU-s (passe, mais serré → jobs courts, 1 vCPU). Piège : compte GCP avec
CB (mais free tier réel, pas un crédit d'essai).

### À éviter pour ce besoin

- **Supabase Edge Functions + pg_cron** : Deno, **pas de vrai navigateur headless** → incapable de
  faire tourner Playwright. Utile seulement pour **déclencher** une fonction, pas pour scraper.
- **Cloudflare Browser Rendering** : 10 min de navigateur/**jour** en gratuit → insuffisant.
- **Fly.io / Railway** : plus de free tier permanent. **Render** : free tier réel mais instances qui
  dorment, moins confortable que Cloud Run pour Playwright.
- **Self-hosted runner** (Raspberry Pi / vieux PC / NAS) : minutes illimitées + cron fiable si vous
  avez une machine qui reste allumée. Bonne option « maison ».

### Supabase free tier — limites à surveiller

| Limite | Valeur | Impact |
|---|---|---|
| **Pause après inactivité** | Projet en pause après **7 j** sans activité DB | ✅ **Couvert** tant que le scraper écrit toutes les 15-30 min ; risque **seulement si le cron s'arrête** (d'où keepalive) |
| DB | **500 Mo** | Purger les annonces `is_active=false` anciennes ; ne pas stocker le `raw` indéfiniment |
| Egress | **5 Go/mois** | Surveiller ; servir des vignettes, pas les photos pleines |
| Storage | 1 Go | Dossier locatif OK au MVP |
| Connexions | directes limitées | **Utiliser le pooler / REST** |

<sub>Sources : GitHub Docs Billing ; community discussions #156282/#196910/#86087 (délais/skips/désactivation) ;
Cloud Run pricing/free tier ; Cloud Scheduler pricing ; Supabase « Free Project Pausing » + Pricing ;
Cloudflare Browser Rendering pricing.</sub>

---

# 4. MODÈLE DE DONNÉES — schéma SQL + RLS + dédoublonnage

## Stratégie de dédoublonnage — **2 niveaux**

1. **Intra-source (idempotence des re-scrapes)** — contrainte `UNIQUE(source_id, external_id)` +
   `UPSERT`. Le `content_hash` (hash des champs de contenu stables : prix, surface, pièces, desc)
   sert à **détecter une mise à jour** (re-scoring) sans réinsérer.
2. **Inter-sources (même appart posté sur PAP + Leboncoin)** — `dedup_key` =
   hash normalisé de **signaux stables** : `arrondissement | round(surface) | round(prix, 10€) |
   pièces | étage`. À l'insertion, on cherche un listing d'une **autre source** avec le même
   `dedup_key` dans une fenêtre temporelle → on rattache les deux au **même `listing_group`**.
   **Le matching et les alertes se font par `group_id`** → un user n'est jamais alerté deux fois
   pour le même appartement physique.

## Schéma SQL — `supabase/migrations/0001_init.sql` (prêt à exécuter)

```sql
-- ============================================================
-- 0001_init.sql — Chasseur d'appart Paris
-- Postgres + PostGIS (Supabase). Multi-tenant via RLS.
-- ============================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ---------- Sources ----------
create table sources (
  id          smallint generated always as identity primary key,
  key         text not null unique,            -- 'pap' | 'leboncoin' | 'seloger' | 'melo'
  name        text not null,
  kind        text not null check (kind in ('scrape','api')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Groupes de dédup inter-sources ----------
create table listing_groups (
  id                   uuid primary key default gen_random_uuid(),
  dedup_key            text not null unique,
  canonical_listing_id uuid,                    -- FK ajoutée après listings
  created_at           timestamptz not null default now()
);

-- ---------- Pool partagé d'annonces normalisées ----------
create table listings (
  id            uuid primary key default gen_random_uuid(),
  source_id     smallint not null references sources(id),
  external_id   text not null,                 -- id de l'annonce sur le site source
  group_id      uuid references listing_groups(id),
  url           text not null,

  title         text,
  -- Contenu volontairement résumé (modèle "index + lien", pas de copie intégrale) :
  summary       text,
  price_total   integer,                        -- loyer charges comprises (le comparable)
  rent          integer,                        -- hors charges
  charges       integer,
  surface       numeric(6,2),                   -- m²
  rooms         smallint,                       -- pièces
  bedrooms      smallint,
  furnished     boolean,
  floor         smallint,
  dpe           char(1),                        -- A..G
  postal_code   text,
  city          text,
  arrondissement smallint,                       -- 1..20 (Paris) ; null hors Paris
  geo           geography(Point, 4326),          -- PostGIS (lon,lat)
  thumb_url     text,                            -- vignette (pas la photo pleine)
  photo_hashes  text[] default '{}',             -- hash perceptuel des photos (dédup + anti-arnaque)
  photo_cluster_id uuid,                          -- regroupe les annonces partageant des photos

  content_hash  text not null,                   -- détecte les MAJ de contenu
  dedup_key     text not null,                   -- clé de dédup inter-sources
  posted_at     timestamptz,                     -- date annonce si dispo
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  is_active     boolean not null default true,   -- encore en ligne au dernier passage
  raw           jsonb,                           -- payload brut (debug ; purger régulièrement)

  unique (source_id, external_id)
);

alter table listing_groups
  add constraint fk_canonical_listing
  foreign key (canonical_listing_id) references listings(id) on delete set null;

create index listings_geo_gix     on listings using gist (geo);
create index listings_dedup_idx   on listings (dedup_key);
create index listings_group_idx   on listings (group_id);
create index listings_active_seen on listings (is_active, first_seen_at desc);
create index listings_arr_idx     on listings (arrondissement);

-- ---------- Utilisateurs (miroir de auth.users) ----------
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  display_name      text,
  contact_template  text,        -- template de message fourni par l'user (variables prénom/dossier/dispos)
  dossierfacile_url text,        -- lien DossierFacile injecté dans le message de contact
  created_at        timestamptz not null default now()
);

-- ---------- Critères de recherche par utilisateur ----------
create table search_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  name            text not null default 'Ma recherche',
  budget_max      integer,                       -- loyer CC max
  surface_min     numeric(6,2),
  rooms_min       smallint,
  furnished       boolean,                        -- null = indifférent
  arrondissements smallint[],                      -- zones ciblées (Paris)
  weights         jsonb,                           -- surcharge pondération scoring (optionnel)
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index search_profiles_user_idx on search_profiles (user_id);

-- ---------- Destinations de trajet (multi-cibles pondérées) ----------
-- Un profil peut viser plusieurs pôles (ex. École 42 + UPEC pour un couple).
create table search_targets (
  id                uuid primary key default gen_random_uuid(),
  search_profile_id uuid not null references search_profiles(id) on delete cascade,
  label             text not null,                 -- 'École 42', 'UPEC Juliette'
  geo               geography(Point, 4326) not null,
  weight            numeric(4,2) not null default 1.0,   -- poids dans le score trajet
  max_commute_min   smallint not null default 50,        -- seuil pour CETTE cible
  hard              boolean not null default true,        -- true = filtre dur (doit être <= seuil)
  mode              text not null default 'transit',
  arrive_by         time not null default '09:00',       -- heure d'arrivée type (heure de pointe)
  created_at        timestamptz not null default now()
);
create index search_targets_profile_idx on search_targets (search_profile_id);
-- Seed du couple (à créer à l'onboarding) :
--   ('UPEC Juliette', <geo Créteil>, weight 0.6, max 50, hard true)
--   ('École 42',      <geo Paris 17>, weight 0.4, max 50, hard true)

-- ---------- Cache des temps de trajet, par (annonce × cible) ----------
create table commute_times (
  listing_id   uuid not null references listings(id) on delete cascade,
  target_id    uuid not null references search_targets(id) on delete cascade,
  duration_min smallint,                          -- null = non calculable
  transfers    smallint,
  computed_at  timestamptz not null default now(),
  primary key (listing_id, target_id)
);

-- ---------- Prix de marché de référence (pour l'écart prix/m²) ----------
create table market_stats (
  arrondissement smallint not null,
  furnished      boolean  not null,
  rooms_bucket   smallint not null,               -- 1,2,3,4+ (4 = "4 et plus")
  median_ppm2    numeric(7,2) not null,            -- loyer CC médian au m²
  updated_at     timestamptz not null default now(),
  primary key (arrondissement, furnished, rooms_bucket)
);

-- ---------- Historique de prix (append à chaque changement détecté) ----------
create table listing_price_events (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  price_total integer not null,                    -- loyer CC observé
  seen_at     timestamptz not null default now()
);
create index price_events_listing_idx on listing_price_events (listing_id, seen_at);

-- ---------- Matches (annonce × profil) avec score ----------
create table matches (
  id                uuid primary key default gen_random_uuid(),
  search_profile_id uuid not null references search_profiles(id) on delete cascade,
  listing_id        uuid not null references listings(id) on delete cascade,
  group_id          uuid references listing_groups(id),   -- dédup d'alerte
  score             numeric(5,2) not null,                 -- 0..100
  commute_min       smallint,
  price_per_m2      numeric(7,2),
  price_gap_pct     numeric(6,2),                          -- <0 = sous le marché (bien)
  fraud_flags       text[] not null default '{}',
  breakdown         jsonb,                                  -- détail des composantes
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (search_profile_id, listing_id)
);
create index matches_profile_score_idx on matches (search_profile_id, score desc);
create index matches_group_idx on matches (search_profile_id, group_id);

-- ---------- Préférences d'alerte ----------
create table alert_prefs (
  search_profile_id uuid primary key references search_profiles(id) on delete cascade,
  email_enabled     boolean not null default true,
  inapp_enabled     boolean not null default true,   -- Realtime dans le feed
  webpush_enabled   boolean not null default true,   -- notification navigateur (PWA)
  min_score         numeric(5,2) not null default 70,
  updated_at        timestamptz not null default now()
);

-- ---------- Historique d'envoi (anti-doublon) ----------
create table alert_deliveries (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  channel    text not null check (channel in ('email','inapp','webpush')),
  sent_at    timestamptz not null default now(),
  unique (match_id, channel)                     -- 1 envoi max par canal
);

-- ---------- Dossier locatif ----------
create table dossier_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null,                       -- 'revenus','garant','piece','champ_libre',...
  label      text not null,
  value      text,
  file_path  text,                                 -- chemin Supabase Storage
  created_at timestamptz not null default now()
);
create index dossier_user_idx on dossier_items (user_id);

-- ---------- État perso par annonce : shortlist / masquer / pipeline de chasse ----------
create table user_listing_states (
  user_id     uuid not null references profiles(id) on delete cascade,
  listing_id  uuid not null references listings(id) on delete cascade,
  status      text not null default 'new'
              check (status in ('new','to_contact','contacted','visit','applied','taken','rejected')),
  starred     boolean not null default false,     -- shortlist ⭐
  hidden      boolean not null default false,     -- masquer 🚫 (ne plus revoir)
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index uls_status_idx on user_listing_states (user_id, status);

-- ---------- Abonnements Web Push (une ligne par appareil/navigateur) ----------
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_user_idx on push_subscriptions (user_id);
```

## RLS — multi-tenant

```sql
-- Pool partagé : lisible par tout utilisateur authentifié, écrit par le service_role
-- (les collecteurs utilisent la clé service → bypass RLS).
alter table sources             enable row level security;
alter table listings            enable row level security;
alter table listing_groups      enable row level security;
alter table market_stats        enable row level security;
alter table commute_times       enable row level security;
alter table listing_price_events enable row level security;

create policy "read pool listings"  on listings             for select to authenticated using (true);
create policy "read pool sources"   on sources              for select to authenticated using (true);
create policy "read pool groups"    on listing_groups       for select to authenticated using (true);
create policy "read market"         on market_stats         for select to authenticated using (true);
create policy "read price events"   on listing_price_events for select to authenticated using (true);
-- commute_times est lié à une cible d'un user → lecture réservée au propriétaire (pas le pool).
create policy "own commute" on commute_times for select to authenticated using (
  exists (select 1 from search_targets t
          join search_profiles sp on sp.id = t.search_profile_id
          where t.id = commute_times.target_id and sp.user_id = auth.uid()));
-- (aucune policy insert/update pour authenticated ⇒ seul service_role écrit le pool + les caches)

-- Profiles : chacun ne voit/modifie que sa ligne.
alter table profiles enable row level security;
create policy "own profile" on profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Données dérivées de l'utilisateur : isolées par user_id / lien de parenté.
alter table search_profiles     enable row level security;
alter table search_targets      enable row level security;
alter table matches             enable row level security;
alter table alert_prefs         enable row level security;
alter table alert_deliveries    enable row level security;
alter table dossier_items       enable row level security;
alter table user_listing_states enable row level security;
alter table push_subscriptions  enable row level security;

create policy "own search_profiles" on search_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own dossier" on dossier_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own listing states" on user_listing_states
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push subs" on push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- search_targets : possédés via le search_profile parent.
create policy "own targets" on search_targets
  for all to authenticated using (
    exists (select 1 from search_profiles sp
            where sp.id = search_targets.search_profile_id and sp.user_id = auth.uid()))
  with check (
    exists (select 1 from search_profiles sp
            where sp.id = search_targets.search_profile_id and sp.user_id = auth.uid()));

-- matches / alert_prefs / alert_deliveries : possédés via le search_profile parent.
create policy "own matches" on matches
  for select to authenticated using (
    exists (select 1 from search_profiles sp
            where sp.id = matches.search_profile_id and sp.user_id = auth.uid()));

create policy "own alert_prefs" on alert_prefs
  for all to authenticated using (
    exists (select 1 from search_profiles sp
            where sp.id = alert_prefs.search_profile_id and sp.user_id = auth.uid()))
  with check (
    exists (select 1 from search_profiles sp
            where sp.id = alert_prefs.search_profile_id and sp.user_id = auth.uid()));

create policy "own alert_deliveries" on alert_deliveries
  for select to authenticated using (
    exists (select 1 from matches m
            join search_profiles sp on sp.id = m.search_profile_id
            where m.id = alert_deliveries.match_id and sp.user_id = auth.uid()));
```

> **Note archi** : le scoring (calcul des `matches`, `commute_times`, `alert_deliveries`) tourne
> côté serveur avec la **clé `service_role`** (bypass RLS). Les policies ci-dessus protègent l'accès
> **depuis le client** (dashboard). Un trigger `on auth.users` crée la ligne `profiles`
> automatiquement à l'inscription.

---

# 5. SCORING — formule concrète

## Principe

**Filtres durs d'abord** (budget, surface, pièces, zone, meublé) → une annonce qui ne passe pas est
**exclue** (pas de match créé). **Le scoring classe les survivants** sur une note **0-100**, puis un
**multiplicateur anti-arnaque** rabaisse les annonces suspectes.

```
score_final = ( 0.40 · s_trajet          -- le critère roi à Paris (transit réel)
              + 0.30 · s_prix             -- prix/m² vs médiane marché du quartier
              + 0.20 · s_fraicheur        -- une annonce fraîche = encore dispo
              + 0.10 · s_base )           -- adéquation fine aux critères (surface, DPE, meublé…)
              · m_arnaque                 -- ∈ [0,1] : malus si signaux d'arnaque
```

Chaque `s_*` est normalisé sur **[0, 100]**. Pondérations par défaut surchargeables par utilisateur
via `search_profiles.weights`.

### s_trajet (transit, multi-destinations) — poids 40

Le critère roi, calculé **par cible** puis agrégé (moyenne pondérée par `search_targets.weight`).
Config verrouillée pour le couple : **UPEC (poids 0.6) + École 42 (poids 0.4)** — on privilégie le
trajet de Juliette dans le classement — **avec `hard = true` et `max = 50 min` pour les DEUX**.

```
-- sous-score d'UNE cible i :
s_i        = clamp(1 − (commute_i / max_i)^1.3 , 0, 1)     -- 0 min → 1 ; au seuil (50) → ~0
-- agrégat sur toutes les cibles du profil :
s_trajet   = 100 · Σ(weight_i · s_i) / Σ(weight_i)          -- ex. 0.6·s_UPEC + 0.4·s_42
```
- **Filtre dur des deux côtés** : si `commute_UPEC > 50` **OU** `commute_42 > 50` → **annonce
  éliminée** (aucun des deux ne doit subir plus de 50 min). Généralisé : toute cible `hard = true`
  qui dépasse son `max` élimine l'annonce.
- `commute_i` **NULL** (non calculable) → traité comme échec du filtre dur si `hard`, sinon retiré
  de l'agrégat (poids ignoré). *(Une cible obligatoire dont on ne sait pas calculer le trajet ne
  doit pas passer par défaut.)*
- Le poids ne fait que **classer** parmi les survivants ; il ne relâche jamais le plafond de 50 min.
- Feature associée : **zone d'or** = intersection des isochrones ≤50 min de 42 **et** de l'UPEC
  (la carte montre où habiter pour satisfaire les deux).

### s_prix (vs marché) — poids 30

```
ppm2      = price_total / surface
gap_pct   = (median_ppm2 − ppm2) / median_ppm2      -- >0 = moins cher que le marché (bien)
s_prix    = 100 · clamp( 0.5 + gap_pct / 0.6 , 0, 1 )
```
- 30 % **sous** le marché → 100 ; au prix du marché → 50 ; 30 % **au-dessus** → 0.
- `median_ppm2` lu dans `market_stats` par (arrondissement, meublé, tranche de pièces).

**Source des `market_stats` (décidé)** — approche **hybride** :
1. **Primaire : médiane interne roulante.** Un job nocturne agrège les `listings` actifs par
   (arrondissement, meublé, tranche de pièces) → `median_ppm2` + `sample_size`. Avantage : couvre
   **tout l'IDF** (pas que Paris), s'auto-met à jour, zéro dépendance externe. Fallback si
   `sample_size` trop faible : remonter d'un cran (moyenne de l'arrondissement, toutes pièces).
2. **Secondaire (Paris only) : encadrement des loyers** (open data `opendata.paris.fr`, loyers de
   référence majorés par quartier/pièces/époque/meublé). Sert de **repère légal** : on calcule si le
   loyer dépasse le **plafond légal** → badge **`loyer_encadrement_dépassé`** sur la fiche
   (info + levier de négociation, pas un malus de score). Différenciateur produit sympa.

### s_fraicheur — poids 20 (demi-vie 12 h)

```
age_h        = heures depuis first_seen_at
s_fraicheur  = 100 · 0.5^(age_h / 12)
```
- 0 h → 100 ; 12 h → 50 ; 24 h → 25. À Paris, une annonce de >24 h est souvent déjà prise.

### s_base — poids 10

Bonus/malus d'adéquation fine, normalisé 0-100 : marge budget restante, surface au-delà du minimum,
DPE (A-C bonus, F-G malus), meublé conforme à la préférence, ascenseur si étage élevé, etc.

### m_arnaque — multiplicateur ∈ [0, 1] (Paris = nid à arnaques)

Deux moments de détection : **à l'ingestion** (motifs texte, photos, cohérence — pas cher) et
**au scoring** (tout ce qui est relatif au marché). Chaque flag lève un item dans
`matches.fraud_flags` et rabat le score.

| Flag | Détection | Quand | Effet |
|---|---|---|---|
| `prix_trop_bas` | `ppm2 < 0.5 · median_ppm2` (appât classique) | scoring | ×0.4 · 🔴 |
| `paiement_avant_visite` | motifs texte : « caution avant », « à l'étranger », Western Union, clés par la poste | ingestion | ×0.3 · 🔴 |
| `contact_hors_plateforme` | email/WhatsApp direct poussé dans le corps | ingestion | ×0.5 |
| `photos_reutilisees` | hash photo vu dans ≥3 annonces distinctes (cf. ci-dessous) | ingestion | ×0.4 · 🔴 |
| `sans_photo` | 0 image | ingestion | ×0.7 |
| `incoherence` | surface/prix/pièces incohérents (ex. 150 m² à 600 € CC) | ingestion | ×0.6 |
| `dpe_absent` | DPE manquant (obligatoire légalement) | ingestion | 🟡 léger |
| `loyer_encadrement_depasse` | > plafond légal (open data Paris) | scoring | 🟡 **info, pas de malus** (levier de négo) |

`m_arnaque = produit des multiplicateurs` (borné à ≥0.1). Cumul de flags → écrase le score.

**Badge de confiance** (sur les cartes ET la fiche) : 🟢 clean / 🟡 à vérifier / 🔴 signaux forts,
dérivé des flags. On **downrank mais on ne masque jamais** : les flags **et** les scores restent
affichés, l'utilisateur tranche avec l'info (+ conseil « ne payez jamais avant d'avoir visité »).

### Cluster photos réutilisées — « trouver la vraie annonce »

Une arnaque qui vole des photos coexiste souvent avec la **vraie** annonce. Donc on ne se contente
pas de tout flaguer : dans un **cluster** (≥3 annonces partageant ≥1 `photo_hash`, même
`photo_cluster_id`), un job élit la version **la plus crédible** :

1. **prix ≥ médiane du cluster** (les arnaques cassent le prix → l'outlier bon marché = suspect) ;
2. **`first_seen` la plus ancienne** (l'original précède les copies) ;
3. **source agence / fiche plus complète** (DPE présent) en départage.

Le membre élu = référence crédible ; les **outliers bon marché** reçoivent `photos_reutilisees` +
pointeur vers elle. UI : sur un suspect → *« ⚠ photos réutilisées sur N annonces — la plus crédible :
[lien] »* ; on downrank le faux **et** on met la vraie en avant.

## Exemple chiffré

Annonce : 32 m², 1 200 € CC, Paris 11e, meublé, vue 3 h après publication, trajet transit 22 min
(seuil user 45 min), médiane quartier 42 €/m².
- ppm2 = 37,5 → gap = (42−37,5)/42 = +10,7 % → **s_prix ≈ 68**
- s_trajet = 100·(1 − (22/45)^1.3) = 100·(1 − 0,39) ≈ **61**
- s_fraicheur = 100·0.5^(3/12) ≈ **84**
- s_base ≈ **60** (dans le budget, meublé conforme, DPE D)
- pas de flag → m_arnaque = 1
- **score = 0.40·61 + 0.30·68 + 0.20·84 + 0.10·60 = 24,4 + 20,4 + 16,8 + 6 ≈ 68/100**

`matches.breakdown` stocke le détail JSON (`{s_trajet, s_prix, s_fraicheur, s_base, m_arnaque}`)
pour l'afficher dans la fiche (transparence du « pourquoi ce score »).

---

# 6. PRODUIT & UI (décidé)

Le cœur du produit, c'est **le moment où on décide en 10 secondes**. Décisions tranchées :

## Forme : PWA responsive — desktop clavier + mobile au pouce

**Une seule app installable** (PWA, requise pour le Web Push), deux modes selon l'écran :
- **Desktop** : **feed inbox dense piloté au clavier**, façon Superhuman/Linear. Le triage à fond.
- **Mobile** (là où tu chasses vraiment, en déplacement) : cartes tapables, **swipe ⭐ / 🚫**,
  push qui deep-linke direct sur la fiche. C'est le mode « je réagis à une alerte en 20 s ».

Optimisé pour *toi* d'abord ; on « habillera » grand public pour le SaaS plus tard.

**Anatomie d'une ligne (la décision en 10s) :**
```
█ SCORE 87  • il y a 8 min          ⭐ 🚫
32 m² · 1200 € CC · Paris 12e · meublé
🚇 42: 24 min   🚇 UPEC: 31 min   💶 -15% marché   DPE D
```
Le **score**, les **trajets par cible**, l'**écart de prix vs marché** et la **fraîcheur** sont
les 4 signaux visibles sans cliquer. Flags arnaque en rouge si présents.

**Raccourcis clavier :** `j/k` naviguer · `Enter/→` fiche · `s` shortlist ⭐ · `x` masquer 🚫 ·
`c` message de contact · `1–5` statut pipeline · `f` filtres.

**Onglets :** **Feed** (nouveau, non masqué) · **Shortlist** · **Pipeline** (kanban) · **Masqués**.

## Écrans

| Écran | Rôle | Points clés |
|---|---|---|
| **Feed** | Trier vite | Liste clavier, cartes 10s, filtres chips, tri score/fraîcheur |
| **Fiche annonce** | Approfondir | « Pourquoi ce score » (breakdown JSON), carte + **isochrones** par cible, photos, **lien source**, actions rapides, message de contact pré-rempli |
| **Onboarding / critères** | Définir la recherche | Budget, surface, pièces, zones + **N destinations** (label, adresse, poids, seuil) |
| **Pipeline** | Suivi de chasse (mini-CRM) | Kanban `à contacter → contacté → visite → dossier envoyé → pris/refusé` + notes |
| **Alertes** | Config + historique | Canaux (push/in-app/email), seuil de score, cadence |
| **Dossier** | Support | Pièces (Storage) + champs libres + lien DossierFacile, prêt à copier |

## Features différenciantes (au-delà de la découverte brute)

- **Zone d'or (isochrones croisées)** — la carte montre l'intersection des zones atteignables
  depuis 42 **et** l'UPEC → « où chercher pour nous deux ». Différenciateur fort vs les portails.
- **État perso par annonce** — shortlist / masquer / statut pipeline / note (`user_listing_states`).
  Sans « masquer », on revoit sans fin les mêmes annonces : indispensable, oublié des 2 plans.
- **Contact rapide (le moment qui fait gagner la course)** — le contact réel reste **chez la source**
  (RGPD : on ne stocke pas les coordonnées, on les utilise à la volée). Boutons contextuels selon ce
  que l'annonce expose :
  - **☎ Appeler** (`tel:`) quand un numéro est visible.
  - **✉ Mail** quand un email est exposé → ouvre un **brouillon Gmail pré-rempli** (destinataire +
    objet + corps) via `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`, repli `mailto:`.
  - **↗ Ouvrir l'annonce source** (deep-link) pour le formulaire/messagerie du site.
  - Le **corps du message** vient d'un **template fourni par l'utilisateur** (à brancher — *ne pas
    réinventer*), avec variables (prénom, **lien DossierFacile**, disponibilités).
  - Cliquer « Contacter » **bascule l'annonce en statut `contacted`** (horodaté) dans
    `user_listing_states` → anti-recontact, suivi automatique dans le pipeline.
- **Badge dédup** — « aussi sur PAP + Bien'ici » sur l'annonce canonique (rassure sur la couverture).
- **Breakdown de score transparent** — chaque annonce explique son score (les 4 composantes),
  pour instaurer la confiance et permettre d'ajuster ses pondérations.

## Onboarding + zone d'or

Premier écran après login, 4 étapes :
1. **Destinations** — géocodage via **BAN** (`api-adresse.data.gouv.fr`, gratuit, sans clé). Ajouter
   N pôles ; pour l'instance perso, **pré-remplir UPEC (0.6) + École 42 (0.4)**, `max 50`, `hard`.
2. **Budget & bien** — budget CC, surface min, pièces min, meublé (indifférent/oui/non).
3. **Zone d'or** — on demande à PRIM les **isochrones ≤50 min** de chaque destination, on les
   **intersecte** (turf.js) → le polygone « où habiter pour vous deux », affiché sur la carte
   (effet wow) + communes suggérées. Remplace la sélection manuelle de quartiers.
4. **Alertes** — score min, activation des canaux (le prompt Web Push se déclenche ici).

**Optimisation clé** : le polygone zone d'or sert de **pré-filtre géo PostGIS** (`ST_Within`) → on
n'appelle PRIM pour le trajet précis **que** sur les annonces déjà dans la zone. Économise beaucoup
d'appels API (et respecte le quota 20k/j confortablement).

## Fiche annonce (le détail — décider en 30 s)

- **Breakdown de score transparent** (barres par composante) — confiance + réglage des poids.
- **Itinéraires réels par cible** depuis `sections[]` de PRIM (« M8 → RER A »), pas juste un nombre.
- **Carte + isochrones** : pin de l'annonce, marqueur « ✓ dans la zone d'or ».
- **Prix** : écart vs médiane quartier (−18%), badge encadrement si dépassé, **historique de prix**
  (`listing_price_events`) → « baissé de 50€ il y a 2j ».
- **Panneau Vérifs** : flags anti-arnaque + conseil ; si `photos_reutilisees`, lien vers la version
  crédible du cluster.
- **Dédup** : « aussi sur PAP · Bien'ici » avec liens vers chaque source.
- **Photos** : vignettes **hotlinkées** / lien source, **pas de réhébergement** (copyright + storage).
- **Actions** : contact (appel/mail/source) + shortlist/masquer + statut pipeline.

## Dossier — réduit au strict minimum

Décision user : **le lien DossierFacile suffit**. On ne construit **pas** de module dossier ;
seul `profiles.dossierfacile_url` est nécessaire (injecté dans le message de contact). La table
`dossier_items` est **reportée/optionnelle** (à ressortir seulement si un besoin de pièces custom
émerge plus tard).

## Alertes — empilement (pas de Telegram)

1. **In-app Realtime** (Supabase) — l'annonce surgit dans le feed quand l'app est ouverte.
2. **Web Push** (PWA + clés VAPID + service worker) — notif navigateur quand l'app est fermée.
   Gratuit ; c'est le canal « vitesse » quand tu n'es pas devant l'écran.
3. **Email (Resend)** — secours / digest, plus lent.

Anti-doublon via `alert_deliveries (match_id, channel)` **et** dédup par `group_id` (jamais 2 fois
le même appart physique, même posté sur 2 sites).

---

## Stack retenue (et pourquoi elle tient en gratuit)

- **Front + API** : **Next.js (App Router, TypeScript)** sur **Vercel** (free tier). Dashboard + SSR + API routes.
- **Base + Auth + Realtime + Storage** : **Supabase** (free tier).
  - Postgres + **PostGIS** : dédup, filtres complexes, requêtes géo (distance/trajet).
  - Auth + **RLS** → multi-tenant propre.
  - **Realtime** → nouvelles annonces en direct dans le dashboard.
  - Storage → pièces du dossier.
- **Collecte** : collecteurs **Playwright (TS)** dans un **container Cloud Run Job** déclenché par
  **Cloud Scheduler** (~15 min, fiable) → écriture Supabase par **REST**. GitHub Actions (dépôt
  public) pour prototyper/fallback. Interface `Collector` commune → swap Melo plus tard.
- **Trajet / géo** : **PRIM / IDFM (Navitia)** — voir §2.
- **Alertes email** : **Resend** (free tier) ; temps réel in-app via Supabase Realtime.

---

## Architecture — les briques

```
[Sources]  →  [Collecteurs pluggables]  →  [Normalisation + Dédup]  →  [Postgres/Supabase]
 (PAP d'abord ; Playwright via GitHub Actions cron ; interface commune → swap Melo API plus tard)
                                                                          │
                        ┌─────────────────────────────────────────────────┤
                        ▼                              ▼                    ▼
                 [Scoring par user]            [Alertes]            [Dashboard Next.js]
           (trajet PRIM, prix/m²,          (Realtime in-app +      (liste triée, filtres,
            fraîcheur, anti-arnaque)         email Resend)          fiche annonce, dossier)
```

---

## Roadmap par tranches verticales

Chaque tranche = fonctionnelle de bout en bout, testée dans l'app réelle, puis commit.

- **Phase 0 — Fondations.** (détail ci-dessous) Scaffolding Next.js + Supabase + auth + déploiement
  Vercel + migration `0001_init.sql`. *Livrable : je me connecte sur l'URL prod, une ligne `profiles` apparaît.*
- **Phase 1 — Pipeline bout-en-bout, source PAP.** Collecteur Playwright PAP, normalisation +
  dédup (`content_hash` + `dedup_key`), déploiement en **Cloud Run Job + Cloud Scheduler** (~15 min)
  — proto possible d'abord en GitHub Actions —, annonces brutes affichées.
  *Livrable : des annonces réelles arrivent seules dans la liste.*
- **Phase 2 — Critères + scoring + feed.** Onboarding `search_profile` avec **N destinations**
  (42 + UPEC), calcul **trajet PRIM multi-cibles** (+ cache), `market_stats`, formule de score,
  **feed inbox au clavier** trié + filtres + shortlist/masquer (`user_listing_states`).
  *Livrable : je vois MES annonces classées et je trie au clavier.*
- **Phase 3 — Alertes.** Realtime in-app + **Web Push (PWA/VAPID)** + email Resend, anti-doublon par
  `alert_deliveries` et `group_id`. *Livrable : prévenu dans la minute d'un appart qui matche, une seule fois.*
- **Phase 4 — Pipeline + contact.** Kanban de suivi de chasse (statuts + notes) ; **contact rapide**
  (appel / mail Gmail pré-rempli / lien source) branché sur **ton template** + lien DossierFacile,
  bascule auto en « contacté ». *(Pas de module dossier : le lien DossierFacile suffit.)*
- **Phase 5 — Robustesse & sources.** Ajout **Bien'ici (API JSON)**, puis **Leboncoin (API mobile)**,
  puis **SeLoger** ; monitoring des collecteurs qui cassent, dédup inter-sources fine (`listing_groups`).
- **Phase 6 — Commercialisation.** Bascule collecteur → **API Melo**, **Stripe**, onboarding
  multi-user, landing, **revue CGU/RGPD par un juriste**.

---

## Phase 0 — Scaffolding détaillé (implémentable directement)

**Objectif** : de zéro à « je me connecte sur l'URL Vercel de prod et une ligne apparaît dans
Supabase », tout le squelette en place.

### 0.1 — Comptes & secrets (manuel, ~30 min)
- [ ] Créer le projet **Supabase** (région EU, ex. `eu-west-3`). Noter `SUPABASE_URL`, `anon key`, `service_role key`.
- [ ] Créer le compte **Vercel**, lier le dépôt GitHub.
- [ ] Créer le compte **PRIM/IDFM** → générer le **jeton API** (pour Phase 2).
- [ ] Créer le compte **Resend** (pour Phase 3).
- [ ] ⚠️ Le dépôt sera **public** (contrainte free tier collecte) → **aucun secret dans le code**,
      tout en **GitHub Secrets** + **Vercel Env Vars**.

### 0.2 — Scaffolding Next.js
```bash
npx create-next-app@latest appart-hunter --typescript --app --tailwind --eslint
cd appart-hunter
npm i @supabase/supabase-js @supabase/ssr
npm i -D playwright        # pour les collecteurs (Phase 1)
```

### 0.3 — Structure du dépôt (greenfield)
```
/app
  /(auth)/login/page.tsx          → écran login/signup (Supabase Auth)
  /(dashboard)/listings/page.tsx  → liste (placeholder P0, réel P1)
  /auth/callback/route.ts         → échange de session Supabase
/lib
  supabase/client.ts              → client navigateur (anon key)
  supabase/server.ts              → client serveur (cookies SSR)
  supabase/service.ts             → client service_role (scoring/collecte, jamais exposé au client)
  scoring.ts                      → formule §5 (pur, testable)
  commute.ts                      → appel PRIM + cache commute_times (P2)
  dedup.ts                        → content_hash + dedup_key (P1)
/collectors  (→ repo PUBLIC séparé en P1 ; app privée par ailleurs)
  types.ts                        → interface Collector (CLÉ du swap Melo)
  pap.ts                          → 1er collecteur (P1)
  run.ts                          → point d'entrée (Cloud Run Job / cron)
  Dockerfile                      → container Playwright pour Cloud Run (P1)
  .github/workflows/collect.yml   → proto/fallback GitHub Actions (optionnel)
/supabase/migrations
  0001_init.sql                   → schéma §4 (à exécuter dès P0)
```

### 0.4 — Interface `Collector` (le point qui rend le swap Melo trivial)
```ts
// collectors/types.ts
export type RawListing = {
  externalId: string; url: string; title?: string; summary?: string;
  priceTotal?: number; rent?: number; charges?: number;
  surface?: number; rooms?: number; bedrooms?: number; furnished?: boolean;
  floor?: number; dpe?: string; postalCode?: string; city?: string;
  arrondissement?: number; lon?: number; lat?: number; thumbUrl?: string;
  postedAt?: string; raw?: unknown;
};
export interface Collector {
  key: 'pap' | 'leboncoin' | 'seloger' | 'melo';
  fetchListings(): Promise<RawListing[]>;   // le cron appelle ça ; l'implémentation change, pas le pipeline
}
```

### 0.5 — Auth + déploiement
- [ ] Implémenter login/signup Supabase (email magic link ou password) + `auth/callback`.
- [ ] Trigger SQL : à l'`INSERT` dans `auth.users`, créer la ligne `profiles`.
- [ ] Middleware Next.js : protéger `/(dashboard)/*`, rediriger vers `/login` si non connecté.
- [ ] Déployer sur Vercel (env vars : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

### 0.6 — Vérification P0 (dans l'app réelle)
- [ ] Ouvrir l'URL Vercel de prod, s'inscrire.
- [ ] Vérifier qu'une ligne apparaît dans `profiles` (table editor Supabase).
- [ ] Se déconnecter/reconnecter ; `/(dashboard)` inaccessible sans session.
- [ ] `npm run lint && npm run build` OK avant commit.

---

## Vérification (à chaque phase, dans l'app réelle)

- **P0** : se connecter sur l'URL Vercel de prod, vérifier une ligne `profiles` dans Supabase.
- **P1** : déclencher le workflow GitHub Actions à la main, vérifier N annonces PAP réelles insérées,
  **0 doublon** sur un 2e passage (test `content_hash`/`UPSERT`), affichage dans le dashboard.
- **P2** : créer un `search_profile` avec adresse cible → vérifier le temps de trajet **PRIM** contre
  Google Maps, et l'ordre de tri par score.
- **P3** : insérer une annonce test qui matche → email + apparition Realtime, **pas de 2e email** au
  passage suivant (test `alert_deliveries` + `group_id`).
- **P4** : uploader une pièce, la re-télécharger, vérifier l'isolation **RLS** avec un 2e compte.
- Chaque phase : **lint + build Next OK** avant commit.

---

## Risques & honnêteté (à garder en tête)

| Risque | Réalité | Mitigation |
|---|---|---|
| **Fragilité scraping** | Leboncoin/SeLoger = DataDome ML (détection par intention 2025) ; casse quand le site change | Démarrer PAP (pas de DataDome) ; isoler chaque source derrière `Collector` ; monitoring + désactivation rapide |
| **Cadence de collecte** | GitHub Actions dérive (20-90 min) → mauvais pour « être premier » | **Cloud Run Jobs + Scheduler** en primaire (~15 min fiable) ; **UPSERT idempotent** ; Actions en proto/fallback |
| **Latence bout-en-bout** | Le vrai KPI « vitesse » = collecte→scoring→push | Scoring déclenché à l'insertion ; push immédiat ; viser < quelques min |
| **Free tier Supabase** | Pause 7 j, DB 500 Mo, egress 5 Go | Scraper garde le projet actif ; purger `raw` + annonces mortes ; vignettes, pas photos pleines |
| **Quota PRIM** | 20 000/j (large) mais relevé à demander si comptes récents | Cache `commute_times` par (géo × cible) ; datetime standardisé ; fallback Google Routes |
| **Légal / droit BDD (sui generis)** | Précédent LBC 2021 (50 k€) contre agrégateur republiant | Modèle **index + lien profond**, pas de copie intégrale ni coordonnées perso ; faible volume perso au MVP |
| **RGPD** | Données perso dans les annonces | Ne pas stocker les coordonnées au MVP ; base légale + opt-out avant Phase 6 |
| **CGU / commercialisation** | Scraping interdit par les CGU des 3 sites | **Bascule Melo (source licenciée) + revue juriste avant toute vente** — verrouillé |

---

## Points restants à trancher au fil de l'eau

- **Tarif exact Melo** et périmètre de la licence → à chiffrer avant Phase 6.
- **Proxies résidentiels FR** (budget) : nécessaires seulement à partir de Leboncoin (Phase 5).
```
