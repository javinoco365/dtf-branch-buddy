# Plan de rendimiento: que el CRM vaya ágil

Fecha: 20-10-2026 · Base: `main` en `da961f1` · Fuentes: seis diagnósticos (cliente, servidor,
base de datos, bundle, Gerencia y Pedidos), deduplicados y contrastados con el código.

Este documento es el plan. **No cambia nada por sí mismo.** Cada fase es una rama y un PR
independientes; las migraciones se escriben en `supabase/migrations/` y **las aplica Javier**.

---

## Resumen para Javier

1. Hoy, **cada clic del menú y cada cambio de filtro espera una consulta a Supabase** para
   comprobar la sesión antes de empezar a pintar. Se quita en la primera fase: el menú y las
   pestañas responderán al momento (calculamos de 0,1 a 0,3 s menos por clic).
2. Las listas piden los datos **en fila india**: en Pedidos de un año son ~56 esperas
   seguidas; en Gerencia con «año», ~96. Pasarán a pedirse de 4 en 4 a la vez: un año de
   Pedidos o Gerencia debería bajar de varios segundos a 1–2 s.
3. La base de datos comprueba los permisos **fila a fila**. Dos migraciones (índices y
   permisos) aceleran las consultas entre 4 y 20 veces en el banco de pruebas (36.000
   pedidos, varios años de los vuestros), sin cambiar quién ve qué. Con el volumen real la
   ganancia en milisegundos será menor: lo que más pesa hoy es el **número de viajes**, no
   lo que tarda cada consulta. Las revisas y las aplicas tú.
4. Al volver a una pantalla o a la pestaña del navegador **se vuelve a pedir todo**. Con caché
   de 1 minuto, volver a Gerencia o a Pedidos será instantáneo; al guardar algo se refresca
   todo lo afectado, así que no verás cifras viejas.
5. La lista de Pedidos **dibuja cada pedido dos veces** (móvil y ordenador). Con un mes tarda
   ~0,4 s en dibujarse y con un año ~4,7 s; quedará en la mitad, y al abrir un pedido solo se
   redibuja esa fila.
6. La primera pantalla tras entrar descarga una librería de gráficas de ~100 KB antes de
   enseñar las cifras. Las cifras saldrán antes y la gráfica un instante después.
7. **Ninguna cifra cambia.** Cada fase lleva una comprobación de que los números son idénticos
   antes y después, y capturas de ordenador que deben salir iguales píxel a píxel (salvo el
   «Ver más días» de Pedidos, que es opcional y solo actúa en periodos muy largos). Los dos
   sitios donde hoy una cifra está **mal** (Textil › Inicio y el panel de una tienda, que
   se cortan en 1000 filas o mezclan años) no se arreglan aquí: son tareas aparte, para que
   veas el cambio de número por separado.
8. Antes de tocar nada medimos (fase 0) y después de cada fase repetimos la medida: verás en
   números cuánto ha ganado cada pantalla.
9. Hay tres cosas que solo puedes mirar tú en los paneles de Supabase y de Cloudflare (tipo de
   clave de los tokens, región y plan). Pueden dar otra mejora grande sin tocar código.
10. Orden: navegación y lecturas en paralelo primero (bajo riesgo, mucho efecto); luego
    base de datos, caché y la tabla de Pedidos; lo más delicado (Gerencia por pestaña,
    funciones SQL nuevas) al final.

---

## Índice de fases

| Fase | PR / rama propuesta | Qué | Migración | Riesgo | Ganancia |
|---|---|---|---|---|---|
| 0 | `rend/f0-medicion` | Medidor oculto, tiempos de server functions, línea base, comprobaciones de configuración | No | Nulo | Saber de dónde partimos |
| 1 | `rend/f1-navegacion` | Sesión sin red en `beforeLoad`, comprobación de admin única, precarga al pasar el ratón | No | Bajo | −1 viaje por clic y filtro |
| 2 | `rend/f2-paralelo` | Trozos y páginas en paralelo (servidor y Gerencia), comprobaciones de `listCompras` a la vez | No | Bajo | Gerencia año: ~96 → ~25 esperas seguidas; Pedidos año: ~56 → ~20 (el Worker abre como mucho 6 conexiones a la vez) |
| 3 | `rend/f3-bd` | Índices que faltan y políticas de lectura sin función por fila | **Sí (2)** | Medio (permisos) | Consultas 4–20× más rápidas en el banco (36k pedidos); en ms reales, depende del volumen de la fase 0 |
| 4 | `rend/f4-cache` | Invalidación central tras guardar, luego `staleTime`/`gcTime`/`retry`, periodo anterior a la vista | No | Medio (datos viejos) | ~0 peticiones al volver |
| 5 | `rend/f5-pedidos-tabla` | Una sola vista según ancho, `memo` de filas, búsqueda aislada, pintado por días | No | Medio (vista) | Render ÷2; abrir fila sin redibujar todo |
| 6 | `rend/f6-bundle` | recharts diferido, pestañas de Gerencia diferidas, `PedidosTable` sin `lazy` interno, logo | No | Bajo | Entrada −97 KB gzip |
| 7 | `rend/f7-lecturas-ligeras` | Textil › Inicio con recuentos, columnas explícitas en Facturas/Textil/Compras, banco por rango | No | Medio (columnas) | Respuestas de MB a KB |
| 8 | `rend/f8-gerencia-pestanas` | `montarDatosGerencia` en dominio + cada pestaña pide solo lo suyo | No | Medio (cifras) | −30–60 % peticiones por pestaña |
| 9 | `rend/f9-listpedidos-una-consulta` | `listPedidos` con relaciones incrustadas; fila única tras guardar | No | Medio | Pedidos: 1–2 viajes |
| 10 | `rend/f10-fiscal-trimestre` | Fiscal de Resultados por trimestre en caché | No | Alto (303) | Resultados deja de leer 5 años cada vez |
| 11 | `rend/f11-sql-agregados` | `gerencia_documentos_de_pedidos()` (`tienda_resumen()` sale a tarea aparte: cambia cifras) | **Sí** | Medio | Gerencia año: ~96 → 1–2 peticiones |
| 12 | `rend/f12-servidor` | Imports diferidos en el Worker, `placement`, retirar sondas de migración | No | Bajo | Arranque en frío y −5 viajes en Compras |

Las fases 1, 2 y 3 son independientes entre sí y se pueden revisar en paralelo. La 4 exige
que la parte de invalidación vaya antes que la de `staleTime` (dentro del mismo PR, en dos
commits); **no depende de la 3**, así que no hay que esperar a que Javier aplique las
migraciones para hacerla. La 9 va después de la 2, la 3 y la 4 (su punto 3 necesita la
excepción de invalidación de la 4) y conviene después de la 5 (sin `memo` de filas,
sustituir una fila no ahorra redibujado). La 6 (pestañas de Gerencia diferidas) y la 8
tocan las mismas líneas de `gerencia.tsx`: la 6 antes, y la 8 se rehace sobre ella. La 10
y la 11 al final.

---

## Datos que conviene fijar antes (resolución de contradicciones entre informes)

| Tema | Lo que decían | Lo comprobado / decisión |
|---|---|---|
| Bundle principal | «~740 KB» | `index-*.js` mide **557 KB, 160 KB gzip**. Base común del panel: 816 KB / 255 KB gzip |
| `QueryClient` | `router.tsx:6` / `:339` / `:345` | Es **`src/router.tsx:6`** (fichero de 17 líneas); `defaultPreloadStaleTime: 0` en `:12` |
| Índice `facturas(pedido_id)` | El informe de Pedidos dice que falta | **Existe**: índice parcial en `supabase/migrations/20261004100100_tickets.sql:120-121`. No se añade |
| `cobros(pedido_id)` | — | Existe (`20260929100000_cobros.sql:109`) |
| Reescritura RLS | `mis_tiendas()` con array vs `tienda_id IN (SELECT …)` | Se adopta **`mis_tiendas()` / `mis_empresas()`**: es la medida en el banco y pasa `probar-migraciones.sh` en verde con pruebas de aislamiento |
| `PedidosTableLazy` | Precargar el import vs importarlo normal | Se **importa de forma normal** en las dos rutas y se borra `PedidosTableLazy` (la ruta ya va en trozo aparte). Hay que pasar `importaciones-mixtas.test.ts` |
| `listPedidos` | Paralelizar vs consulta incrustada | Las dos, por orden: paralelo (F2, sin riesgo) y luego incrustada (F9, con comparación de JSON) |
| `refetchOnWindowFocus` | `false` vs `true` | Se deja **`true`** con `staleTime` de 60 s: solo recarga lo que tenga más de un minuto y no hace falta botón «Actualizar» para no ver cifras viejas |
| Paginación | Por clave vs páginas en paralelo | Por clave **solo** donde la consulta ya ordena por `id` (historial de clientes, líneas). Donde se ordena por fecha (Pedidos) se mantiene el desplazamiento, y en paralelo tras pedir `count` |
| Dónde se despliega | Cloudflare (preset) vs Vercel (comentarios en `src/server.ts:46`) | **Verificar en la fase 0** |
| JWT HS256 o asimétrico | Incierto | **Verificar en la fase 0** |
| Plan de Workers (límite de 50 subpeticiones en el gratuito) | Pedidos de un año harían 146 | **Verificar en la fase 0**; si es el gratuito, la F2 y la F9 pasan a ser corrección, no solo velocidad |

---

## Fase 0 — Medición (PR `rend/f0-medicion`)

Objetivo: tener números de producción antes y después de cada fase, sin herramientas raras.

