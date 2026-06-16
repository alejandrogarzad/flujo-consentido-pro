"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, UserCog, CreditCard, Receipt, Building2,
  Wallet, BarChart3, FileText, TrendingUp, Settings, LogOut, ChevronRight,
  Menu, X, Calendar, Calculator, CalendarDays, Loader2, Download,
} from "lucide-react";
import { db, type AuthUser } from "@/lib/db";
import { canAccess } from "@/lib/permissions";
import { routeColor } from "@/lib/brand";
import { BrandLogo } from "@/components/ConsentidoLogo";

const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/pacientes", label: "Pacientes", icon: Users },
  { path: "/empleados", label: "Empleados", icon: UserCog },
  { path: "/cobranza", label: "Terapias", icon: CreditCard },
  { path: "/calendarios", label: "Calendarios", icon: Calendar },
  { path: "/citas-evaluaciones", label: "Citas y Evaluaciones", icon: FileText },
  { path: "/subarrendamiento", label: "Subarrendamiento", icon: Building2 },
  { path: "/gastos", label: "Gastos", icon: Receipt },
  { path: "/nomina", label: "Nómina", icon: Wallet },
  { path: "/impuestos", label: "Impuestos", icon: BarChart3 },
  { path: "/cxc", label: "Cuentas x Cobrar", icon: TrendingUp },
  { path: "/flujo-efectivo", label: "Flujo de Efectivo", icon: TrendingUp },
  { path: "/horarios-terapeutas", label: "Horarios Terapeutas", icon: CalendarDays },
  { path: "/resumen-ingresos", label: "Resumen de Ingresos", icon: TrendingUp },
  { path: "/para-contador", label: "Para el Contador", icon: Calculator },
  { path: "/parametros", label: "Parámetros", icon: Settings },
  { path: "/respaldo", label: "Respaldo / Exportar", icon: Download },
  { path: "/usuarios", label: "Usuarios", icon: UserCog },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    db.auth.me().then(setUser);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await db.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-stone-100">
        <button onClick={() => setOpen(true)} className="text-stone-500">
          <Menu size={20} />
        </button>
        <BrandLogo size={34} />
      </div>

      <aside
        className={`
          fixed top-0 left-0 h-full z-30 w-64 bg-white border-r border-stone-100 flex flex-col
          transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 md:static md:z-auto
        `}
      >
        <div className="px-4 py-4 border-b border-stone-100 relative flex flex-col items-center">
          <BrandLogo size={92} />
          <div className="text-[11px] font-semibold text-stone-400 mt-1 tracking-wide">Centro Terapéutico</div>
          <button className="md:hidden text-stone-400 absolute top-3 right-3" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {NAV_ITEMS.filter((item) => !user || canAccess(user.role, item.path)).map(({ path, label, icon: Icon }) => {
            const active = pathname === path || pathname.startsWith(`${path}/`);
            const c = routeColor(path);
            return (
              <Link
                key={path}
                href={path}
                onClick={() => setOpen(false)}
                style={active ? { background: c.soft, color: c.text } : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm font-semibold transition-all
                  ${active ? "" : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"}
                `}
              >
                <Icon size={17} style={{ color: c.base }} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight size={14} />}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-stone-100">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                <span className="text-xs font-bold text-violet-700">
                  {(user.full_name || user.email)[0]?.toUpperCase() || "U"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-stone-700 truncate">
                  {user.full_name || user.email}
                </p>
                <p className="text-xs text-stone-400 truncate">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-stone-400 hover:text-red-500 transition-colors"
                title="Cerrar sesión"
              >
                {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone-400">Cargando…</p>
          )}
        </div>
      </aside>
    </>
  );
}
