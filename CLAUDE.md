# CLAUDE.md — Flujo Consentido Pro

Documento de contexto para sesiones futuras de Claude. Léelo entero antes de tocar código.

---

## ⚠️ Lo más importante: HAY DOS CODEBASES en este repo

El repo contiene dos apps. **Solo una está desplegada.**

| Carpeta | Stack | Estado | ¿Editar? |
|---|---|---|---|
| `src/` | Vite + React + Base44 SDK | **Prototipo viejo, NO desplegado** | ❌ NO |
| `next-app/` | Next.js (App Router) + Supabase + Tailwind | **PRODUCCIÓN en Vercel** | ✅ SÍ |

**El sitio en `https://flujo-consentido-pro.vercel.app` se sirve desde `next-app/`.** Si editas `src/`, la usuaria no verá nada cambiar y se va a enojar (con justa razón — ya pasó en sesiones anteriores y costó horas).

Verifica siempre antes de editar:
```bash
ls next-app/src/app/\(app\)/    # ← aquí viven las páginas reales
```

---

## Sobre el producto

Sistema de gestión para **Centro Con-sentido** (clínica de terapia infantil). Lo opera una capturista; la dueña/directora supervisa. Funciones principales:

- **Pacientes**: ficha con precio por sesión, mes de inicio/alta, **Horario Semanal** (días de la semana con hora, tipo y terapeuta).
- **Calendarios**: genera el calendario mensual de sesiones por paciente, con asuetos y reposiciones.
- **Cobranza**: vista mensual de cuánto debió pagar cada paciente, cuánto pagó, saldo, estatus. Incluye arrastre de saldos previos desde mayo 2026.
- **Citas y Evaluaciones**: eventos puntuales fuera de la terapia regular.
- **Para el Contador**: resumen mensual SAT (subtotal, IVA, total) bajo régimen de flujo de efectivo.
- **Impuestos / Flujo de Efectivo / Nómina / Gastos / Subarrendamiento / Respaldo Excel**.

Usuarios actuales:
- Admin: `alejandro.garzad@gmail.com` (dueño).
- Contador (solo lectura, solo `/para-contador`): `contabilidad@centroconsentido.com` / password `Consentido`.

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
│   │   ├── db.ts                      # capa Supabase — usa listAll/filterAll en lugar de list/filter, ver §Convenciones
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
- **`profile.role` es un ENUM `app_role_enum`** con valores: `admin`, `user`, `cap_terapias`, `cap_pagos`, `cap_gastos`, `contador`. Para agregar valores nuevos hay que hacer `ALTER TYPE` en SQL — ver §Roles.

**Deploy**: push a `main` → Vercel rebuildea automáticamente. Toma ~1-2 min.

**Acceso a BD desde scripts locales**: hay `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Scripts `.mjs` en `next-app/` pueden conectarse y leer/escribir BD real. **No subir scripts con credenciales al repo** — borrar después de usar.

---

## Convenciones críticas (NO romper)

### 🔴 Supabase trunca a 1000 filas — USAR `listAll` / `filterAll`

Supabase tiene un cap server-side de **1000 filas máximo por query**, configurado en el dashboard del proyecto ("Max Rows"). Aunque el cliente pida `limit(20000)`, el servidor regresa exactamente 1000. **Subir el `limit` desde el código no hace nada.**

Este fue el bug residual de junio 2026 — el caso "Andrés Gómez Saldo previo -$1,100" cuando mayo cuadraba: con 1029 calendarios en BD y `.list("-created_date", 1000)`, el cal de mayo de Andrés quedaba fuera, el código caía al fallback de `paciente.dias_sesion` para regenerar el calendario, y ese fallback IGNORABA `excepciones` (feriados) generando 1 sesión fantasma.

**Solución (ya aplicada en toda la app)**: `db.X.listAll(orderBy)` y `db.X.filterAll(where, orderBy)` en `lib/db.ts` paginan con `.range(off, off+999)` hasta agotar las filas, con `id` como tiebreaker para paginación estable.

```ts
// ❌ NO
const cals = await db.calendario_paciente.list("-created_date", 10000);