### 0.1 Medidor oculto en el navegador
- Fichero nuevo `src/lib/medidor.ts` (sin dependencias de dominio) y componente
  `src/components/MedidorRendimiento.tsx`, montado en `AppShell` **solo si** la dirección
  lleva `?medir=1` (se recuerda en `sessionStorage`, con `try/catch`).
- Qué registra:
  - **Navegación:** `router.subscribe("onBeforeNavigate")` y `("onResolved")` → ms desde el
    clic hasta que la ruta está resuelta; y el primer `requestAnimationFrame` tras
    `isFetching === 0` de React Query → «pantalla lista».
  - **Consultas:** `queryClient.getQueryCache().subscribe` → por cada `queryKey[0]`: nº de
    peticiones, ms y filas devueltas.
  - **Red:** `performance.getEntriesByType("resource")` filtrado por `supabase.co` y
    `_serverFn` → nº de peticiones y KB transferidos (`transferSize`) por pantalla.
  - **Peticiones a `/auth/v1/user`** por clic (criterio de la F1).
- Interfaz: un recuadro fijo abajo a la derecha con la tabla de la última pantalla y un botón
  «Copiar» (JSON al portapapeles). No guarda nada en servidor ni en la base.
- Riesgo: nulo; sin `?medir=1` no se monta. No toca la vista de ordenador.

### 0.2 Tiempos de las server functions
- Un `createMiddleware({ type: "function" })` de medición en `src/start.ts`, después de
  `attachSupabaseAuth`, que mida el `next()` y escriba `console.log(JSON.stringify({ fn,
  ms, ok }))`. Se lee con `wrangler tail` o en los registros del Worker en Cloudflare.
- Opcional: cabecera `Server-Timing` si la respuesta lo permite (se ve en DevTools › Red).
- **Nota:** no es el middleware de `app.usuario_id` que pide el CLAUDE.md; es otro y no lo
  sustituye.

### 0.3 Comprobaciones de configuración (las hace Javier, solo mirar)
1. **Algoritmo del token:** con la sesión abierta, en la consola del navegador:
   `JSON.parse(atob(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token.split('.')[0])).alg`.
   Si es `HS256`, cada server function hace un viaje más a Supabase Auth (`getClaims` →
   `getUser`, `src/integrations/supabase/auth-middleware.ts:55-57`).
2. **Región de Supabase:** Settings › General.
3. **Dónde corre el servidor y con qué plan:** cabecera `cf-ray` (Cloudflare) o `x-vercel-id`
   (Vercel) en cualquier respuesta; plan de Workers (gratuito: 50 subpeticiones y 10 ms CPU).
   Apuntarlo en el `CLAUDE.md` (PR aparte).
4. **pg_stat_statements / Query Performance** (Supabase › Reports › Query Performance, viene
   activado). Consulta de solo lectura para la línea base:
   ```sql
   SELECT left(query, 120) AS consulta, calls,
          round(mean_exec_time::numeric, 1) AS ms_media,
          round(total_exec_time::numeric) AS ms_total
     FROM extensions.pg_stat_statements
    ORDER BY total_exec_time DESC
    LIMIT 25;
   ```
   Guardar el resultado antes de la F3. **No ejecutar `pg_stat_statements_reset()`** sin que
   Javier lo decida: borra la historia de estadísticas.
5. **Volumen real:** `SELECT count(*) FROM pedidos WHERE fecha_pedido >= now() - interval '30 days'`
   (y lo mismo para un año, facturas, cobros y `auditoria`). Los informes suponen 300–1000
   pedidos/mes; con el dato real se ajustan las ganancias esperadas.

### 0.4 Protocolo de medida (antes y después de cada fase)
Navegador de escritorio, DevTools › Red con «Disable cache» **desactivado**, `?medir=1`.
Recorrido fijo: Panel → Pedidos (mes) → abrir un pedido → Pedidos (año) → Gerencia (Resumen,
mes) → Gerencia (año, números A) → Gerencia › Tesorería → Facturas de una tienda → Textil ›
Pedidos → Compras → volver a la pestaña del navegador tras 2 min. Tres pasadas; se apunta la
mediana.

### 0.5 Criterios de éxito (al final del plan)

| Pantalla | Medida | Hoy (estimado) | Objetivo |
|---|---|---|---|
| Cualquier clic de menú / filtro | `GET /auth/v1/user` | 1 por clic | **0** |
| Panel (primera carga tras entrar) | JS gzip descargado | 383 KB | ≤ 290 KB |
| Panel (navegando) | clic → pantalla lista | medir | ≤ 1,0 s |
| Pedidos, mes | `listPedidos` en servidor | 6–18 viajes en serie | ≤ 2 viajes; ≤ 600 ms |
| Pedidos, mes | render de la lista | ~390 ms | ≤ 200 ms |
| Pedidos, año | clic → primeras filas | varios s | ≤ 2,5 s |
| Pedidos | abrir una fila | redibuja 2×N filas | redibuja 1 fila |
| Gerencia Resumen, mes | peticiones | ~32 | ≤ 18 |
| Gerencia, año + A/B | esperas seguidas | ~96 | ≤ 25 (F2), 1–2 (F11) |
| Gerencia | volver a la pestaña en < 60 s | ~30 peticiones | **0** |
| Facturas de tienda | KB de la respuesta | medir | −70 % |
| Textil › Inicio | KB descargados | toda la historia con líneas | ÷10 o mejor (sigue leyendo `fecha, total` de facturas y el stock para no cambiar cifras) |
| Compras | `listCompras` | 6 viajes en serie | 2 |
| Base de datos | `mean_exec_time` de pedidos/pedido_items/cobros | medir | ÷4 o mejor |
| Todas | cifras (totales, cobrado, pendiente, A/B, 303) | — | **idénticas** |

---

## Fase 1 — Navegación sin esperas (PR `rend/f1-navegacion`)

**Cambios**
1. `src/routes/panel/route.tsx:7-11`: `beforeLoad` con `supabase.auth.getSession()` (lee la
   sesión guardada y renueva el token si ha caducado). Sin sesión → `redirect({ to: "/auth" })`.
   Se devuelve `{ user: data.session.user }`; comprobar con `grep -rn "context.user\|useRouteContext"`
   que nadie necesita algo que solo da `getUser()`.
2. `src/lib/auth-context.tsx:27-57`: `comprobarAdminActual` una sola vez por `user.id`
   (hoy dos al entrar, por `INITIAL_SESSION` y por `getSession().then`, y otra en cada
   `TOKEN_REFRESHED`). Guardar el último `user.id` comprobado en un `useRef` y no repetir si
   no cambia. `useMemo` del `value` del contexto.
3. `src/router.tsx`: `defaultPreload: "intent"`, `defaultPreloadDelay: 50`. Mantener
   `defaultPreloadStaleTime: 0` (con React Query es lo correcto y no hay `loader`).

**Riesgos y cómo se evitan**
- Un usuario revocado con token aún válido (≤ 1 h) vería el marco. Sus datos no: cada server
  function valida el token (`requireSupabaseAuth`) y PostgREST aplica RLS. Aceptable.
- La precarga sin el punto 1 dispararía `getUser` en cada hover: por eso van en este orden,
  en commits separados.

**Verificación**
- `npm run verify`.
- Red: 0 `auth/v1/user` al navegar; al pasar el ratón por «Gerencia» baja `gerencia-*.js`
  antes del clic.
- Cerrar sesión en otra pestaña y navegar: redirige a `/auth`.
- Pruebas visuales (`pruebas-visuales/capturar.mjs` + `comparar.mjs`) a 1440 y 390 px: sin
  diferencias.

**Ganancia esperada:** 100–300 ms menos por cada clic de menú, pestaña o filtro; 1 server
function menos al entrar.

---

## Fase 2 — Lecturas en paralelo (PR `rend/f2-paralelo`)

Solo código de lectura. **Mismas filas, mismo orden, mismas cifras.**

**Cambios**
1. `src/lib/paginar.ts`: nuevo ayudante
   `enParalelo<T, R>(lista: readonly T[], limite: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]>`
   que devuelve los resultados **en el orden de entrada**. Límite por defecto 4. Con pruebas
   unitarias (orden, límite, primer error). Es infraestructura de E/S, no de negocio: va en
   `src/lib/`, no en `src/dominio/`.
2. `src/lib/leer-por-ids.ts:29-33` (`leerPorIds`): trozos con `enParalelo`, concatenando en
   orden de trozo; si alguno falla, se devuelve el primer error en orden (mismo contrato).
3. `src/lib/pedidos.functions.ts`:
   - `:111-124` `lineasDePedidos`: igual que `leerPorIds`.
   - `:207-239`: pedir `gerencia_ajustes` y `realizados` **a la vez** que la primera página de
     pedidos (no dependen de ellos).
   - `:138-170` `documentosDePedidos`: la segunda fase (rectificativas) depende de la primera;
     se queda en dos pasos, cada uno en paralelo.
4. `src/lib/gerencia.ts`: los `for … await` de `:86-98` (coste textil), `:285-289`
   (presupuestos), `:310`/`:317` (presupuestos tienda y textil a la vez), `:435-452` (envíos),
   `:720-764` (`documentosDe`: trozos en paralelo **y** tienda y textil a la vez),
   `:789-795` (líneas textil), `:976-1082` (controles del almacén: sonda y compras junto a
   `proformasAplicado`, entradas en paralelo).
5. `src/lib/resumen-diario.ts:146-188` (trozos) y `:239` (cobros del tramo a la vez que los
   pedidos).
