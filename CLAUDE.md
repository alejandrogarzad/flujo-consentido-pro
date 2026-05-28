# CLAUDE.md — Flujo Consentido Pro

Documento de contexto para sesiones futuras de Claude. Léelo entero antes de tocar código.

---

## ⚠️ Lo más importante: HAY DOS CODEBASES en este repo

El repo contiene dos apps. **Solo una está desplegada.**

| Carpeta | Stack | Estado | ¿Editar? |
|---|---|---|---|
| `src/` | Vite + React + Base44 SDK | **Prototipo viejo, NO desplegado** | ❌ NO |
| `next-app/` | Next.js (App Router) + Supabase + Tailwind | **PRODUCCIÓN en Vercel** | ✅ SÍ |

**El sitio en `https://flujo-consentido-pro.vercel.app` se sirve desde `next-app/`.** Si editas `src/`, la usuaria no verá nada cambiar y se va a enojar (con justa razón — ya pasó en esta sesión y costó horas).

Verifica siempre antes de editar:
```bash
ls next-app/src/app/\(app\)/    # ← aquí viven las páginas reales
```

---

## Sobre el producto

Sistema de gestión para **Centro Con-sentido** (clínica de terapia infantil). Lo opera una capturista; la dueña/directora supervisa. Funciones principales:

- **Pacientes**: ficha con precio por sesión, mes de inicio/alta, **Horario Semanal** (días de la semana con hora, tipo y terapeuta).
- **Calendarios**: genera el calendario mensual de sesiones por paciente, con asuetos y reposiciones.
- **Cobranza**: vista mensual de cuánto debió pagar cada paciente, cuánto pagó, saldo, estatus. Incluye arrastre de saldos previos.
- **Citas y Evaluaciones**: eventos puntuales fuera de la terapia regular (citas con la directora, evaluaciones, reportes).
- **Para el Contador**: resumen mensual SAT (subtotal, IVA, total) para emisión de CFDI.
- **Impuestos / Flujo de Efectivo / Nómina / Gastos / Subarrendamiento / Respaldo Excel**.

---

## Arquitectura `next-app/`

```
next-app/
├── src/
│   ├── app/
│   │   ├── (app)/<página>/page.tsx    # cada página con Sidebar
│   │   ├── api/                       # endpoints (invite user, etc.)
│   │   ├── login/                     # Supabase auth
│   │   ├── layout.tsx, page.tsx
│   ├── components/
│   │   ├── layout/Sidebar.tsx
│   │   └── ui/                        # shadcn-style
│   ├── lib/
│   │   ├── calculos.ts               ⭐ lógica de negocio (terapias, eventos, nómina, ISR/IMSS, generarCalendario)
│   │   ├── db.ts                      # capa Supabase (entidades, .list/.filter/.create/.update/.delete/.subscribe)
│   │   ├── supabase/{client,server,middleware}.ts
│   │   ├── permissions.ts             # roles (admin, capturista, contador)
│   │   ├── exportExcel.ts             # respaldo Excel multi-pestaña
│   │   ├── date.ts, utils.ts
│   └── types/db.ts                    # Paciente, CalendarioPaciente, PagoTerapia, Evento, etc.
├── next.config.mjs                    # eslint warnings NO bloquean; TS errors SÍ
├── vercel.json                        # framework: nextjs
└── package.json
```

**Backend**: Supabase (Postgres + Auth + Realtime).
- RLS activado en todas las tablas relevantes (ver `supabase/schema.sql` y `schema-v2.sql`).
- Política única: `authenticated_full_access` — solo usuarios autenticados leen/escriben. La `anon key` NO puede leer datos.
- Realtime: `db.<tabla>.subscribe(cb)` se usa en varias páginas para refrescar cuando cambia algo.

**Deploy**: push a `main` → Vercel rebuildea automáticamente. Toma ~1-2 min.

---

## Convenciones críticas (NO romper)

### 💰 `monto_pagado` es SIEMPRE el TOTAL recibido

Tras horas de debugging en esta sesión, la convención del sistema quedó así:

> El usuario captura **exactamente lo que entró a la cuenta** (con IVA si la forma de pago es Transferencia/Tarjeta/Depósito; sin IVA si es Efectivo). **Nunca multiplicar `monto_pagado × 1.16`.** El IVA se deriva en las pantallas del contador con `subtotal = monto/(1+iva)`.

Aplica a:
- `pago_terapia.monto_pagado` (Cobranza)
- `evento.monto_pagado` (Citas y Evaluaciones)
- `subarrendamiento.monto_cobrado`

