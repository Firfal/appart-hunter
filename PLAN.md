# Chasseur d'appart Paris — Plan produit & technique

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
| Hébergement | **Gratuit** (Firebase familier, Vercel OK si mieux) |

## Stack retenue (et pourquoi elle tient en gratuit)

- **Front + API** : **Next.js (App Router, TypeScript)** déployé sur **Vercel** (free tier).
  Un dashboard, du SSR et des API routes dans une seule techno.
- **Base + Auth + Realtime + Storage** : **Supabase** (free tier).
  - Postgres (+ **PostGIS**) : indispensable pour le dédoublonnage, les filtres complexes et
    les requêtes géo (distance/trajet). Bien mieux que Firestore ici.
  - Auth intégrée + **Row Level Security** → multi-tenant propre sans réinventer l'auth.
  - **Realtime** → nouvelles annonces qui apparaissent en direct dans le dashboard.
  - Storage → pièces du dossier.
  - *Note : Firebase resterait jouable, mais le relationnel + géo de Postgres colle mieux au
    besoin. On garde Firebase en plan B si tu y tiens.*
- **Collecte (le point malin pour rester gratuit)** : collecteurs **Playwright (TS)** exécutés
  par un **cron GitHub Actions** (2000 min/mois gratuits, intervalle mini 5 min) qui écrit les
  annonces normalisées dans Supabase. Pas besoin de serveur qui tourne 24/7.
- **Trajet / géo** : API **Île-de-France Mobilités (PRIM) / Navitia** — gratuit, calcule le
  temps de trajet **en transports** (le vrai critère à Paris, pas la distance à vol d'oiseau).
- **Alertes email** : **Resend** (free tier) ; alertes temps réel in-app via Supabase Realtime.

⚠️ **Honnêteté technique/légale à garder en tête :**
- Scraper Leboncoin/SeLoger est **techniquement difficile** (anti-bot DataDome) et **fragile**
  (casse quand le site change). On démarre donc avec **1 source tractable** pour prouver la
  chaîne, puis on élargit.
- Le scraping pour **usage perso**, faible volume, est toléré ; **avant toute revente**, il faut
  passer à une **source licenciée (Melo)** et revoir les CGU. Le code est conçu pour que ce
  basculement soit un simple changement de « collecteur ».

## Architecture — les briques

```
[Sources]  →  [Collecteurs pluggables]  →  [Normalisation + Dédup]  →  [Postgres/Supabase]
 (Playwright via GitHub Actions cron ; interface commune → swap Melo API plus tard)
                                                                          │
                        ┌─────────────────────────────────────────────────┤
                        ▼                              ▼                    ▼
                 [Scoring par user]            [Alertes]            [Dashboard Next.js]
           (trajet transit, prix/m²,     (Realtime in-app +      (liste triée, filtres,
            fraîcheur, anti-arnaque)       email Resend)          fiche annonce, dossier)
```

## Modèle de données (Supabase / Postgres)

- `sources` — chaque site/collecteur (nom, actif, type scraping|api).
- `listings` — **pool partagé** d'annonces normalisées : titre, prix, charges, surface, pièces,
  meublé, adresse/quartier, `geo` (PostGIS point), url, `source_id`, `first_seen_at`,
  `content_hash` (dédup), photos.
- `profiles` — utilisateurs (lié à Supabase Auth).
- `search_profiles` — **critères par utilisateur** : budget max tout compris, surface min,
  pièces, zones/arrondissements, meublé, **adresse cible + temps de trajet max** (le fameux tri).
- `matches` — jointure `listing × search_profile` avec **score** + détail (trajet calculé,
  écart prix/m², flags arnaque). Calculé à l'insertion d'annonce et à la modif d'un profil.
- `alerts` — préférences (canal email/in-app, seuil de score) + historique d'envoi (anti-doublon).
- `dossier_items` — pièces et infos du dossier, au-delà du lien DossierFacile (garant, revenus,
  champs libres demandés par les bailleurs), stockage fichiers via Supabase Storage.

RLS : chaque user ne voit que ses `search_profiles`, `matches`, `alerts`, `dossier_items` ;
`listings` est un pool lisible par tous (mais scoré individuellement).

## Roadmap par tranches verticales

Chaque tranche = fonctionnelle de bout en bout, testée dans l'app réelle, puis commit.

- **Phase 0 — Fondations.** Init Next.js + Supabase, auth (signup/login), déploiement Vercel
  d'un « hello world » connecté. *Livrable : je peux me connecter sur l'URL en prod.*
- **Phase 1 — Pipeline bout-en-bout, 1 source.** Un collecteur Playwright (source la plus
  tractable), normalisation + dédup, cron GitHub Actions, annonces affichées brutes dans le
  dashboard. *Livrable : des annonces réelles arrivent seules dans la liste.*
- **Phase 2 — Critères + scoring.** Formulaire `search_profile`, calcul du **temps de trajet
  transit**, du prix/m² et du score, liste **triée par pertinence** + filtres. *Livrable : je
  vois MES annonces classées.*
- **Phase 3 — Alertes.** Temps réel in-app (Supabase Realtime) + email (Resend), anti-doublon.
  *Livrable : je suis prévenu dans la minute d'un nouvel appart qui matche.*
- **Phase 4 — Dossier.** Upload pièces + champs extra + lien DossierFacile, prêt à copier/envoyer.
- **Phase 5 — Robustesse & sources.** Ajout de 2-3 sources, monitoring des collecteurs qui
  cassent, dédup inter-sources fine.
- **Phase 6 — Commercialisation.** Bascule collecteur → **API Melo**, facturation **Stripe**,
  onboarding multi-user, landing page, revue CGU/RGPD.

## Structure de dépôt proposée (greenfield)

```
/app            → Next.js (routes dashboard, auth, API)
/lib            → clients Supabase, scoring, calcul trajet
/collectors     → interface Collector + 1 impl. par source (Playwright)
/collectors/run.ts        → point d'entrée appelé par le cron
/.github/workflows/collect.yml  → cron GitHub Actions
/supabase/migrations      → schéma SQL (tables ci-dessus + RLS + PostGIS)
```

Fichiers clés à créer en premier : `supabase/migrations/0001_init.sql`,
`collectors/types.ts` (interface commune — c'est LUI qui rend le swap Melo trivial),
`lib/scoring.ts`, `app/(dashboard)/listings/page.tsx`.

## Vérification (à chaque phase, dans l'app réelle)

- **P0** : se connecter sur l'URL Vercel de prod, vérifier qu'une ligne user apparaît dans Supabase.
- **P1** : déclencher le workflow GitHub Actions à la main, vérifier N annonces réelles insérées,
  0 doublon sur un 2e passage (test du `content_hash`), affichage dans le dashboard.
- **P2** : créer un `search_profile` avec une adresse cible → vérifier le temps de trajet calculé
  contre Google Maps, et l'ordre de tri.
- **P3** : insérer une annonce test qui matche → l'email arrive + apparition temps réel, et pas de
  2e email au passage suivant.
- **P4** : uploader une pièce, la re-télécharger, vérifier l'isolation RLS avec un 2e compte.
- Chaque phase : lint + build Next OK avant commit.

## Points ouverts (à trancher au fil de l'eau)

- **Quelle 1re source** scraper (candidates : PAP semble la plus tractable ; Leboncoin via son
  API mobile mais fragile). À décider en Phase 1.
- **Choix API trajet** : PRIM/IDFM vs Navitia vs Google (crédit gratuit) — bench en Phase 2.
- **Tarif Melo** et revue **CGU/RGPD** à faire avant Phase 6, pas avant.