6. `src/lib/compras.functions.ts:473-484`: las cinco comprobaciones de migración en un
   `Promise.all`.
7. Consultas independientes en serie: `src/lib/banco.functions.ts:176-191` (`listCuentas`) y
   `:253-290` (`proponerConciliacion`), `src/lib/plantillas-presupuesto.functions.ts:205-221`,
   `src/lib/conciliacion.functions.ts` (`contar` junto a la lectura),
   `src/lib/woocommerce.functions.ts:908-945` (miembro, rol, tienda, credenciales y empresa a
   la vez; turno y precio después si dependen).
8. `src/lib/gerencia.ts:70` (`useTextilPeriodo`, llamado para el periodo anterior desde
   `useVentasGerencia(previo)` en `src/routes/panel/gerencia.tsx:83`): sin comparación,
   `previo` es un rango al revés y hoy lanza una consulta que siempre vuelve vacía. Se
   corta **dentro del `queryFn`** con `diasDelRango(rango)` → `[]`, igual que ya hacen
   `usePedidosPeriodo` (`periodo.ts:50-51`) y `useCobrosPeriodo` (`periodo.ts:137-138`).
   **No** con `enabled: false`: dejaría `textil.data` en `undefined` e `isPending` en
   `true` para siempre en `useVentasGerencia`, y lo que espere a `ventasPrevias` no
   acabaría de cargar.
9. `ResumenDiario.tsx:146-174`: `calcular` dentro de `useMemo`.

**No se toca** `leerTodas` todavía (la lectura de páginas en paralelo con `count` va con la
F3 aplicada, ver F9), ni el tamaño de trozo (150) ni `FILAS_POR_PAGINA`.

**Riesgos y cómo se evitan**
- Más peticiones simultáneas contra PostgREST: límite 4 por rama. Ojo: en `listPedidos`
  (servidor) las 6 ramas × 4 = 24 **no** van a la vez: un Worker de Cloudflare tiene como
  mucho **6 conexiones salientes abiertas** por petición y el resto espera en cola (no
  falla, solo espera). Por eso la ganancia de Pedidos es menor que la de Gerencia, que va
  desde el navegador por HTTP/2. Si el plan de Workers es el gratuito, el **total** de
  subpeticiones no cambia (sigue siendo un problema; lo resuelve la F9).
- `textil coste` (`gerencia.ts:86-98`) hoy hace `break` al primer `faltaLaTabla`: en
  paralelo hay que conservar «si **algún** trozo dice que falta la tabla, sin coste para
  todos» (`conAlmacen = false`), no mezclar trozos con y sin coste.
- Orden de resultados: `enParalelo` conserva el orden; cada pedido cae en un solo trozo, así
  que el orden de sus líneas y cobros es el de hoy.
- Error a medias: se mantiene «parar y devolver el primer error».

**Verificación**
- `npm run verify` (incluye las pruebas de `enParalelo`).
- **Igualdad de datos:** con `?medir=1`, botón «Copiar respuesta» de `listPedidos` y de los
  documentos de Gerencia; comparar el JSON antes/después para mes y año, con tickets
  anulados, rectificativas y pedidos con varios cobros (`diff` de los dos ficheros). Cifras
  de Gerencia (Resumen, A/B, insignia «pendiente de documentar») idénticas.
- Red: la escalera de `facturas?pedido_id=in…` pasa a bloques de 4.

**Ganancia esperada:** Pedidos año ~56 → ~20 esperas seguidas (tope de 6 conexiones del
Worker); Gerencia año ~96 → ~25; mes 9 → 3. `listCompras` 6 → 2 viajes (si
`escanerAplicado` y `proformasAplicado` hacen más de una consulta cada una, contarlas en la
fase 0).

---

## Fase 3 — Base de datos: índices y permisos de lectura (PR `rend/f3-bd`)

Dos migraciones nuevas. **Claude las escribe y las prueba en el banco; Javier las revisa y
las aplica.** Ya están redactadas y probadas en el banco local (copia en el scratchpad del
diagnóstico, `…/scratchpad/rend/mig/`); se copian tal cual a `supabase/migrations/` tras
revisarlas.

### `supabase/migrations/20261031100000_rendimiento_indices.sql`
Solo añade índices (`CREATE INDEX IF NOT EXISTS`). Reversible con `DROP INDEX`.
```sql
CREATE INDEX IF NOT EXISTS textil_pedido_items_por_pedido       ON public.textil_pedido_items (pedido_id);
CREATE INDEX IF NOT EXISTS textil_factura_items_por_factura     ON public.textil_factura_items (factura_id);
CREATE INDEX IF NOT EXISTS textil_presupuesto_items_por_presupuesto ON public.textil_presupuesto_items (presupuesto_id);
CREATE INDEX IF NOT EXISTS pedidos_por_cliente         ON public.pedidos (cliente_id)         WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_pedidos_por_cliente  ON public.textil_pedidos (cliente_id)  WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS facturas_por_cliente        ON public.facturas (cliente_id)        WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_facturas_por_cliente ON public.textil_facturas (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_pedidos_por_fecha    ON public.textil_pedidos (fecha DESC, id);
CREATE INDEX IF NOT EXISTS textil_facturas_por_fecha   ON public.textil_facturas (fecha DESC, id);
CREATE INDEX IF NOT EXISTS pedidos_abiertos ON public.pedidos (id)
  WHERE estado IN ('pendiente', 'en_produccion', 'imprimiendo', 'listo');  -- = ESTADOS_ABIERTOS (src/dominio/produccion.ts:31)
CREATE INDEX IF NOT EXISTS enlaces_seguimiento_por_fecha ON public.enlaces_seguimiento (created_at);
CREATE INDEX IF NOT EXISTS textil_stock_mov_por_pedido ON public.textil_stock_movimientos (textil_pedido_id)
  WHERE textil_pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tienda_usuarios_por_usuario ON public.tienda_usuarios (user_id, tienda_id);
-- Comprobado que falta (ninguna migración lo crea; facturas sí lo tiene: facturas_rectifica_idx,
-- 20260902130000_motor_facturacion.sql:150). Lo usan documentosDe (gerencia.ts:742) y
-- factura_borrar_ultima / sustituir (20261004100100_tickets.sql:541 y :564).
CREATE INDEX IF NOT EXISTS textil_facturas_rectifica_idx ON public.textil_facturas (rectifica_a_id)
  WHERE rectifica_a_id IS NOT NULL;
```
La copia del banco (`…/scratchpad/rend/mig/20261031100000_rendimiento_indices.sql`) **no**
lleva todavía el último índice: añadirlo antes de copiarla y repetir `probar-migraciones.sh`.
**No** añadir `facturas(pedido_id)`, `facturas(rectifica_a_id)`, `textil_facturas(textil_pedido_id)`,
`cobros(pedido_id)` ni `pedidos(tienda_id, fecha_pedido)`: ya existen
(`20261004100100_tickets.sql:120-123`, `20260902130000_motor_facturacion.sql:150`,
`20260929100000_cobros.sql:109`, `20260902120300_estados_pedido.sql:234`).
`tienda_usuarios` tiene la clave primaria `(tienda_id, user_id)`
(`20260615144900_….sql:105`): el índice que empieza por `user_id` sí hace falta.

Tablas pequeñas hoy: `CREATE INDEX` normal dentro de la transacción de la migración basta
(segundos de bloqueo de escritura). Si `pedidos` o `facturas` tuvieran cientos de miles de
filas (dato de la fase 0), Javier puede crearlos con `CONCURRENTLY` fuera de transacción.

### `supabase/migrations/20261031100100_rendimiento_rls.sql`
- Dos funciones `STABLE SECURITY DEFINER` con `search_path = public`, ejecutables solo por
  `authenticated`: `mis_tiendas() RETURNS uuid[]` (admin → todas; si no, las de
  `tienda_usuarios`) y `mis_empresas() RETURNS uuid[]`.
- Se recrean **solo las políticas `FOR SELECT`** de: `pedidos`, `pedido_items`, `facturas`,
  `factura_items`, `pedido_devoluciones`, `enlaces_seguimiento`, `cobros`, `clientes`,
  `textil_pedidos`, `textil_pedido_items`, `textil_facturas`, `textil_factura_items`,
  `textil_compras`, con la forma:
  ```sql
  USING (tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]))
  ```
  (las hijas con `EXISTS` sobre el padre y la misma comparación). El `::uuid[]` es
  obligatorio: sin él falla con `operator does not exist: uuid = uuid[]`.
- ~~`auditoria`~~: **se quita de esta migración.** La aplicación no lee `auditoria`
  (`grep` en `src/`: ninguna consulta), y el panel de Supabase la lee con un rol que se
  salta la RLS: la ganancia «1,6 s → 92 ms» no la verá nadie. Tocar una política de la
  tabla de auditoría sin beneficio es riesgo gratis. Hay que borrar ese bloque de la copia
  del banco antes de llevarla al repositorio.