Los saldos se calculan así:
```ts
saldo = totalEsperado - montoPagado;   // sin inflar nada
if (Math.abs(saldo) <= 50) saldo = 0;  // tolerancia por redondeos de IVA
```

`Para el Contador` y `Impuestos` ya derivan el desglose:
```ts
subtotal = montoPagado / (1 + ivaRate);
iva      = montoPagado * ivaRate / (1 + ivaRate);
```

❌ **Antipatrón a evitar:** `Math.round(montoPagado * (1 + ivaRate))` — esto infla el IVA dos veces y genera saldos negativos fantasma. Fue el bug central de varios commits en esta sesión.

### 📅 Cálculo del esperado mensual: una sola función

En `next-app/src/app/(app)/cobranza/page.tsx` existe `calcularEsperadoMes(cal, sesionesManual, forma, recargo, params, paciente, mes, anio)`. **Es la fuente única de verdad** y la usan tanto:
- `buildRow` (vista del mes actual)
- El bloque de arrastre de saldos previos (`saldosAFavor`)

Si las dos rutas calculan distinto, un mes que cuadra en su vista propia genera deuda fantasma al arrastrarse. **No reintroducir cálculos paralelos.** Si cambias la lógica del esperado, cámbiala en `calcularEsperadoMes` y punto.

Prioridad de fuentes para el esperado:
1. `monto_override` del calendario (si está, manda — incluso 0)
2. `sesiones_manual` del pago (sesiones × precio regular del paciente)
3. `calcularSesionesDesdeCal` aplicado al calendario guardado (que respeta `total_sesiones` si está)
4. `dias_sesion` de la ficha como fallback (si no hay calendario)

Luego: recargo 10% si aplica → IVA si la forma de pago lo incluye.

### 📋 Calendario: merge día por día con la ficha

`next-app/src/app/(app)/calendarios/page.tsx` — al cargar un calendario guardado para editar, los días vacíos del calendario se completan desde `dias_sesion` de la ficha del paciente. Los días que el calendario guardado SÍ tiene capturados mandan (overrides del mes).

Esto resuelve el caso "viernes 3pm no aparece" cuando la ficha tiene viernes pero el calendario guardado (creado antes) no.

**Ausencias puntuales**: se manejan con `excepciones` (lista de días numéricos), NO quitando un día del horario semanal del mes.

### 🔒 Saldos a favor / en contra (arrastre)

Cobranza arrastra saldos desde **mayo 2026** (`mesBaseInicio`) hasta el mes anterior al filtrado. Por cada (paciente, mes) en el rango:
- Compara `montoPagadoTotal - totalEsperado` usando `calcularEsperadoMes`.
- Si `|dif| > 50`: acumula. Positivo = saldo a favor. Negativo = deuda.

El resultado se llama `saldoAFavor` en el código pero **representa ambas direcciones** (puede ser negativo).

---

## Páginas principales (en `next-app/src/app/(app)/`)

| Ruta | Archivo | Notas |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | Resumen mensual y proyecciones |
| `/pacientes` | `pacientes/page.tsx` | CRUD; al guardar, hace backfill de calendarios vacíos desde la ficha hasta el mes actual |
| `/calendarios` | `calendarios/page.tsx` | Editor por paciente/mes; merge desde ficha; asuetos del mes; recalcular masivo |
| `/cobranza` | `cobranza/page.tsx` | Vista mensual de CxC con arrastre de saldos |
| `/cxc` | `cxc/page.tsx` | Matriz anual paciente × mes |
| `/citas-evaluaciones` | `citas-evaluaciones/page.tsx` | Eventos no-terapia |
| `/captura-terapias` | — | Captura simplificada de pagos |
| `/terapias` | — | Vista de sesiones mensuales |
| `/para-contador` | `para-contador/page.tsx` | Resumen SAT |
| `/impuestos` | `impuestos/page.tsx` | IVA trasladado/acreditado, ISR |
| `/nomina` | `nomina/page.tsx` | Cálculo nómina MX 2026 (LISR, IMSS, INFONAVIT) |
| `/flujo-efectivo` | `flujo-efectivo/page.tsx` | Proyección anual |
| `/respaldo` | `respaldo/page.tsx` | Export Excel multi-pestaña |
| `/parametros` | `parametros/page.tsx` | Precios globales, IVA, tasas |

---

## Comandos / workflow

