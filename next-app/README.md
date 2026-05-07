# Flujo Consentido — Next.js + Supabase

App de gestión de clínica de terapias migrada desde Base44 (Vite+React) a Next.js 14 (App Router) + Supabase.

## Setup local

### 1. Variables de entorno

```bash
cp .env.local.example .env.local
```

Llena los tres valores:

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` se encuentran en Supabase Dashboard → tu proyecto → **Settings → API**.
- `SUPABASE_SERVICE_ROLE_KEY` (también en Settings → API, sección "Project API keys", `service_role secret`). **NUNCA** la expongas al cliente; solo la usan API Routes, Server Actions y scripts.

### 2. Schema de Supabase

Desde la raíz del repo (no desde `next-app/`):

```bash
# 1. Crea un proyecto en supabase.com
# 2. Conecta el CLI:
supabase login
supabase link --project-ref TU_REF

# 3. Aplica schema y seed:
supabase db push --include-seed
# o pega manualmente el contenido de:
#   supabase/schema.sql
#   supabase/seed.sql
# en el SQL Editor del Dashboard.
```

Si no estás usando el CLI, puedes pegar el contenido de `../supabase/schema.sql` y luego `../supabase/seed.sql` directamente en el **SQL Editor** del Dashboard de Supabase.

### 3. Instalar dependencias y arrancar

```bash
npm install
npm run dev
```

Abre http://localhost:3000.

## Estructura

```
next-app/
├── src/
│   ├── app/                 # App Router (rutas)
│   ├── components/
│   │   └── ui/              # shadcn/ui (47 componentes)
│   ├── lib/
│   │   ├── supabase/        # cliente browser + server + middleware
│   │   ├── calculos/        # lógica de negocio pura (migrada de calculos.js)
│   │   ├── db.ts            # adaptador con misma firma que base44.entities.X
│   │   └── utils.ts         # cn() helper de shadcn
│   ├── types/               # tipos TS de las entidades
│   └── hooks/
└── public/
```

Y en la raíz del repo:

```
supabase/
├── schema.sql               # 12 tablas + enum forma_pago + RLS
├── seed.sql                 # Parametros default (anio_actual, precios, etc.)
└── functions/               # Edge Functions (Fase 5)
```

## Decisiones de diseño relevantes

- **Año actual:** se lee desde `Parametro.clave='anio_actual'`. Fallback a `new Date().getFullYear()` si no está poblado. Configurable desde la UI de Parametros.
- **Locale:** todas las fechas se formatean con `date-fns` + `locale: es`.
- **Toasts:** sólo `sonner` (`position="top-right"`, `duration={4000}`). Removidos `react-hot-toast` y el toaster legacy de shadcn.
- **RLS:** en esta fase todas las tablas tienen `"authenticated full access"`. La Fase 6.5 del plan refinará policies por rol antes de exponer la app a usuarios externos.

## Comandos útiles

```bash
npm run dev          # dev server con HMR
npm run build        # build de producción
npm run start        # servir build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```
