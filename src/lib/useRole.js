import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export function useRole() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => { setUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const role = user?.role || "user";
  const isAdmin = role === "admin";
  const isCapTerapias = role === "cap_terapias";
  const isCapPagos = role === "cap_pagos";
  const isCapGastos = role === "cap_gastos";

  return { user, loading, role, isAdmin, isCapTerapias, isCapPagos, isCapGastos };
}