```bash
# Setup (una vez)
cd next-app && npm install

# Typecheck — gate principal antes de commit
cd next-app && npx tsc --noEmit

# Build local — falla en prerender por falta de envs Supabase locales,
# pero eso es esperado; lo importante es que TypeScript pase.
cd next-app && npx next build

# Push directo a main (la usuaria pide deploy inmediato):
git push origin HEAD:main
```

Variables de entorno requeridas en Vercel (ya configuradas allá):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (para scripts de seed/admin)

En este sandbox local **no hay envs Supabase configuradas**, así que no se puede correr la app ni consultar la BD desde aquí sin que el usuario las pase explícitamente.

---

## Convención de commits y branches

- Rama de trabajo: `claude/review-session-progress-9IWUO`. Push a `main` directo cuando la usuaria pida deploy.
- Mensajes en español, con cuerpo explicativo. Formato `type(scope): resumen`.
- Ejemplo de tipos vistos: `fix`, `feat`, `refactor`, `chore`, `style`.

---

## Cosas que NO debes hacer

1. ❌ Editar `src/` (es el Vite prototype muerto).
2. ❌ Multiplicar `monto_pagado * (1 + iva)` en ningún lado.
3. ❌ Calcular el esperado mensual de Cobranza fuera de `calcularEsperadoMes`.
4. ❌ Agregar `Co-Authored-By: Claude` o "Generated with Claude Code" en commits/PRs en repos públicos.
5. ❌ Mencionar el identificador del modelo (`claude-opus-4-7[1m]`) en artefactos que se pushean.
6. ❌ Pushear emojis o decoraciones en el código a menos que la usuaria los pida.
7. ❌ Asumir que un fix funcionó sin que la usuaria confirme — Vercel tarda ~1-2 min en redeployar y el caché del navegador puede engañar.

---

## Cosas que SÍ debes hacer

1. ✅ Verificar `pwd` y la ruta exacta antes de editar (parentesis en `(app)/` rompen algunos comandos shell).
2. ✅ `npx tsc --noEmit` antes de commitear.
3. ✅ Tono directo en español, sin pregunta inflada. La usuaria valora velocidad y honestidad sobre opciones múltiples.
4. ✅ Si algo es un problema de datos (no de código), decirlo claro y pedirle a la usuaria que verifique un punto específico (sí/no).
5. ✅ Si hay un bug real, encontrarlo y arreglarlo — no proponer "envolturas" que evaden el problema.

---

## Pendientes conocidos al cierre de esta sesión

- **Auditoría de calendarios incompletos guardados**: hay datos viejos en `calendario_paciente` cuyo `horario` no incluye todos los días que sí están en la ficha del paciente. El fix de merge (commit `45265ab`) corrige la VISTA, pero los totales guardados (`total_sesiones`, `sesiones_regulares`, etc.) siguen reflejando el horario incompleto hasta que se reabra y re-guarde cada mes. La usuaria pidió pasar credenciales de Supabase para correr una auditoría externa; quedó pendiente recibirlas.

- **Posible edit-loss en `calendarios/page.tsx`**: el `useEffect` que carga el horario tiene `calendarios` y `pacientes` en deps. Si la suscripción realtime refresca cualquiera de los dos arrays mientras la usuaria edita pero antes de guardar, el effect re-corre y resetea el formulario, perdiendo edits no guardados. No urgente porque el merge auto-completa lo más común, pero conviene revisarlo con una ref que tracke la clave de selección.

- **`FlujoEfectivo.jsx` (en el viejo `src/`, irrelevante para producción)** tenía un cálculo de IVA inflado (`monto × 0.16` cuando ya es total). Si alguna vez se migra esa lógica a `next-app/`, asegúrate de usar `monto × iva/(1+iva)`.

---

## Historial corto de la sesión (mayo 2026)

Los commits relevantes y qué resolvieron:

```
45265ab fix(calendarios): merge día por día desde la ficha al cargar
36c52a5 fix(calendarios): respaldo cuando horario guardado está vacío
66d79d2 fix(cobranza): calcularEsperadoMes unificado — fin de deudas fantasma en arrastre
a3635cb fix(next-app): monto_pagado = total recibido en Cobranza + Citas (en el código REAL)
6baac9c fix(eventos): elimina cutoff por fecha, monto_pagado siempre total
fb82970 fix(cobranza): primer intento — elimina columna "Con IVA" (en src/, NO desplegado)
```

Lección: confirmar dónde vive el deploy ANTES de pasar horas tocando código.