// ✅ SÍ
const cals = await db.calendario_paciente.listAll("-created_date");
```

**Tope de seguridad**: `listAll` se detiene a las 200,000 filas para no colgar el browser.

**Caveat**: el default `listAll("orderBy = -created_date")` falla en `profile` (tabla sin `created_date`). Pasar orderBy explícito: `db.profile.listAll("email")`.

**Auditoría hecha**: TODA página crítica que carga `pago_terapia`, `calendario_paciente`, `sesion_mensual`, `evento`, `gasto`, `nomina_mensual`, `subarrendamiento` ya usa `listAll()`. Si agregas una página nueva, sigue el mismo patrón. `filter()` con condiciones estrechas (mes/año/paciente_id específico) está OK sin paginación.

### 💰 `monto_pagado` es SIEMPRE el TOTAL recibido

> El usuario captura **exactamente lo que entró a la cuenta** (con IVA si la forma de pago es Transferencia/Tarjeta/Depósito; sin IVA si es Efectivo). **Nunca multiplicar `monto_pagado × 1.16`.** El IVA se deriva en las pantallas del contador con `subtotal = monto/(1+iva)`.

Aplica a:
- `pago_terapia.monto_pagado` (Cobranza)
- `evento.monto_pagado` (Citas y Evaluaciones)
- `subarrendamiento.monto_cobrado`

Saldos:
```ts
saldo = totalEsperado - montoPagado;   // sin inflar nada
if (Math.abs(saldo) <= 50) saldo = 0;  // tolerancia por redondeos de IVA
```

Desglose en `/para-contador` e `/impuestos`:
```ts
subtotal = montoPagado / (1 + ivaRate);
iva      = montoPagado * ivaRate / (1 + ivaRate);
```

❌ **Antipatrón a evitar**: `Math.round(montoPagado * (1 + ivaRate))` — infla el IVA dos veces y genera saldos negativos fantasma.

### 📅 Cálculo del esperado mensual: una sola función

En `next-app/src/app/(app)/cobranza/page.tsx` existe `calcularEsperadoMes(cal, sesionesManual, forma, recargo, params, paciente, mes, anio)`. **Es la fuente única de verdad** y la usan tanto:
- `buildRow` (vista del mes actual)
- El bloque de arrastre de saldos previos (`saldosAFavor`)

Si las dos rutas calculan distinto, un mes que cuadra en su vista propia genera deuda fantasma al arrastrarse. **No reintroducir cálculos paralelos.**

Prioridad de fuentes para el esperado:
1. `monto_override` del calendario (si está, manda — incluso 0)
2. `sesiones_manual` del pago (sesiones × precio regular del paciente)
3. `calcularSesionesDesdeCal` aplicado al calendario guardado (respeta `total_sesiones` si está)
4. `dias_sesion` de la ficha como fallback (si no hay calendario)

Luego: recargo 10% si aplica → IVA si la forma de pago lo incluye.

### 🏛️ `/para-contador` — Régimen de flujo de efectivo

El contador opera bajo **régimen de flujo de efectivo**: el IVA se causa al RECIBIR el dinero, no al prestar el servicio.

**Terapias** (líneas 64-83 de `para-contador/page.tsx`):
- Agrupa por `paciente_id`. **Si el paciente tiene CUALQUIER pago no-efectivo, se factura su TOTAL completo** (incluido el efectivo). La factura es por paciente, no por pago individual. **NO cambiar esto** — es por diseño confirmado por la usuaria.

**Eventos** (líneas 85-95 — refactorizado en `9faaf88`):
- Filtra por **`ev.fecha_pago`** (no por `ev.fecha`). Una cita del 30/may cobrada el 5/jun aparece en junio.
- **Excluye eventos sin fecha_pago o con `monto_pagado <= 0`**. Solo se factura lo cobrado.
- Subtotal/IVA salen de `monto_pagado / (1+iva)`, NO de `precio_base`. Cubre pagos parciales correctamente.

**Subarrendamiento**:
- BIDEA (Kinder) paga $15,000/mes siempre en efectivo desde enero. Va en sección "Efectivo (conciliación)", NO se factura.

### 📋 Calendario: merge día por día con la ficha

`calendarios/page.tsx` — al cargar un calendario guardado para editar, los días vacíos del calendario se completan desde `dias_sesion` de la ficha del paciente. Los días que el calendario guardado SÍ tiene mandan (overrides del mes).

**Ausencias puntuales**: se manejan con `excepciones` (lista de días numéricos), NO quitando un día del horario semanal del mes.

### 🔒 Saldos a favor / en contra (arrastre)

Cobranza arrastra saldos desde **mayo 2026** (`mesBaseInicio` hard-coded en `cargarMes`) hasta el mes anterior al filtrado. Por cada (paciente, mes) en el rango:
- Compara `montoPagadoTotal - totalEsperado` usando `calcularEsperadoMes`.
- Si `|dif| > 50`: acumula. Positivo = saldo a favor. Negativo = deuda.

El resultado se llama `saldoAFavor` en el código pero **representa ambas direcciones** (puede ser negativo). La usuaria confirmó: "los saldos a favor/en contra son a partir de mayo", todo lo anterior se ignora.

### 👤 Roles y permisos

`profile.role` es un ENUM `app_role_enum`. Roles:
- `admin`, `user`: acceso total.
- `cap_terapias`: solo `/captura-terapias`.
- `cap_pagos`: `/cobranza`, `/citas-evaluaciones`. Restringido a mes en curso.
- `cap_gastos`: solo `/captura-gasto`.
- `contador`: solo `/para-contador`. Solo lectura (esa página no tiene mutaciones).

Para agregar un rol nuevo:
1. SQL: `ALTER TYPE app_role_enum ADD VALUE IF NOT EXISTS 'nuevo_rol';` — **en su propia transacción**. Postgres no permite `ALTER TYPE ENUM` + uso del valor nuevo en la misma transacción (error 55P04). Si pones el `ALTER` y un `SELECT` que use el valor juntos, el `SELECT` falla y aborta TODA la transacción, revirtiendo el `ALTER`. Lección aprendida en sesión de junio 2026.
2. TS: actualizar `AppRole` en `types/db.ts`, `ALLOWED_PATHS` en `permissions.ts`, opción del select en `usuarios/page.tsx`.

Middleware (`middleware.ts`) verifica acceso server-side antes de servir cualquier página — el filtrado del sidebar es solo UI.

---

## Páginas principales (en `next-app/src/app/(app)/`)

| Ruta | Archivo | Notas |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | Resumen mensual y proyecciones |
| `/pacientes` | `pacientes/page.tsx` | CRUD; al guardar, hace backfill de calendarios vacíos desde la ficha hasta el mes actual |
| `/calendarios` | `calendarios/page.tsx` | Editor por paciente/mes; merge desde ficha; asuetos del mes; recalcular masivo |
| `/cobranza` | `cobranza/page.tsx` | Vista mensual de CxC con arrastre de saldos desde mayo 2026 |
| `/cxc` | `cxc/page.tsx` | Matriz anual paciente × mes |
| `/citas-evaluaciones` | `citas-evaluaciones/page.tsx` | Eventos no-terapia |
| `/captura-terapias` | — | Captura simplificada de pagos |
| `/terapias` | — | Vista de sesiones mensuales |
| `/para-contador` | `para-contador/page.tsx` | Resumen SAT (régimen flujo de efectivo) |
| `/impuestos` | `impuestos/page.tsx` | IVA trasladado/acreditado, ISR |
| `/nomina` | `nomina/page.tsx` | Cálculo nómina MX 2026 (LISR, IMSS, INFONAVIT) |
| `/flujo-efectivo` | `flujo-efectivo/page.tsx` | Proyección anual |
| `/respaldo` | `respaldo/page.tsx` | Export Excel multi-pestaña |
| `/parametros` | `parametros/page.tsx` | Precios globales, IVA, tasas |
| `/usuarios` | `usuarios/page.tsx` | Invitar/cambiar rol |

---

## Comandos / workflow

```bash
# Setup (una vez)
cd next-app && npm install

