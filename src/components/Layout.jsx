import { Link, Outlet, useLocation } from "react-router-dom";
import { useRole } from "@/lib/useRole";
import { base44 } from "@/api/base44Client";
import {
  LayoutDashboard, Users, UserCog, ClipboardList, CreditCard,
  Receipt, Building2, Wallet, BarChart3, FileText, TrendingUp,
  Settings, LogOut, ChevronRight, Menu, X, Calendar, Calculator, CalendarDays
} from "lucide-react";
import { useState } from "react";

const adminNavItems = [
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
  { path: "/usuarios", label: "Usuarios", icon: UserCog },
];

export default function Layout() {
  const { user, role, isAdmin } = useRole();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = isAdmin ? adminNavItems : adminNavItems;

  const handleLogout = () => {
    base44.auth.logout("/");
  };

  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-30 w-64 bg-white border-r border-stone-100 flex flex-col
        transition-transform duration-300
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:static md:z-auto
      `}>
        {/* Logo */}
        <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
          <img
            src="https://media.base44.com/images/public/69ecf337cc17ef420867cd71/cffec5a1c_WhatsAppImage2026-04-25at122318.jpg"
            alt="con-sentido"
            className="h-14 w-auto object-contain"
          />
          <button className="md:hidden text-stone-400" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium transition-all
                  ${active
                    ? "bg-violet-50 text-violet-700"
                    : "text-stone-500 hover:bg-stone-50 hover:text-stone-800"}
                `}
              >
                <Icon size={16} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight size={14} />}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-stone-100">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                <span className="text-xs font-bold text-violet-700">
                  {user?.full_name?.[0]?.toUpperCase() || "U"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-stone-700 truncate">{user?.full_name || "Usuario"}</p>
                <p className="text-xs text-stone-400">{role}</p>
              </div>
              <button onClick={handleLogout} className="text-stone-400 hover:text-red-500 transition-colors" title="Cerrar sesión">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => base44.auth.redirectToLogin()}
              className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
            >
              <LogOut size={14} className="rotate-180" />
              Iniciar sesión
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar mobile */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-stone-100">
          <button onClick={() => setSidebarOpen(true)} className="text-stone-500">
            <Menu size={20} />
          </button>
          <span className="font-bold text-violet-700">Con-Sentido</span>
        </div>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}