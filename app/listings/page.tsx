"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";

export default function ListingsPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();

  // Garde d'auth côté client : pas connecté → login.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

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
          <p className="text-sm opacity-60">{user.email}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm rounded-md border border-black/15 dark:border-white/20 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          Se déconnecter
        </button>
      </header>

      <div className="mt-8 rounded-lg border border-dashed border-black/15 dark:border-white/20 p-8 text-center">
        <p className="text-sm opacity-60">
          Phase 0 — connexion OK ✔<br />
          Le feed d&apos;annonces arrivera en Phase 1 (collecteur PAP).
        </p>
      </div>
    </main>
  );
}