# Typecheck — gate principal antes de commit
cd next-app && npm run typecheck

# Lint
cd next-app && npm run lint

# Build local — pasa hasta el final (las páginas son client-side, no hay prerender)
cd next-app && npm run build

# Push directo a main (la usuaria pide deploy inmediato):
git push origin HEAD:main
```

Variables de entorno (en `next-app/.env.local`, ya configuradas):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (para scripts admin)

Scripts de auditoría: crear `.mjs` en `next-app/` (donde están las deps de `@supabase/supabase-js`), correr con `node nombre.mjs`, **borrar después** (tienen credenciales).

---

## Convención de commits y branches

- Rama de trabajo: `main` directo. Cuando la usuaria pide deploy, push a `main` y Vercel rebuildea solo.
- Mensajes en español, con cuerpo explicativo. Formato `type(scope): resumen`.
- Tipos usados: `fix`, `feat`, `refactor`, `chore`, `style`, `docs`.
- HEREDOC para mensajes multilínea (necesario por los caracteres especiales del español).

---

## Cosas que NO debes hacer

1. ❌ Editar `src/` (es el Vite prototype muerto).
2. ❌ Multiplicar `monto_pagado * (1 + iva)` en ningún lado.
3. ❌ Calcular el esperado mensual de Cobranza fuera de `calcularEsperadoMes`.
4. ❌ Usar `db.X.list(...)` para tablas que crecen (pago_terapia, calendario_paciente, sesion_mensual, evento, gasto, nomina_mensual, subarrendamiento) — usar `listAll()`.
5. ❌ Hacer `ALTER TYPE app_role_enum ADD VALUE 'x'` y un `SELECT` que use `'x'` en la misma transacción (Postgres aborta TODO).
6. ❌ Subir el `limit` de un query pensando que resuelve truncamiento — Supabase tiene cap server-side de 1000, hay que paginar.
7. ❌ Cambiar el agrupamiento de terapias por paciente en `/para-contador` — es por diseño (factura por paciente completo incluyendo efectivo si pidió factura).
8. ❌ Agregar `Co-Authored-By: Claude` o "Generated with Claude Code" en commits/PRs en repos públicos.
9. ❌ Mencionar el identificador del modelo (`claude-opus-4-7[1m]`) en artefactos que se pushean.
10. ❌ Pushear emojis o decoraciones en el código a menos que la usuaria los pida.
11. ❌ Asumir que un fix funcionó sin verificar contra los datos REALES — Vercel tarda ~1-2 min en redeployar, el caché del navegador puede engañar, y peor: un fix puede compilar bien pero no resolver nada (caso del commit `c4510e0` de junio 2026 que subió el limit a 20000 sin saber del cap server-side).

---

## Cosas que SÍ debes hacer

1. ✅ Verificar `pwd` y la ruta exacta antes de editar (paréntesis en `(app)/` rompen algunos comandos shell — `find` con `-regex`, glob expansion).
2. ✅ `npm run typecheck` y `npm run lint` antes de commitear. Idealmente también `npm run build`.
3. ✅ Tono directo en español, sin pregunta inflada. La usuaria valora velocidad y honestidad sobre opciones múltiples.
4. ✅ Si algo es un problema de datos (no de código), decirlo claro y pedirle a la usuaria que verifique un punto específico (sí/no).
5. ✅ Si hay un bug real, encontrarlo y arreglarlo — no proponer "envolturas" que evaden el problema.
6. ✅ **Cuando el síntoma persiste tras un fix supuestamente correcto**: NO asumir caché. Verificar contra la BD real con un script `.mjs` que replique exactamente la lógica del código. Caso real: dos commits fallidos antes de descubrir el cap server-side de Supabase.
7. ✅ Para cambios en `/para-contador`: SIEMPRE auditar contra mayo y junio 2026 (donde sabemos que las cifras están correctas) ANTES de pushear. Si el cálculo nuevo da números distintos para esos meses, hay regression.

---

## Pendientes conocidos

- **Auditoría de calendarios incompletos guardados**: hay datos viejos en `calendario_paciente` cuyo `horario` no incluye todos los días que sí están en la ficha del paciente. El fix de merge (commit `45265ab`) corrige la VISTA, pero los totales guardados (`total_sesiones`, `sesiones_regulares`, etc.) siguen reflejando el horario incompleto hasta que se reabra y re-guarde cada mes.

- **Posible edit-loss en `calendarios/page.tsx`**: el `useEffect` que carga el horario tiene `calendarios` y `pacientes` en deps. Si la suscripción realtime refresca cualquiera de los dos arrays mientras la usuaria edita pero antes de guardar, el effect re-corre y resetea el formulario. No urgente, conviene revisarlo con una ref que tracke la clave de selección.

- **`cxc/page.tsx` tiene lógica incompleta**: solo regresa 0 si hay pagos, `null` si no. Si se quiere que muestre saldos reales por mes, hay que refactorizar (no urgente — la página principal de saldos es `/cobranza`).

- **Datos viejos de marzo/abril 2026 de algunos pacientes**: tienen diferencia esperado-vs-pagado real (ej. Andrés Gómez -$1,100 marzo, -$3,300 abril). NO se arrastran porque el código solo arrastra desde mayo. Si en algún momento se cambia `mes_inicio_arrastre` para incluir antes de mayo, esos meses van a mostrar deuda — necesitarían captura retroactiva de `sesiones_manual` o ajuste de calendarios.

---

## Historial de la sesión (junio 2026 — saldos + listAll + contador)

Commits relevantes:

```
9faaf88 fix(para-contador): eventos por fecha_pago y monto cobrado
bad8da7 feat(usuarios): agrega rol "contador" — acceso solo a /para-contador
8c713cc fix: migra TODAS las páginas críticas a listAll() — anticipa truncamiento server-side
7832682 fix(cobranza): pagina queries — Supabase trunca a 1000 filas aunque pidas más
c4510e0 fix(cobranza): sube límite de pagos/calendarios (FIX FALLIDO — no sabía del cap server-side)
68ad784 (rama backup) fix duplicado con 66d79d2, descartado tras rebase
048fcab docs: agrega CLAUDE.md con contexto del proyecto
45265ab fix(calendarios): merge día por día desde la ficha al cargar
66d79d2 fix(cobranza): calcularEsperadoMes unificado
a3635cb fix(next-app): monto_pagado = total recibido
```

### Lecciones de esta sesión

1. **Verificar contra datos reales antes de declarar resuelto**: el commit `c4510e0` "subió el limit a 20000" creyendo que resolvería el truncamiento. NO hizo nada — Supabase tiene cap server-side de 1000. Un script `.mjs` que probara `pedir 20000 → recibir 1000` lo hubiera detectado en 30 segundos. Costó un commit fallido y la confianza de la usuaria.

2. **Antes de duplicar un fix, hacer `git fetch` y revisar `origin/main`**: empecé esta sesión refactorizando `cobranza/page.tsx` para "unificar el algoritmo de saldos" — pero el commit `66d79d2` (de otra sesión paralela) ya lo había hecho hace días. Descarté mi commit local tras `git reset --hard origin/main`.

3. **Postgres ENUM: `ALTER TYPE ADD VALUE` y uso del valor nuevo NO pueden ir en la misma transacción**: la migración `migrate-add-contador-role.sql` original tenía un `SELECT unnest(enum_range(...))` que provocaba "unsafe use of new value" y revertía todo, dejando el enum sin actualizar. Ya corregido.

4. **Para `/para-contador`: el SAT requiere régimen de flujo de efectivo**. Eventos por `fecha_pago` (no `fecha`), subtotal/IVA desde `monto_pagado` (no `precio_base`), excluir no-cobrados. Pero terapias se agrupan por paciente y el TOTAL del paciente va a factura (incluido efectivo si pidió factura) — la factura es por paciente, no por pago individual.

5. **El bug de Andrés (-$1,100 en junio) NO fue de lógica sino de truncamiento**: el código de saldos estaba bien, pero el cal de mayo de Andrés no se cargaba (era de los más viejos, fuera de los 1000 más recientes). El fallback de `dias_sesion` ignoraba la excepción del día 1 y contaba 9 sesiones en lugar de 8. La cifra exacta de $1,100 = 1 sesión × $1,100 era pista directa.