- Alta, edición y baja no se tocan. Sigue sin haber `FOR ALL`.
- Al final del fichero, comentadas, las políticas anteriores para poder deshacer.
- **Comprobación de nombres:** la migración hace `DROP POLICY IF EXISTS "<nombre>"` y luego
  `CREATE POLICY`. Si en producción alguna política de lectura tiene otro nombre (creada a
  mano en Lovable), el `DROP` no hace nada y la nueva se **suma** a la vieja (permisivas, se
  combinan con OR): mismo acceso, pero **sin ganancia**, porque la vieja sigue llamando a la
  función por fila. Antes de aplicarla, Javier ejecuta (solo lectura):
  ```sql
  SELECT tablename, policyname, cmd, qual
    FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
     AND tablename IN ('pedidos','pedido_items','facturas','factura_items','pedido_devoluciones',
                       'enlaces_seguimiento','cobros','clientes','textil_pedidos',
                       'textil_pedido_items','textil_facturas','textil_factura_items','textil_compras')
   ORDER BY 1, 2;
  ```
  y debe salir **una** política `SELECT` por tabla con los nombres que usa la migración (en
  el banco: `pedidos lectura`, `facturas lectura miembros`, `cobros lectura`,
  `compras lectura`, `textil_pedidos_lectura`…). Además, la migración termina con un bloque
  `DO $$ … $$` que hace `RAISE EXCEPTION` si alguna de esas tablas queda con más de una
  política `SELECT`, para que no se aplique a medias sin avisar.
- Equivalencia comprobada en el banco: `is_tienda_member` y `es_miembro_empresa` devuelven
  `true` para el administrador **con cualquier valor**, incluido `NULL`; `= ANY(array)` con
  `NULL` da `NULL` (fila oculta). Es idéntico solo porque `tienda_id` y `empresa_id` son
  `NOT NULL` en las 8 tablas raíz tocadas (comprobado en `information_schema`). Dejarlo
  escrito en el comentario de la migración.

**Riesgos y cómo se evitan**
- Es un cambio de permisos: mismo acceso por construcción, pero se demuestra con
  `supabase/pruebas/C11_politicas_por_operacion.sql` y **casos nuevos de usuario no
  administrador** (ve su tienda, no ve la otra, en cada tabla tocada) en
  `supabase/pruebas/`.
- `mis_tiendas()` es `SECURITY DEFINER`: solo devuelve las tiendas del que llama; `REVOKE ALL
  … FROM PUBLIC, anon`.
- Índice parcial `pedidos_abiertos`: si cambia `ESTADOS_ABIERTOS` o la app pasa a
  `estado_produccion`, deja de usarse (más lento, nunca resultados distintos). Comentario en
  `src/dominio/produccion.ts:31` apuntando al índice.

**Verificación**
- `supabase/pruebas/probar-migraciones.sh` en verde (en el diagnóstico ya salió TODO EN
  VERDE con estas dos migraciones).
- En Supabase, tras aplicar: `EXPLAIN` de una consulta de pedidos como `authenticated` muestra
  `InitPlan` y no `Filter: is_tienda_member(...)` por fila.
- Comparar la consulta de pg_stat_statements de la fase 0.
- Totales de Pedidos y Gerencia idénticos.

**Ganancia medida en el banco** (36k pedidos): pedidos de un año 78 → 9 ms; líneas página 36
619 → 139 ms; `pedidos_pendientes_cobro` 515 → 70 ms por página; pedidos textil con líneas
1.902 → 80 ms; taller 177 → 0,5 ms; envíos 446 → 13 ms. (La auditoría ya no entra.)
El banco tiene ~3–10 años de vuestro volumen supuesto (300–1000 pedidos/mes): en
producción la ganancia por consulta será proporcionalmente menor en milisegundos; el
número de la fase 0 (punto 5) dice cuánto. Lo que sí se mantiene a cualquier volumen es
`textil_*_items` sin índice (lectura secuencial por cada pedido de la lista).

---

## Fase 4 — Caché de datos sin cifras viejas (PR `rend/f4-cache`)

Dos commits, **en este orden**.

### Commit 1: invalidación central
- `src/router.tsx`: `new QueryClient({ mutationCache: new MutationCache({ onSettled: (_d, _e, _v, _c, m) => { if (m.meta?.invalida !== false) queryClient.invalidateQueries(undefined, { cancelRefetch: false }); } }) })`.
  Recarga al momento solo lo que está en pantalla; lo demás queda marcado como viejo y se
  recarga al montarse. Nunca refresca menos que hoy.
  - **`onSettled`, no `onSuccess`:** hay guardados que escriben a medias y luego fallan
    (Facturar varios emite uno a uno; la sincronización Woo va por tandas). Con
    `onSuccess` lo que sí se escribió no se refrescaría.
  - **`cancelRefetch: false`:** las mutaciones que ya invalidan a mano en su propio
    `onSuccess` (p. ej. `PedidosTable.tsx:238`, `:298` y `:308`) lanzarían una segunda recarga
    que cancela la primera; en el navegador se aborta, pero la server function
    (`listPedidos` de un año) **sigue ejecutándose entera en el Worker**. Con `false` la
    segunda se une a la que ya está en marcha.
  - Tipar `meta` con `declare module "@tanstack/react-query" { interface Register { mutationMeta: { invalida?: false } } }`
    para que `npm run verify` lo compruebe.
  - **Coste a medir:** en Gerencia hay ~30 consultas activas; cualquier guardado allí (un
    ajuste, un gasto) recarga las 30, incluido el fiscal de 5 años. Hoy solo se recarga la
    suya. Es el precio de no dejar cifras viejas; se mide en la fase 0 («peticiones tras
    guardar un ajuste») y se alivia con la F8 y la F10, no quitando la invalidación.
- `meta: { invalida: false }` en las mutaciones que no escriben: `exportarAnalisis`
  (`PedidosTable.tsx:248`), lectura con IA (`PaginaCompras.tsx:364`), `generar` del resumen
  diario (`ResumenDiario.tsx:314`), `CrearPresupuestoIa`, vista previa de PDF.
- Los guardados que no usan `useMutation` llaman a un ayudante común
  `invalidarTrasGuardar(queryClient)` en `src/lib/cache.ts`: `TicketsPendientesDialog.tsx:93-111`,
  `FacturarPedidosDialog.tsx:145-148`, `conciliacion.tsx:65` y `:122`, `PaginaCompras.tsx:650`,
  `useImagenesPresupuesto.ts:183`. Buscar el resto con
  `grep -rn "await .*Fn(\|serverFn" src --include=*.tsx` fuera de `mutationFn`.
- Las invalidaciones a mano existentes se pueden dejar (son redundantes e inocuas) o quitar
  en un PR posterior; **no** se tocan en este para que el diff sea revisable.

### Commit 2: valores por defecto
```ts
defaultOptions: { queries: {
  staleTime: 60_000,
  gcTime: 30 * 60_000,
  refetchOnWindowFocus: true,   // con staleTime: solo lo de más de 60 s
  retry: (n, e) => n < 1 && !/Unauthorized|JWT|PGRST|permission denied/i.test(String(e)),
} }
```
(El `4\d\d` de la versión anterior no servía: las server functions lanzan `new Error(error.message)`
sin el código HTTP, y en cambio casaba con cualquier número de pedido o importe que empiece
por 4 dentro del mensaje.)
- Referencia (`tiendas*`, `empresa*`, `textil-marcas`, `gerencia-ajustes`, `caja-catalogos`):
  `staleTime: 10 * 60_000`.
- Historia pesada (`gerencia-historial-clientes`, `gerencia-fiscal`, `almacen-movimientos`):
  `staleTime: 5 * 60_000`.
- `placeholderData: keepPreviousData` en las consultas de periodo (`src/lib/periodo.ts:45`,
  `:132`, `PedidosTable.tsx:271`, ganchos de periodo de Gerencia) **con** aviso visible
  «Actualizando…» y atenuación cuando `isPlaceholderData`, y **exportar CSV/PDF desactivado**
  mientras `isPlaceholderData`. En Pedidos, además, **acciones de fila desactivadas**
  (cobrar, facturar, cambiar estado, borrar) mientras `isPlaceholderData`: al cambiar de
  tienda en el filtro se verían los pedidos de la otra tienda durante la carga y se podría
  cobrar o borrar uno que ya no pertenece a la vista.

**Riesgos y cómo se evitan**
- Datos viejos tras guardar: lo cubre el commit 1 (todas las mutaciones invalidan todo).
- Cambios de otro usuario o del webhook de Woo: se ven con hasta 60 s de retraso o al volver
  a la pestaña. Aceptable con tres usuarios; se dice en la nota del PR.
- Cifras del periodo anterior a la vista: el aviso es obligatorio y bloquea exportar.
- `retry` 1 en vez de 3: un fallo de red puntual se ve antes; el botón «Reintentar» de los
  estados de error sigue funcionando.

**Verificación** (con la app real y `?medir=1`; cada pantalla debe mostrar el cambio **sin
F5**):
1. Crear un pedido → Panel, Gerencia y Tienda › Inicio.
2. Cobrar → Facturación global y Gerencia › Tesorería.
3. Emitir un ticket → botón verde de Pedidos e insignia de Gerencia.
4. Conciliar → Gerencia › Tesorería.
5. Pagar una compra → Gerencia › pagos a proveedores.
6. Cambiar el coste por metro → margen del Panel.
7. Sincronizar Woo → Panel.
Además: volver a la pestaña del navegador en Gerencia antes de 60 s → 0 peticiones; ir a
Pedidos y volver → 0 peticiones. `npm run verify`.

**Ganancia esperada:** ~30 peticiones menos cada vez que se vuelve a Gerencia; cambiar de
pantalla y volver es instantáneo; cambiar de periodo no deja la pantalla en blanco.

---

## Fase 5 — Tabla de Pedidos (PR `rend/f5-pedidos-tabla`)

