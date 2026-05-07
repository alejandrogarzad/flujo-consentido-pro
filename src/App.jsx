import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { useRole } from '@/lib/useRole';
import Layout from './components/Layout';

// Pages
import Dashboard from './pages/Dashboard';
import Pacientes from './pages/Pacientes';
import Empleados from './pages/Empleados';

import Cobranza from './pages/Cobranza.jsx';
import Calendarios from './pages/Calendarios';
import CitasEvaluaciones from './pages/CitasEvaluaciones';
import Subarrendamiento from './pages/Subarrendamiento';
import Gastos from './pages/Gastos';
import Nomina from './pages/Nomina';
import Impuestos from './pages/Impuestos';
import CXC from './pages/CXC';
import FlujoEfectivo from './pages/FlujoEfectivo';
import Parametros from './pages/Parametros';
import Usuarios from './pages/Usuarios';
import CapturaTerapias from './pages/CapturaTerapias';
import CapturaGasto from './pages/CapturaGasto';
import ParaContador from './pages/ParaContador';
import HorariosTerapeutas from './pages/HorariosTerapeutas';
import ResumenIngresos from './pages/ResumenIngresos';

function AppRoutes() {
  const { role, loading } = useRole();

  if (loading) return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );

  // Role-based routing
  if (role === "cap_terapias") {
    return (
      <Routes>
        <Route path="*" element={<CapturaTerapias />} />
      </Routes>
    );
  }

  if (role === "cap_gastos") {
    return (
      <Routes>
        <Route path="*" element={<CapturaGasto />} />
      </Routes>
    );
  }

  if (role === "cap_pagos") {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Cobranza />} />
          <Route path="/cobranza" element={<Cobranza />} />
          <Route path="*" element={<Cobranza />} />
        </Route>
      </Routes>
    );
  }

  // Admin y user (acceso completo)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pacientes" element={<Pacientes />} />
        <Route path="/empleados" element={<Empleados />} />

        <Route path="/cobranza" element={<Cobranza />} />
        <Route path="/calendarios" element={<Calendarios />} />
        <Route path="/citas-evaluaciones" element={<CitasEvaluaciones />} />
        <Route path="/subarrendamiento" element={<Subarrendamiento />} />
        <Route path="/gastos" element={<Gastos />} />
        <Route path="/nomina" element={<Nomina />} />
        <Route path="/impuestos" element={<Impuestos />} />
        <Route path="/cxc" element={<CXC />} />
        <Route path="/flujo-efectivo" element={<FlujoEfectivo />} />
        <Route path="/parametros" element={<Parametros />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="/para-contador" element={<ParaContador />} />
        <Route path="/horarios-terapeutas" element={<HorariosTerapeutas />} />
        <Route path="/resumen-ingresos" element={<ResumenIngresos />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }

  return <AppRoutes />;
};

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
        <Toaster />
      </Router>
    </QueryClientProvider>
  )
}

export default App