"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/listings");
  }, [user, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      router.replace("/listings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/30";

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🏠</div>
          <h1 className="text-xl font-semibold">Chasseur d&apos;appart Paris</h1>
          <p className="text-sm text-muted mt-1">Agrège, score et alerte — trouve avant les autres.</p>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5 mb-1">
            <button type="button" onClick={() => setMode("login")}
              className={`flex-1 text-sm rounded-md py-1.5 ${mode === "login" ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>Connexion</button>
            <button type="button" onClick={() => setMode("signup")}
              className={`flex-1 text-sm rounded-md py-1.5 ${mode === "signup" ? "bg-surface shadow-sm font-medium" : "text-muted"}`}>Créer un compte</button>
          </div>

          <input type="email" required placeholder="email@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          <input type="password" required minLength={6} placeholder="mot de passe (6+ caractères)" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full rounded-lg bg-accent text-white py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
            {busy ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
          </button>
        </form>
      </div>
    </main>
  );
}