**Cambios** (`src/components/PedidosTable.tsx`)
1. Montar **una sola vista**: tarjetas (`:637`, `md:hidden`) o tabla (`:658`,
   `max-md:hidden`) según el ancho, corte 768 px = `md`. **No** reutilizar `useIsMobile`
   tal cual (`src/hooks/use-mobile.tsx`): arranca en `undefined` → `false` y pinta primero
   la vista de ordenador en el móvil, y lo usa también `ui/sidebar.tsx:69`. Gancho nuevo
   `useEsMovil()` con estado inicial síncrono `window.matchMedia("(max-width: 767px)").matches`
   (el panel es `ssr:false`) y escucha de `change`. Igual para el pie del periodo
   (`Table movil="tarjetas"`, `:758`).
2. `React.memo` en `FilaPedido` (`:1049`) y `TarjetaPedido` (`:1190`); se les pasa el `pedido`
   y callbacks estables `useCallback((id) => …)` en vez de funciones nuevas por fila.
3. Cuadro de búsqueda en un componente propio con su estado (hoy `useTextoDiferido` en
   `:204` vive en el padre y cada tecla redibuja todo). Ojo: la búsqueda **ya va a la
   dirección** (`cambiar({ q })`), así que cada búsqueda diferida es una navegación que hoy
   dispara el `getUser` de `/panel` (lo quita la F1) y recalcula `filtrados`; el componente
   propio solo evita el redibujado por tecla, no esa navegación.
4. `resumenCobros` calculado una vez por pedido al recibir los datos (`useMemo` → `Map`),
   en lugar de hasta cinco veces.
5. `content-visibility: auto; contain-intrinsic-size: auto 600px` en cada bloque de día.
6. **Opcional, solo si tras 1–5 el año sigue por encima del objetivo:** periodos largos
   (más de ~300 pedidos filtrados, de modo que **un mes normal no cambia nada en pantalla**)
   pintan los primeros días hasta ~150 pedidos y el resto con un botón «Ver más días (quedan
   N)» al pie. Totales y CSV siguen sobre `filtrados` completos. Esto **sí** cambia la vista
   de ordenador en trimestre/año: la prueba visual de esos periodos se actualiza a propósito
   y se enseña a Javier en el PR.

**Riesgos y cómo se evitan**
- Vista de ordenador: el corte debe ser exactamente `md`; pruebas visuales a 1440 y 390 px
  idénticas, y prueba manual redimensionando la ventana.
- Callback con datos viejos actuaría sobre otro pedido: los callbacks reciben el `id`, no
  cierran sobre la fila. Probar a mano estado, cobros, editar, borrar, seguimiento y
  realizado.
- Ctrl+F no encuentra días no pintados: se avisa en el botón («quedan N días»).
- `content-visibility: auto`: la barra de desplazamiento salta si `contain-intrinsic-size`
  difiere mucho del alto real de un día; y la restauración de scroll del router
  (`scrollRestoration: true`) puede caer en otra posición al volver. Probar volver a Pedidos
  desde un pedido abierto a mitad de un trimestre.
- Imprimir la lista: hoy las dos vistas dependen del CSS y la impresión elige por ancho de
  papel; con una sola vista elegida por JavaScript se imprime la que haya en pantalla.
  Comprobar con Javier si se imprime esta pantalla.

**Verificación:** React Profiler (abrir una fila: solo esa fila se pinta), pestaña Performance
con «trimestre», pruebas visuales, `npm run verify`.

**Ganancia medida** (render en Node, el navegador tarda más): 300 pedidos 388 → ~257 ms;
3600 pedidos 4.680 → ~2.460 ms, y con el pintado por días, < 300 ms hasta la primera
pantalla.

---

## Fase 6 — Menos código en la primera carga (PR `rend/f6-bundle`)

**Cambios**
1. Gráficas a ficheros propios cargados con `React.lazy` + `Suspense` y un `Skeleton` de la
   misma altura (`h-64`/`h-72`): `src/routes/panel/index.tsx:40` (usadas en `:271-290`,
   `:306-330`), `src/routes/panel/facturacion-global.tsx:69`,
   `src/routes/panel/tiendas/$tiendaId/facturacion.tsx:35`. Ficheros nuevos en
   `src/components/graficas/` que **solo** se importan con `import()`.
2. Pestañas de Gerencia con `React.lazy` (`src/routes/panel/gerencia.tsx:8-20`) y el diálogo
   `ResumenDiario` también. `gerencia-*.js` importa hoy recharts de forma estática (comprobado
   en la compilación). La pestaña Resumen, que es la que abre por defecto, se precarga junto
   con la ruta (en `onMouseEnter` del enlace o con un `import()` al montar Gerencia) para no
   añadir otro viaje en cadena a la primera visita.
3. `PedidosTable` importado de forma normal en las dos rutas que lo usan; borrar
   `src/components/PedidosTableLazy.tsx` conservando su `ErrorBoundary`.
4. Logo: `public/marca/logo-96.webp` (sin cambiar el original, 70 KB, que pueden usar los
   PDF) usado en `Marca.tsx:36`, y una regla `/marca/*` con
   `cache-control: public, max-age=86400`. **Cuidado:** el preset `cloudflare-module` ya
   **genera** `.output/public/_headers` (regla `/assets/*` inmutable). Un `public/_headers`
   propio puede pisar o ser pisado por el generado: tras compilar, comprobar que
   `.output/public/_headers` contiene **las dos** reglas; si no, poner la regla en la
   configuración de nitro (`routeRules`) en vez de en un fichero.
5. `import("@/lib/pdf-informe-socios")` al abrir el diálogo del resumen, no al pulsar.

**Riesgos y cómo se evitan**
- `__exportAll is not a function`: un mismo módulo importado normal y con `import()`. Lo
  frena `src/arquitectura/importaciones-mixtas.test.ts`; además, arrancar el servidor node
  (`NITRO_PRESET=node-server npx vite build && PORT=3111 node .output/server/index.mjs`) y
  abrir Panel, Pedidos, Gerencia (todas las pestañas) y Facturación.
- Salto de diseño si el esqueleto no mide lo mismo: pruebas visuales (las capturas esperan a
  que la gráfica cargue).

**Verificación:** compilar con `--sourcemap`, `grep '^import' panel-*.js` sin `BarChart`;
medir gzip por ruta; `npm run verify`; pruebas visuales.

**Ganancia esperada:** primera pintura del Panel 383 → ~286 KB gzip (−25 %); Gerencia Resumen
474 → ~330 KB gzip; Pedidos pide datos un viaje antes.

---

## Fase 7 — Leer menos (PR `rend/f7-lecturas-ligeras`)

Regla para cada consulta: antes de cambiar `select("*")` por columnas, `grep` de cada campo
que usa la pantalla **y** los diálogos que abre; y confirmar en la fase 0 que las columnas
existen en producción (una columna inexistente rompe la consulta entera).

**Cambios**
1. `src/routes/panel/textil/index.tsx:26-37`: hoy descarga **toda** la historia de pedidos,
   facturas y presupuestos textil **con sus líneas** solo para contar y sumar. Cambio con
   las **mismas cifras que hoy**:
   - Pedidos y presupuestos: `select("id", { count: "exact", head: true })`. Ambas listas ya
     se leen enteras con `leerTodas`, así que el recuento es el mismo número.
   - Clientes: **no** pasar a `count`: `listTextilClientes` (`textil.functions.ts:370`) no
     pagina y hoy enseña como mucho 1000; un recuento exacto daría otro número. Se deja la
     lectura como está (o con `select("id")`) y el corte va a la tarea aparte del punto 1 de
     «Encontrado por el camino».
   - Stock y «bajo mínimo»: PostgREST no puede filtrar `cantidad <= cantidad_minima` (dos
     columnas), así que no sirve `count`. Leer solo `id, cantidad, cantidad_minima` con
     `leerTodas`.
   - «Facturado este mes»: hoy compara solo `getMonth()` **sin el año** (suma el mismo mes de
     todos los años). Filtrar por fecha cambiaría la cifra: se lee solo `fecha, total` de
     todas las facturas (sin líneas ni snapshots) y se mantiene el mismo cálculo. Corregir el
     año es la tarea aparte del punto 2.
   - Estas claves dejan de compartir caché con `["textil-pedidos"]`/`["textil-facturas"]`
     de las listas: claves nuevas (`["textil-inicio", …]`).
2. `src/routes/panel/tiendas/$tiendaId/facturas.tsx:113-127`: columnas explícitas sin
   `emisor_snapshot`, `lineas_snapshot`, `desglose_iva`; `receptor_email:receptor_snapshot->>email`
   para `:559`. Los snapshots se leen al abrir una factura.
3. Gerencia › banco: consulta nueva con clave propia
   (`["gerencia-banco", desde, hasta]`) de `fecha, importe, conciliacion:banco_conciliaciones(id)`
   con `gte/lte` de fecha; sustituye a `listMovimientosBanco` en `src/lib/gerencia.ts:154-176`.
   Conciliación conserva la suya.
4. `src/lib/compras.functions.ts:486`: la lista sin `lectura_ia`; función nueva
   `verCompra(id)` (validación zod en la primera línea) que la devuelve al abrir la revisión
   (`PaginaCompras.tsx:247-266`).
5. `src/lib/textil.functions.ts:925` (`listTextilFacturas`) y `:965` (`listTextilPedidos`):
   sin `*_snapshot` ni `desglose_iva` en la lista.
6. `src/routes/panel/textil/pedidos.tsx`: stock con `enabled: dialogoAbierto`.
7. `tiendas/$tiendaId/facturacion.tsx:69-70`: `useCobrosPeriodo` con `tiendaId` en la
   consulta en vez de filtrar en el navegador. Cambia la clave
   `["cobros-periodo", criterio, …]`, que hoy comparte caché con Gerencia: añadir `tiendaId`
   **al final** de la clave (`"todas"` por defecto) para que Gerencia siga reutilizando la
   suya.

