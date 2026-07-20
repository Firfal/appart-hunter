"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";

type Listing = {
  id: string;
  source: string;
  url: string;
  priceTotal: number | null;
  surface: number | null;
  rooms: number | null;
  furnished: boolean | null;
  dpe: string | null;
  arrondissement: number | null;
  city: string | null;
  isPro: boolean | null;
  thumbUrl: string | null;
  photoCount: number | null;
};

export default function ListingsPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [listings, setListings] = useState<Listing[] | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const q = query(collection(db, "listings"), orderBy("firstSeenAt", "desc"), limit(60));
      const snap = await getDocs(q);
      setListings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Listing, "id">) })));
    })();
  }, [user]);

  if (loading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm opacity-60">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
      <header className="flex items-center justify-between border-b border-black/10 dark:border-white/15 pb-4">
        <div>
          <h1 className="text-lg font-semibold">Annonces</h1>
          <p className="text-sm opacity-60">
            {listings ? `${listings.length} annonces` : "…"} · {user.email}
          </p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          Se déconnecter
        </button>
      </header>

      {listings === null ? (
        <p className="mt-8 text-sm opacity-60">Chargement des annonces…</p>
      ) : listings.length === 0 ? (
        <p className="mt-8 text-sm opacity-60">Aucune annonce pour l&apos;instant.</p>
      ) : (
        <ul className="mt-4 divide-y divide-black/10 dark:divide-white/10">
          {listings.map((l) => (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 py-3 hover:bg-black/5 dark:hover:bg-white/5 rounded-md px-2 -mx-2"
              >
                {l.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbUrl}
                    alt=""
                    className="h-16 w-20 object-cover rounded-md shrink-0 bg-black/10"
                  />
                ) : (
                  <div className="h-16 w-20 rounded-md shrink-0 bg-black/10 dark:bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">
                      {l.priceTotal != null ? `${l.priceTotal} €` : "?"}
                    </span>
                    <span className="text-sm opacity-70">
                      {l.surface ?? "?"} m² · {l.rooms ?? "?"}p
                      {l.furnished ? " · meublé" : ""}
                    </span>
                  </div>
                  <div className="text-sm opacity-60 truncate">
                    {l.arrondissement ? `Paris ${l.arrondissement}e` : l.city ?? "?"}
                    {l.dpe && l.dpe !== "NS" ? ` · DPE ${l.dpe}` : ""}
                    {l.isPro ? " · agence" : " · particulier"}
                    {` · ${l.source}`}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
