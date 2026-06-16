"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { db } from "@/lib/db";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/ConsentidoLogo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirectTo") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await db.auth.signInWithPassword(email, password);
      router.replace(redirectTo);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white border border-stone-100 rounded-2xl shadow-sm p-7"
      >
        <div className="flex justify-center mb-2">
          <BrandLogo size={128} />
        </div>
        <p className="text-sm text-stone-500 mb-6 text-center">Inicia sesión para continuar</p>

        <label className="block text-xs font-medium text-stone-600 mb-1">Correo</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-violet-200"
        />

        <label className="block text-xs font-medium text-stone-600 mb-1">Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-violet-200"
        />

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          Iniciar sesión
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-stone-500">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