**Riesgos:** un campo que alguien leía del `*` desaparece (mitigado con el `grep` y probando
cada diálogo); la revisión de una compra sin «lo que leyó la IA» si `verCompra` falla.

**Verificación:** KB de cada respuesta antes/después; mismas filas, mismas sumas al pie;
abrir una factura (PDF, correo), una compra de la cola (tipo y referencia de proforma);
`npm run verify`.

---

## Fase 8 — Gerencia: cada pestaña pide lo suyo (PR `rend/f8-gerencia-pestanas`)

**Cambios**
1. Mover el cuerpo del `useMemo` de `src/routes/panel/gerencia.tsx:102-171` **tal cual** a
   una función pura `montarDatosGerencia(entradas)` en `src/dominio/gerencia-datos.ts`.
   Primer commit: solo el traslado + prueba de instantánea (`toStrictEqual`) con un fichero de
   casos `src/dominio/__fixtures__/banco-gerencia.json` (cancelados, devoluciones, web sin
   pagar, canje ticket → factura, rectificativa sin pedido, pedido web de las 23:15 UTC del
   31-10, textil sin coste, con y sin comparación). Los casos son de prueba, no se muestran
   en ninguna pantalla.
2. Segundo commit: cada pestaña llama solo a los ganchos que necesita (tabla de
   necesidades del informe de Gerencia), **con las mismas claves de caché**, y pasa lo leído
   por `montarDatosGerencia`. La insignia «pendiente de documentar» y el botón del resumen
   diario cargan aparte sin bloquear.
3. Los esqueletos de `Resumen.tsx:121` y `:130` distinguen «cargando» de «falta la
   migración».

**Riesgos:** un campo sin su gancho → la pestaña enseña «—». Se evita con la instantánea y
con una **doble lectura temporal** (`?comparar=1`: el gancho nuevo compara con la lectura
antigua y avisa en consola del campo distinto), probada con mes, año y A/B, y retirada en el
mismo PR antes de fusionar.

**Verificación:** prueba de instantánea, doble lectura sin avisos, pruebas visuales de cada
pestaña a 1440 y 390 px, `npm run verify`.

**Ganancia esperada:** Tesorería y Clientes dejan de esperar a ventas y documentos; 30–60 %
menos peticiones por pestaña.

**Estado (21-10-2026): hecha** en dos commits. `montarDatosGerencia` y `FUENTES_DE_PESTANA`
en `src/dominio/gerencia-datos.ts`; prueba de igualdad contra el cuerpo antiguo (12 estados
de lectura × 3 grupos × 6 filtros) y, por pestaña, campo a campo; la prueba de arquitectura
`gerencia-pestanas.test.ts` lee el código de cada pestaña y falla si lee un campo cuya lectura
no pide. En lugar de la doble lectura temporal `?comparar=1`, esas pruebas (no hay que
retirarlas). Las ventas, sus documentos y los ajustes se siguen pidiendo en todas las
pestañas (la insignia está en todas): Tesorería solo gana 4 peticiones (31 → 27); Clientes
30 → 17, Comercial 36 → 23, Margen 28 → 19 (con los datos de `pruebas-visuales`). Capturas de
las diez pestañas, ordenador y móvil: idénticas.

---

## Fase 9 — `listPedidos` en una consulta (PR `rend/f9-listpedidos-una-consulta`)

Requiere la F2 y la F3 aplicadas.

**Cambios**
1. `src/lib/pedidos.functions.ts:179-330`: una sola consulta con relaciones incrustadas:
   ```
   *, items:pedido_items(*), cobros(*),
   tracking:enlaces_seguimiento(id,pedido_id,transportista,url,codigo_seguimiento),
   cliente:clientes(id,nombre,email), tienda:tiendas(nombre),
   docs:facturas!pedido_id(id,tipo,serie,ejercicio,numero,estado,rectifica_a_id,sustituye_a_id,
        rect:facturas!rectifica_a_id(id))
   ```
   con `.order(…, { referencedTable: "cobros" })` para conservar el orden de cobros, y el
   documento por pedido calculado igual que hoy (`documentoDelPedido`). Nombres de claves
   foráneas comprobados en el banco (`\d facturas`) antes de escribirlo (PGRST201 si hay
   ambigüedad).
2. `leerTodas` con lectura paralela: primera página con `count: "exact"`, el resto con
   `enParalelo` (solo para consultas ordenadas de forma total, como `fecha_pedido desc, id`).
3. Tras guardar un pedido: `setQueryData` de esa fila con `leerPedidoFila(id)` (misma función
   de montaje que la lista, para que la fila salga idéntica) e invalidación con
   `refetchType: "none"` de lo demás. Cambio de estado: optimista con vuelta atrás si falla.
   - **Choca con la F4:** la invalidación global de la F4 recargaría igualmente la lista
     entera (está activa). Estas mutaciones llevan `meta: { invalida: "sin-recarga-activa" }`
     y el `MutationCache` de la F4 hace entonces
     `invalidateQueries({ refetchType: "none" })` (todo marcado viejo, nada recargado al
     momento). Ampliar el tipo de `mutationMeta` de la F4.
   - Si el guardado cambia `fecha_pedido` o `tienda_id`, la fila puede salir del periodo o
     de la tienda que se ve: en ese caso se quita de la caché en vez de sustituirla (y si
     entra en otro periodo, ya está marcado viejo).
   - Las insignias que dependen de los pedidos (botón verde de documento, totales del día,
     metros realizados por día de `realizadosPorDia`) se recalculan desde la caché
     actualizada; `realizadosPorDia` viene del servidor y **no** se recalcula con
     `setQueryData`: si cambia `realizado_en`, invalidar la lista (recarga normal).

**Riesgos:** consulta mal nombrada → la lista no carga (se prueba en el banco SQL antes);
tope de filas en recursos incrustados: **sin comprobar** (el comentario de `:93-101` habla
del orden de `pedido_items`, no de ese tope; en PostgREST `max_rows` limita la respuesta de
primer nivel). Comprobarlo en el banco con un pedido de > 1000 líneas antes de dar la
consulta por buena; la rectificativa autorreferenciada
(`facturas!rectifica_a_id`) también se prueba en el banco, que es fácil confundir el
sentido de la relación; se pierde el respaldo `faltaLaTabla` de cobros (confirmar en
fase 0 que la migración de cobros está en producción); fila sustituida distinta a la de la
lista (se evita usando la misma función).

**Verificación:** `diff` del JSON de `listPedidos` antes/después (mes y año, con anulados,
rectificativas sin `pedido_id` y varios cobros); registrar un cobro → 1 sola petición; F5 y
cifras iguales; `npm run verify`.

**Ganancia esperada:** Pedidos año de ~15 (tras F2) a 2 viajes; dentro del límite de 50
subpeticiones del plan gratuito.

**Estado (21-10-2026): puntos 1 y 2 hechos; el 3, pendiente.**
- Tope de lo incrustado **comprobado**: con PostgREST 12.2.3 y `db-max-rows = 1000`, un pedido
  de 1500 líneas llega con 1000. `leerListaPedidos` (`src/lib/pedidos-lista.ts`) vuelve a leer
  como antes los pedidos que llegan con 1000 líneas, y lee la lista entera como antes
  (`leerListaPedidosPorPartes`) si llegan 1000 cobros o documentos de un pedido, si la consulta
  falla o si no trae lo incrustado. `facturas!rectifica_a_id` desde una factura devuelve las que
  la rectifican (comprobado). Se conserva así el respaldo `faltaLaTabla` de cobros.
- Banco (2.409 pedidos de octubre): 84 peticiones → 8. JSON igual salvo el orden de las líneas
  de 75 pedidos que antes compartían trozo con el de 1500 líneas (antes se releían por id).
- **Pendiente, el punto 3** (fila sustituida con `setQueryData`, cambio de estado optimista,
  excepción `meta` en la invalidación de la F4): toca la invalidación global y el riesgo de
  «fila distinta a la de la lista»; va en su propio PR, con `leerPedidoFila` montada con la
  misma función que la lista.

---

## Fase 10 — Fiscal por trimestre (PR `rend/f10-fiscal-trimestre`)

**Cambios:** `useFiscal` (`src/lib/gerencia.ts:628-689`) por trimestre con clave
`["gerencia-fiscal-trim", año, trim]`; Resultados (`Resultados.tsx:46-54`) junta los 16
trimestres quitando duplicados por id; las referencias de canje se siguen leyendo sobre el
conjunto entero; huecos de numeración con clave propia (`:671`). Trimestres cerrados con
`staleTime: 5 * 60_000`, **no** `Infinity`: los documentos llevan la **fecha del pedido**
(decisión del 9-10-2026, `20261021100000`), así que un ticket emitido hoy para un pedido de
junio cae en un trimestre «cerrado». La invalidación global de la F4 solo cubre los
guardados de **este** navegador; si lo emite otro de los tres usuarios, con `Infinity` el
303 de esta pantalla no se enteraría nunca sin recargar la página. **No** recortar desde la primera venta: las compras anteriores cuentan
para el IVA soportado.

**Riesgo alto:** un duplicado o un hueco cambia el 303. Se evita con doble lectura
(`?comparar=1`, resultado entero antiguo contra nuevo) y las pruebas de
`impuestosPorTrimestre` en `src/dominio/`.

**Ganancia:** cambiar de mes reutiliza 15 de 16 trimestres; la pestaña Resultados deja de
leer 5 años cada vez.

**Estado (21-10-2026): pendiente, sin empezar** (riesgo alto sobre el 303; necesita su doble
lectura y las pruebas de `impuestosPorTrimestre`).

---

## Fase 11 — Agregados en SQL (PR `rend/f11-sql-agregados`)

Migración `supabase/migrations/20261101100000_gerencia_documentos_de_pedidos.sql`
(nombre provisional; fecha posterior a la última aplicada):
```sql
CREATE OR REPLACE FUNCTION public.gerencia_documentos_de_pedidos(_desde timestamptz, _hasta timestamptz)
RETURNS TABLE (id uuid, pedido_id uuid, textil_pedido_id uuid, tipo text, estado text,
               rectifica_a_id uuid, sustituye_a_id uuid /* = columnas de DocumentoDePedido */)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  -- documentos de los pedidos del tramo ampliado + rectificativas que apuntan a ellos,
  -- tienda y textil; la RLS de quien llama se aplica (security invoker)
$$;
GRANT EXECUTE ON FUNCTION public.gerencia_documentos_de_pedidos(timestamptz, timestamptz) TO authenticated;
```
El navegador sigue filtrando por los ids de sus ventas; `pedidosDocumentados` y
`pendienteDocumentar` no cambian. Devolver filas de más no altera nada.

Segunda migración, `…_tienda_resumen.sql`: `tienda_resumen(_tienda_id uuid)` (`SECURITY
INVOKER`) con las sumas que hoy calcula `src/routes/panel/tiendas/$tiendaId/index.tsx:31-49`
en el navegador. **Esto cambia cifras** en tiendas con más de 1000 pedidos o facturas (hoy
se cortan en silencio, `tiendas/$tiendaId/index.tsx:33-39`): no es rendimiento sino un
arreglo, y por la regla 4 del `CLAUDE.md` va como tarea aparte, con el antes y el después
enseñados a Javier. Mientras no haya más de 1000 filas, hoy esa pantalla lee como mucho
1000 y no es lenta: **se saca de esta fase.** Si se hace, el cálculo debe ser el mismo que
el del dominio: si la suma implica reglas (devoluciones, web sin pagar), **no** se pasa a
SQL y se usa `leerTodas` + dominio.

Reversibles con `DROP FUNCTION`. Pruebas en `supabase/pruebas/` que cargan el mismo
`banco-gerencia.json` y escriben BIEN/MAL contra los números esperados; `probar-migraciones.sh`
falla con cualquier MAL. Las aplica Javier.

**Ganancia:** documentos de Gerencia año de ~25 (tras F2) a 1–2 peticiones.

**Estado (21-10-2026): pendiente, sin empezar.** Ninguna migración escrita en este bloque.

---

## Fase 12 — Servidor (PR `rend/f12-servidor`)

1. `cheerio`, `nodemailer`, `@anthropic-ai/sdk`, `juice` con `await import()` dentro del
   handler que los usa (nunca también de forma normal: test de importaciones mixtas).
   Investigar por qué recharts, jspdf, html2canvas y canvg entran en `_ssr/`.
   Medir con `du` y `gzip` sobre `.output/server` (hoy 13 MB, ~2,9 MB gzip: al borde de los
   3 MB del plan gratuito).
2. Si la fase 0 confirma Cloudflare y regiones distintas: `"placement": { "mode": "smart" }`
   (en `nitro.cloudflare.wrangler` de `vite.config.ts`). Si es Vercel: región de funciones =
   región de Supabase.
3. Retirar las sondas de migración (`faltaLaColumna`, `*_version`, 5 en `listCompras`)
   **solo** cuando Javier confirme que las migraciones 20261014…–20261030… están en
   producción.
4. Configuración (Javier): si la fase 0 da `HS256`, activar claves de firma asimétricas
   (JWT Signing Keys). Quita un viaje a cada server function; las sesiones abiertas se
   renuevan. Con claves asimétricas `getClaims` descarga el JWKS
   (`/auth/v1/.well-known/jwks.json`), y `auth-middleware.ts:43` crea un cliente nuevo **por
   petición** (fichero generado, no se edita): comprobar con el medidor de la 0.2 que el JWKS
   no se pide en cada server function (la caché de supabase-js debe compartirse entre
   clientes del mismo Worker caliente). Si se pidiera cada vez, la ganancia es nula.

**Estado (21-10-2026): punto 1 hecho; 2, 3 y 4 pendientes.**
- Por qué entraban canvg y core-js en cada página del panel: el medidor usaba `performance`
  suelto, que la compilación del servidor sustituye por el de unenv, y rolldown lo metió en el
  trozo de canvg. Con `globalThis.performance`, el trozo del panel evalúa 2,4 MB en vez de
  3,5 MB. `@anthropic-ai/sdk` pasa a `import()` dentro de la lectura (`cola-compras.server`
  1,1 → 0,36 MB). nodemailer, juice/cheerio, jspdf, html2canvas y canvg ya se cargaban con
  `import()`; recharts solo desde los trozos de gráficas (`React.lazy`).
- El tamaño subido **no baja** (13 MB, 2,9 MB comprimido, al borde de los 3 MB del plan
  gratuito de Workers): un `import()` sigue dentro del Worker. Bajarlo exige sacar librerías del
  servidor (por ejemplo, generar los PDF solo en el navegador): tarea aparte.
- 12.2 (`placement`) espera a saber dónde se despliega (fase 0); 12.3 (retirar sondas) espera a
  que Javier confirme las migraciones en producción; 12.4 es configuración de Javier.

---

## Cosas que NO conviene hacer (y por qué)

- **Subir `staleTime` antes de la invalidación central** (F4 commit 1): cifras viejas tras
  guardar en ~23 claves que hoy nadie invalida.
- **`refetchOnWindowFocus: false` sin botón «Actualizar»**: los cambios del webhook de Woo y
  de los otros usuarios no se verían nunca.
- **Subir `FILAS_POR_PAGINA` por encima de 1000** sin subir `max_rows` en Supabase:
  `leerTodas` entiende «menos de N filas» como el final y cortaría las listas en silencio.
- **`suppress_redundant_updates_trigger`** en la sincronización Woo: con `ON CONFLICT …
  RETURNING` la fila suprimida no vuelve y rompe `idPorWooId` (devoluciones y líneas).
- **Tocar el trigger de auditoría o su cerrojo global** para acelerar escrituras: es
  append-only y encadenado; solo lo decide Javier. Lo que hay que reducir es lo que la
  sincronización reescribe sin cambios (tarea aparte, ver abajo).
- **Paginar Pedidos en el servidor** o pasar a SQL los canjes, impuestos o `resumenPeriodo`:
  duplicaría lógica fiscal que vive en `src/dominio/` con pruebas, y las cifras podrían dejar
  de cuadrar.
- **Virtualizar la tabla de Pedidos**: tablas por día con `table-fixed`; mucho riesgo visual
  para lo que añade sobre `memo` + pintado por días.
- **Clientes en SQL** (historial agregado): riesgo alto de números distintos (regla del día
  del pedido, web sin pagar). Solo si tras F3 y F4 sigue lento, y con prueba de igualdad.
- **Agrupar trozos con `advancedChunks`** de forma agresiva: puede crear ciclos y el error
  `__exportAll`; ganancia pequeña. Si se hace, al final y probando en el servidor node.
- **Sacar zod del cliente** o quitar realtime de supabase-js: poco ahorro (13 KB / 56 KB)
  para mucho riesgo.
- **Edge Functions**, **bun**, editar `src/routeTree.gen.ts`, **aplicar migraciones**: lo
  prohíbe el `CLAUDE.md`.
- **Mover lecturas del servidor al navegador** antes de las fases 2, 3 y 9: con decenas de
  consultas en cadena, ahorrar el salto al Worker no arregla nada. Después, opcional y solo
  para las que usan `context.supabase` (nunca `supabaseAdmin`, Vault, PDF, SMTP, Woo ni la
  numeración).
- **Datos de ejemplo en pantalla** para «que cargue algo»: estado vacío o esqueleto, siempre.

---

## Encontrado por el camino (no es rendimiento; tareas aparte, sin arreglar aquí)

1. Lecturas sin paginar que se cortan en 1000 filas sin avisar: `tienda-dashboard`
   (`tiendas/$tiendaId/index.tsx:33-39`), `listTextilClientes` (`textil.functions.ts:370`),
   `listTextilCobros` (`textil.functions.ts:1175-1186`, afecta al estado de cobro),
   `clientes-empresa` (`PantallaClientes.tsx:140`), `clientes-tienda` (`facturas.tsx:581-588`),
   `listarMovimientosCaja` (`caja.functions.ts:91-96`), `listarCatalogosCaja`.
2. Textil › Inicio: «facturado este mes» compara solo `getMonth()`, sin el año
   (`textil/index.tsx:35-37`).
3. Políticas de lectura `true` en `banco_conciliaciones`, `banco_movimientos`,
   `textil_stock_movimientos` y `textil_stock_reservas`: no respetan `empresa_id`.
4. La sincronización Woo reescribe pedidos y líneas aunque no cambien: ~700 filas de
   auditoría por página sin cambios (`woocommerce.functions.ts:664-700`).
5. Prefijos de invalidación que no coinciden con nada (`["clientes"]`, `["gerencia"]`,
   `["empresa"]`); la F4 los hace inocuos.
6. `isAdmin` vale `false` hasta que responde `comprobarAdminActual`: el lápiz de
   `RealizadoEn` aparece tarde.
7. El comentario de `resumen-diario.ts:5-7` no describe lo que hace el código.
8. No está escrito dónde se despliega producción (Cloudflare o Vercel): dejarlo en el
   `CLAUDE.md`.

---

## Reglas del `CLAUDE.md` que este plan respeta

- Migraciones solo escritas, nunca aplicadas por Claude (F3, F11).
- Políticas por operación: solo se recrean las `FOR SELECT`; ningún `FOR ALL`.
- Auditoría intacta: trigger, cadena, enmascarado **y su política de lectura** (la F3 ya no la toca).
- Lógica de negocio en `src/dominio/` (`montarDatosGerencia`, mapas de tickets), con pruebas.
- Una rama y un PR por fase, commits pequeños, nada directo a `main`.
- Sin datos inventados en pantalla; los casos de prueba solo en pruebas.
- Vista de ordenador sin cambios: pruebas visuales en cada fase que toque interfaz.
- `npm run verify` al final de cada fase, y `probar-migraciones.sh` en las que llevan SQL.

---

## Revisión del crítico (20-10-2026)

Contrastado contra `da961f1`, la compilación de `…/scratchpad/rend/build` (preset
`cloudflare-module`) y el banco PostgreSQL 16 con 36.018 pedidos. Cada punto dice qué estaba
mal o faltaba y qué se ha cambiado arriba.

### Afirmaciones corregidas
1. **F2.8 — fichero y arreglo equivocados.** `gerencia.tsx:83` es `useVentasGerencia(previo)`,
   no `useTextilPeriodo`; el gancho está en `gerencia.ts:70`. Y `enabled: hayComparacion`
   dejaba `isPending` en `true` para siempre dentro de `useVentasGerencia`. Cambiado por un
   corte en el `queryFn` con `diasDelRango`, como ya hacen `usePedidosPeriodo` y
   `useCobrosPeriodo` (que **ya** no piden nada con el rango vacío: solo el textil lo hacía).
2. **F3 — índice `textil_facturas(rectifica_a_id)`.** El plan decía «comprobar»: comprobado,
   **falta** (sí existe el de `facturas`). Añadido al SQL; la copia del banco no lo lleva.
3. **F3 — auditoría fuera.** La app no lee `auditoria` (ningún `from("auditoria")` en `src/`),
   así que «1,6 s → 92 ms» era una ganancia que nadie ve. Se quita la política de esa tabla
   de la migración.
4. **F9 — cita falsa.** `pedidos.functions.ts:95-101` no habla del tope de filas de los
   recursos incrustados, sino del orden de `pedido_items`. Marcado como «sin comprobar» con
   la prueba que lo comprueba.
5. **Números de línea de `PedidosTable.tsx`:** la consulta está en `:271` (no `:269`), las
   tarjetas en `:637` y la tabla en `:658` (no `:636-655`/`:697-739`), la búsqueda en `:204`.
6. **F4 — `retry`:** la expresión `4\d\d` no detectaba errores HTTP (los mensajes no llevan
   el código) y casaba con importes o números que empiezan por 4. Cambiada.

### Cambios que habrían alterado cifras o dejado datos viejos
7. **F4 — `onSuccess` → `onSettled`.** Facturar varios y la sincronización Woo pueden escribir
   a medias y fallar; con `onSuccess` lo ya escrito no se refrescaba.
8. **F4 — `cancelRefetch: false`.** Sin él, la invalidación global más la manual de cada
   mutación (`PedidosTable.tsx:238/298/308`) cancelaba y relanzaba `listPedidos`: el navegador
   aborta, pero el Worker termina la primera entera (doble carga en servidor).
9. **F4 — acciones de fila con `keepPreviousData`.** Al cambiar de tienda se podían cobrar o
   borrar pedidos de la vista anterior. Se desactivan mientras `isPlaceholderData`.
10. **F9.3 contra F4.** La invalidación global recargaba igualmente la lista que la F9 quiere
    sustituir fila a fila. Añadida una excepción de `meta` y el caso de la fila que cambia
    de fecha o tienda, y `realizadosPorDia` (que viene del servidor).
11. **F10 — `staleTime: Infinity` en trimestres cerrados.** Con documentos fechados en el
    día del pedido, un ticket de hoy puede caer en un trimestre pasado; si lo emite otro
    usuario, el 303 no se habría actualizado nunca. Pasa a 5 minutos.
12. **F7.1 — Textil › Inicio cambiaba cifras.** «Filtrar la suma del mes por fecha» arreglaba
    el fallo del año (`getMonth()` sin año) y el `count` de clientes superaba el tope de 1000
    de hoy: dos cifras distintas. Además `cantidad <= cantidad_minima` no se puede filtrar en
    PostgREST. Reescrito para dar las mismas cifras leyendo menos columnas.
13. **F11 — `tienda_resumen()` cambiaba cifras** (quita el corte de 1000). Sale de la fase y
    va a tarea aparte (regla 4 del `CLAUDE.md`).
14. **Resumen, punto 7 («ninguna cifra cambia, capturas iguales píxel a píxel»)** no era cierto
    con F5.6, F7.1 y F11 tal como estaban. Corregidos los tres y matizado el texto.

### Riesgos que no estaban cubiertos
15. **F3 — nombres de políticas en producción.** Si una política se creó a mano con otro
    nombre, `DROP POLICY IF EXISTS` no hace nada y la nueva se suma a la vieja: mismo acceso
    pero sin ganancia. Añadida la consulta previa para Javier y un `DO $$ … RAISE` al final de
    la migración.
16. **F3 — equivalencia con `NULL`.** `is_tienda_member` deja ver al admin filas con `tienda_id`
    nulo; `= ANY(array)` no. Es equivalente solo porque las columnas son `NOT NULL`
    (comprobado); queda escrito.
17. **F2 — 6 conexiones por petición en Workers.** El «4 × 6 = 24 en vuelo» de `listPedidos`
    no ocurre; se encolan. Ganancia de Pedidos año rebajada de ~15 a ~20 esperas.
18. **F2 — `break` del coste textil** al faltar la tabla: hay que mantener su semántica en
    paralelo.
19. **F5.1 — `useIsMobile`** arranca en `false` (pinta ordenador y luego móvil) y lo comparte
    la barra lateral: gancho nuevo con estado inicial síncrono.
20. **F5.5/F5.6** — saltos de scroll con `content-visibility`, restauración de scroll, impresión,
    y «Ver más días» que sí cambia la vista de ordenador: F5.6 pasa a opcional y con umbral.
21. **F6.4 — `_headers`.** El preset ya genera `.output/public/_headers`; un fichero propio en
    `public/` puede pisarlo o ser pisado. Añadida la comprobación.
22. **F6.2** — diferir las pestañas añade un viaje en cadena en la primera visita a Gerencia:
    precargar la pestaña Resumen.
23. **F7.7** — `tiendaId` en `useCobrosPeriodo` rompía la caché compartida con Gerencia si se
    metía en medio de la clave.
24. **F4 — coste de invalidar todo en Gerencia** (~30 consultas, fiscal de 5 años incluido,
    tras guardar un ajuste). Queda dicho y medido; no se quita la invalidación.
25. **F12.4 — JWKS por petición** con claves asimétricas y un cliente nuevo por petición:
    comprobar antes de contar la ganancia.

### Ganancias rebajadas o matizadas
26. **F3:** el banco tiene 36k pedidos (3–10 años del volumen supuesto). Las ×4–×20 son reales
    en el banco; en producción, en milisegundos, serán menores. Lo que más pesa hoy es el
    número de viajes (F2, F9, F11) y la distancia Worker ↔ Supabase (F12.2).
27. **Textil › Inicio:** «< 20 KB» no es alcanzable sin cambiar cifras; objetivo «÷10».

### Orden de fases
28. La F4 no depende de la F3: se puede hacer sin esperar a que Javier aplique migraciones.
    La F9 necesita además la F4 (excepción de `meta`) y conviene tras la F5. La F6 y la F8
    tocan las mismas líneas de `gerencia.tsx`: la 6 antes.

### Comprobado y correcto (sin cambios)
- `QueryClient` sin opciones en `router.tsx:6`, `defaultPreloadStaleTime: 0` en `:12`.
- `beforeLoad` con `getUser()` en `panel/route.tsx:8`; nadie lee `context.user`; es el único
  `getUser` del cliente.
- Dos `comprobarAdminActual` al entrar (`auth-context.tsx:42-51`).
- `getClaims` en `auth-middleware.ts:56`.
- Índices que el plan da por existentes: existen (`facturas_por_pedido`, `cobros_por_pedido`,
  `pedidos_vivos_idx`…); los nuevos no existían; `ESTADOS_ABIERTOS` coincide con el
  predicado del índice parcial; `estado` es el enum `pedido_estado`.
- Políticas de lectura actuales en el banco: una `SELECT` por tabla, con los nombres que usa
  la migración. `probar-migraciones.sh` dio TODO EN VERDE con las dos migraciones
  (`banco2.log`), **antes** de añadir el índice nuevo y quitar la auditoría: repetir.
- Bundle: `index-*.js` 557 KB / 160 KB gzip; recharts 369 KB / 97 KB gzip importado de forma
  estática por `panel-*.js`, `gerencia-*.js`, `facturacion-*.js` y `facturacion-global-*.js`.
  Servidor 13 MB, 2,9 MB comprimido.
- `listPedidos` ya pide `ajustes` y `realizados` a la vez entre sí, pero después de las páginas
  de pedidos (`:207-232`): el punto F2.3 es correcto.
- Ninguna migración propuesta usa `FOR ALL`, toca datos, ni aplica nada contra producción.
