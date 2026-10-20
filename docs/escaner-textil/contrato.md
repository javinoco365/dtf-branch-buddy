# Contrato de la obra: escáner textil, catálogo, stock al pedido y cuentas del almacén

Fuente de verdad para los cinco equipos (SQL, DOMINIO, SERVIDOR, INTERFAZ, CUENTAS) que trabajan
a la vez en la rama `claude/crm-dtf-app-review-ftg3di`. Si el código y este contrato no
coinciden, manda el contrato; si el contrato tiene un hueco o un error, se avisa al arquitecto
y no se improvisa en el fichero de otro equipo.

Fecha: 19-10-2026. Migraciones con prefijo `20261028…`.

---

## 0. Reglas comunes

### 0.1 Decisiones de Javier (no se discuten)

1. Las reservas de stock nacen al **aceptar** el presupuesto (al convertirlo en pedido), como
   hoy. El presupuesto **solo avisa** del disponible: no reserva y **no bloquea** el guardado.
2. La personalización DTF en líneas textil queda **fuera** (futuro). No se añade ninguna columna
   de diseño, posición ni metros a las líneas textil.
3. Todo entra por factura: sin albaranes ni recepciones parciales. El stock entra al registrar
   la factura. Desde esta obra **no existe la entrada manual con motivo `compra`**.
4. Las facturas de proveedores textil traen una línea por talla. La IA no junta ni separa
   líneas.
5. El precio de venta lo pone Javier. El sistema enseña un precio **recomendado** solo como
   información, calculado con datos reales; si no hay datos, no recomienda nada.
6. Todo en una sola entrega.

### 0.2 Reglas del equipo

- Nada de commit, push ni PR. Nada de aplicar migraciones a una base real.
- `src/routeTree.gen.ts` no se toca. **No se crean rutas**: pestañas y diálogos en las
  pantallas que ya existen; los saltos entre pantallas, con parámetros de búsqueda.
- Cada equipo toca **solo** sus ficheros (sección 6). Nada de `prettier --write` fuera de ellos,
  nada de `git checkout`, `stash` ni `reset`.
- Ningún módulo se importa a la vez de forma estática y con `await import()`
  (`src/arquitectura/importaciones-mixtas.test.ts`). En concreto:
  - `@/integrations/supabase/client.server` y `./cola-compras.server`: **solo** `await import()`
    dentro del handler.
  - `@/lib/pdf-informe-socios`: **solo** `await import()` (ResumenDiario); sus tipos con
    `import type`.
  - Todo lo nuevo de `src/dominio/` y `src/lib/escaner-textil.ts`: **solo** importación estática.
- La aplicación se despliega desde `main` **antes** de que Javier aplique las migraciones. Todo
  lo nuevo funciona sin ellas: lecturas con `faltaLaColumna`, `faltaLaTabla` y
  `faltaLaFuncion` (`src/lib/rpc.ts`) y el aviso
  `AVISO_MIGRACION_ESCANER` (sección 3.1). Lo que ya funciona sigue funcionando igual.
- Todo en español: nombres, mensajes, comentarios. Formato de euros, números y fechas solo con
  `src/lib/format.ts`. Cálculos (repartos, márgenes, valores, redondeos) solo en `src/dominio/`.
- No se inventan datos: sin datos, estado vacío (`src/components/EstadoVacio.tsx`) o «—»; nunca
  un número de ejemplo.
- Al terminar, cada equipo deja su parte compilando y con sus pruebas en verde. La verificación
  conjunta (`npm run verify` y `supabase/pruebas/probar-migraciones.sh`) la hace el orquestador.

### 0.3 Invariantes que tiene que cumplir el conjunto

| Id  | Invariante                                                                                                                                                                                                                                         | Quién lo garantiza                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| I1  | En una compra textil registrada con el escáner, Σ coste de entrada de sus artículos = base de la factura, **al céntimo**.                                                                                                                          | Dominio calcula (`repartirCostes`), servidor recalcula, SQL comprueba y rechaza.                             |
| I2  | Toda entrada de stock con motivo `compra` lleva `compra_id` y `compra_linea_id` (FK).                                                                                                                                                              | SQL (CHECK `NOT VALID`, las antiguas quedan como están; E-STK-2: solo las anotan las funciones de registro). |
| I3  | `textil_stock.cantidad` y `textil_stock.coste_unitario` solo cambian por movimientos.                                                                                                                                                              | SQL (guardián).                                                                                              |
| I4  | Una compra registrada no cambia proveedor, NIF, número, fecha, importes, categoría, gasto ni líneas, no vuelve a borrador y no se borra (las no textil admiten borrado lógico). Solo pasa a registrada por sus funciones (E-CAB-6).                | SQL (triggers).                                                                                              |
| I5  | Una devolución de cliente entra al coste al que salió en ese pedido.                                                                                                                                                                               | SQL (`stock_aplicar_movimiento`).                                                                            |
| I6  | Únicos: proveedor por (empresa, NIF normalizado) o, sin NIF, por (empresa, nombre normalizado); producto por (empresa, marca, referencia); variante activa por (producto, color, talla); EAN por empresa; memoria por (empresa, proveedor, clave). | SQL (índices únicos).                                                                                        |
| I7  | La base y el dominio normalizan igual (claves de texto, tallas, NIF, memoria).                                                                                                                                                                     | Vectores de prueba compartidos (2.2 y 7.1).                                                                  |
| I8  | Sin datos no hay cifra: ni precio recomendado, ni coste, ni margen inventados.                                                                                                                                                                     | Dominio devuelve `null`; la interfaz enseña «—» o estado vacío.                                              |
| I9  | El valor de un movimiento es `redondear(cantidad × coste_unitario, 2)`; todas las cuentas del almacén suman esos valores.                                                                                                                          | Dominio (`valorMovimiento`).                                                                                 |
| I10 | Toda salida de stock sale al coste medio vigente (1.3.4), y compras + altas − Δ almacén = coste de lo vendido con pedido + pérdidas (2.7), por valor y en cualquier periodo.                                                                       | SQL (`stock_aplicar_movimiento`) y dominio (`cuentaAlmacen`).                                                |

### 0.4 Glosario

- **Producto**: el modelo de prenda (marca + referencia del fabricante + nombre). Tabla nueva
  `textil_productos`.
- **Variante**: una fila de `textil_stock` (producto × color × talla). Es lo que tiene stock.
- **Memoria del escáner**: `textil_referencias_proveedor`. «Lo que este proveedor llama X es
  esta variante». Aprende al registrar.
- **Casado**: decidir a qué variante corresponde una línea de factura.
- **Coste de entrada**: lo que cuesta cada unidad que entra, con portes, descuentos y otros
  cargos repartidos.
- **Disponible**: físico − reservado (+ lo que reserva el propio pedido que se edita).
- **Fecha efectiva** de un movimiento: `fecha` si la tiene; si no, el día de `created_at` en
  hora de Madrid.

### 0.5 Orden de trabajo e integración

Los cinco equipos empiezan a la vez. Para no esperarse:

1. DOMINIO entrega **primero** `src/dominio/tipos-textil.ts` tal cual está en 2.1 (copiar y
   pegar) y las firmas de 2.2–2.10 con su JSDoc; después las implementaciones y pruebas.
   SERVIDOR, INTERFAZ y CUENTAS programan contra esas firmas desde el minuto uno.
2. SQL no depende de nadie. SERVIDOR depende de los nombres SQL de la sección 1 y de los tipos
   de 2.1. INTERFAZ depende de las server functions de la sección 3. CUENTAS depende de las
   columnas SQL y del dominio de 2.7–2.9.
   INTERFAZ usa las claves `g_precio_recomendado` y `m_margen_previsto` de
   `src/dominio/definiciones.ts`, que son de CUENTAS: CUENTAS las añade **lo primero** (5.3), para
   que la interfaz compile desde el principio. SERVIDOR entrega igual de pronto
   `mensajeErrorEscaner` (3.1), que usan la interfaz y el propio servidor.
3. Si un equipo necesita algo de un fichero que no es suyo, lo pide al equipo dueño con la firma
   exacta; no lo escribe él.

---

## 1. Esquema SQL

Tres migraciones, en este orden. Cada una se puede aplicar dos veces sin cambiar nada
(`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` + `CREATE`, constraints dentro de
`DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$`). Cabecera de comentario como las
demás (QUÉ RESUELVE / QUÉ CAMBIA / REVERSIBLE), en castellano.

| Fichero                                                         | Qué hace                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261028100000_escaner_textil_esquema.sql` | Funciones de normalización, tablas nuevas, columnas nuevas (todas admiten nulo o tienen valor por defecto), RLS y auditoría de lo nuevo, RLS por empresa y por operación de `textil_compras` y `textil_compra_lineas`.                                                                                                                                           |
| `supabase/migrations/20261028100100_escaner_textil_datos.sql`   | `escaner_textil_migrar_datos()` y su llamada: agrupa el stock en productos, marca variantes repetidas, crea proveedores desde las compras, enlaza las compras, aprende de las compras ya registradas.                                                                                                                                                            |
| `supabase/migrations/20261028100200_escaner_textil_reglas.sql`  | Reglas: `producto_id NOT NULL`, índices únicos, triggers (producto automático, cabecera inmutable, guardián del coste, coste congelado en líneas), nuevo `stock_aplicar_movimiento`, CHECK de entradas por compra, funciones `textil_compra_guardar_y_registrar`, `textil_compra_registrar` (nueva versión), `textil_stock_fusionar` y `escaner_textil_version`. |

### 1.0 Trampas del banco de pruebas que hay que respetar

`probar-migraciones.sh` aplica **todas** las migraciones y luego corre las pruebas, que **no**
se deshacen. Varias pruebas viejas revierten y vuelven a aplicar migraciones antiguas:

- `C2` revierte `20261014100000` (borra `tipo_iva`, `tipo_irpf`, `estado_pago`, `fecha_pago`,
  `borrada_en`, `cuota_iva`, `cuota_irpf`, `liquido`, …) y la vuelve a aplicar, que hace
  `UPDATE textil_compras SET tipo_iva…` sobre **todas** las compras, también las registradas.
- `C3` revierte `20261015100000` (borra `revision`, `revision_motivo`, `confianza`,
  `fichero_huella`, `proveedor_clave`, `numero_clave`) y la vuelve a aplicar.
- `C1` vuelve a aplicar `20261013100000`, que **reescribe** `textil_compra_registrar` con la
  versión vieja.

Por eso, **obligatorio**:

1. Ningún índice, vista, restricción, columna generada, política RLS ni función `BEGIN ATOMIC`
   de estas migraciones puede depender de columnas creadas por `20261014100000` o
   `20261015100000`. Las funciones `plpgsql` sí pueden usarlas (no crean dependencia).
2. El trigger que protege la cabecera compara con `to_jsonb(OLD)` / `to_jsonb(NEW)`, de forma
   que una columna que no existe en ese momento cuenta como igual (1.3.2).
3. Ninguna FK nueva hacia `empresas` puede ser `ON DELETE CASCADE` (`99_empresa_no_se_borra`
   falla): todas `ON DELETE RESTRICT`.
4. `C18` vuelve a aplicar las tres migraciones al empezar (restaura las funciones que pisó `C1`)
   y va dentro de `BEGIN … ROLLBACK`, **salvo** el caso de reversión (7.1, caso 24), que va
   después del `ROLLBACK` (las reversiones llevan su propio `BEGIN … COMMIT`, como las demás de
   `supabase/reversiones/`).
5. `C1` deja puesta la versión **vieja** de `textil_compra_registrar` (sin enlace a la línea)
   hasta que `C18` vuelve a aplicar las migraciones. Ninguna prueba entre `C1` y `C18` registra
   una compra **textil con líneas** (C3, C5 y C14 registran `consumibles`/`otros` sin líneas):
   que siga así. Por eso las reglas que dependen de quién escribe (E-CAB-6, E-STK-2) miran el
   rol que ejecuta (`current_user`), no una bandera que la versión vieja no pondría.
6. Las migraciones no llevan `BEGIN`/`COMMIT` de nivel superior (las pruebas las incluyen con
   `\ir` dentro de una transacción) y terminan con `NOTIFY pgrst, 'reload schema';`, como
   `20261026100000`, para que PostgREST vea las tablas, columnas y funciones nuevas sin esperar.
7. **Idempotencia de restricciones.** Volver a añadir una `UNIQUE` o `PRIMARY KEY` con el mismo
   nombre no da `duplicate_object` sino `duplicate_table` (42P07: crea un índice con ese
   nombre). El bloque es `EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL`, o mejor,
   comprobar antes en `pg_constraint`. Vale para `compra_linea_id_compra`.
8. **`ON CONFLICT` con índices parciales.** Los únicos de proveedores, productos y variantes son
   parciales: el `INSERT … ON CONFLICT` tiene que repetir el predicado del índice, o Postgres
   responde «there is no unique or exclusion constraint matching the ON CONFLICT
   specification». Ejemplos exactos:
   `ON CONFLICT (empresa_id, nif_clave) WHERE nif_clave <> '' DO NOTHING`;
   `ON CONFLICT (empresa_id, nombre_clave) WHERE nif_clave = '' DO NOTHING`;
   `ON CONFLICT (empresa_id, marca_clave, referencia_clave) WHERE referencia_clave <> '' DO NOTHING`;
   `ON CONFLICT (empresa_id, marca_clave, nombre_clave) WHERE referencia_clave = '' DO NOTHING`;
   `ON CONFLICT (producto_id, color_clave, talla_clave) WHERE activa AND NOT repetida DO NOTHING`.
   Después de cada `DO NOTHING`, se vuelve a buscar la fila (en `READ COMMITTED` la ve aunque
   la haya insertado otra transacción que acaba de confirmar): así dos registros simultáneos
   no crean dos veces el mismo proveedor, producto o variante.

### 1.1 `20261028100000_escaner_textil_esquema.sql`

#### 1.1.1 Funciones de normalización (exactas)

Puras, `IMMUTABLE`, `PARALLEL SAFE`. **No** se revoca `EXECUTE`: las usan columnas generadas.
El dominio (2.2) las replica carácter a carácter. Primero se quitan los acentos, luego todo lo
que no sea `[A-Za-z0-9]`, y solo después se pasa a minúsculas o mayúsculas: así el resultado no
depende de la configuración regional de la base.

```sql
CREATE OR REPLACE FUNCTION public.textil_clave(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT lower(regexp_replace(
           translate(coalesce(_t, ''),
             'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
             'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
           '[^A-Za-z0-9]', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.textil_clave_talla(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE s
           WHEN 'XXS' THEN '2XS'  WHEN 'XXXS' THEN '3XS'
           WHEN 'XXL' THEN '2XL'  WHEN 'XXXL' THEN '3XL'
           WHEN 'XXXXL' THEN '4XL' WHEN 'XXXXXL' THEN '5XL'
           WHEN 'U' THEN 'UNICA' WHEN 'TU' THEN 'UNICA'
           WHEN 'ONESIZE' THEN 'UNICA' WHEN 'OS' THEN 'UNICA'
           ELSE s END
    FROM (SELECT regexp_replace(regexp_replace(
                   upper(regexp_replace(
                     translate(coalesce(_t, ''),
                       'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                       'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
                     '[^A-Za-z0-9]', '', 'g')),
                   '^TALLA', ''), '(ANOS|YEARS)$', '') AS s) x
$$;

CREATE OR REPLACE FUNCTION public.nif_clave(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE WHEN s ~ '^ES[0-9A-Z][0-9]{7}[0-9A-Z]$' THEN substr(s, 3) ELSE s END
    FROM (SELECT upper(regexp_replace(coalesce(_t, ''), '[^A-Za-z0-9]', '', 'g')) AS s) x
$$;

CREATE OR REPLACE FUNCTION public.textil_clave_memoria(
  _referencia TEXT, _color TEXT, _talla TEXT, _descripcion TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE
    WHEN public.textil_clave(_referencia) <> '' THEN
      'r:' || public.textil_clave(_referencia) || '|' || public.textil_clave(_color)
           || '|' || public.textil_clave_talla(_talla)
    WHEN public.textil_clave(_descripcion) <> '' THEN
      'd:' || public.textil_clave(_descripcion)
           || CASE WHEN public.textil_clave(_color) <> '' OR public.textil_clave_talla(_talla) <> ''
                   THEN '|' || public.textil_clave(_color) || '|' || public.textil_clave_talla(_talla)
                   ELSE '' END
    ELSE '' END
$$;
```

Sin referencia, la clave lleva el color y la talla **si la línea los trae**: con solo la
descripción («Camiseta Heavy»), todas las tallas de una factura darían la misma clave y la
memoria mandaría las cinco tallas a la misma variante. Con color y talla vacíos queda
`'d:' || descripción`, que es la forma de la memoria migrada (1.2 D).

#### 1.1.2 `public.proveedores` (nueva)

| Columna                      | Tipo                                                                                            | Notas                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `id`                         | `UUID PK DEFAULT gen_random_uuid()`                                                             |                                                              |
| `empresa_id`                 | `UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT DEFAULT public.empresa_por_defecto()` |                                                              |
| `nombre`                     | `TEXT NOT NULL`                                                                                 | CHECK `proveedor_nombre` `btrim(nombre) <> ''`               |
| `nif`                        | `TEXT`                                                                                          | tal como se escribe                                          |
| `nif_clave`                  | `TEXT GENERATED ALWAYS AS (public.nif_clave(nif)) STORED`                                       | `''` si no hay NIF                                           |
| `nombre_clave`               | `TEXT GENERATED ALWAYS AS (public.textil_clave(nombre)) STORED`                                 |                                                              |
| `email`, `telefono`, `notas` | `TEXT`                                                                                          |                                                              |
| `activo`                     | `BOOLEAN NOT NULL DEFAULT true`                                                                 |                                                              |
| `origen`                     | `TEXT NOT NULL DEFAULT 'manual'`                                                                | CHECK `proveedor_origen` IN (`manual`,`migracion`,`escaner`) |
| `created_at`, `updated_at`   | `TIMESTAMPTZ NOT NULL DEFAULT now()`                                                            |                                                              |

Índices: `proveedores_nif_unico` UNIQUE `(empresa_id, nif_clave) WHERE nif_clave <> ''`;
`proveedores_nombre_unico` UNIQUE `(empresa_id, nombre_clave) WHERE nif_clave = ''`.
Sin IBAN ni datos bancarios (si algún día se añaden, van a `auditoria_enmascarar()`).

#### 1.1.3 `public.textil_productos` (nueva)

| Columna                    | Tipo                                                                                            | Notas                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`                       | `UUID PK`                                                                                       |                                                                                                   |
| `empresa_id`               | `UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT DEFAULT public.empresa_por_defecto()` |                                                                                                   |
| `marca`                    | `TEXT`                                                                                          | marca de la **prenda** (Gildan, B&C…). No confundir con `textil_marcas` (marca comercial propia). |
| `referencia`               | `TEXT`                                                                                          | referencia del fabricante (5000, TU01T…)                                                          |
| `nombre`                   | `TEXT NOT NULL`                                                                                 | CHECK `producto_nombre` `btrim(nombre) <> ''`                                                     |
| `categoria`                | `TEXT`                                                                                          | texto libre: camiseta, sudadera…                                                                  |
| `notas`                    | `TEXT`                                                                                          |                                                                                                   |
| `activo`                   | `BOOLEAN NOT NULL DEFAULT true`                                                                 |                                                                                                   |
| `origen`                   | `TEXT NOT NULL DEFAULT 'manual'`                                                                | CHECK `producto_origen` IN (`manual`,`migracion`,`escaner`)                                       |
| `marca_clave`              | `TEXT GENERATED ALWAYS AS (public.textil_clave(marca)) STORED`                                  |                                                                                                   |
| `referencia_clave`         | `TEXT GENERATED ALWAYS AS (public.textil_clave(referencia)) STORED`                             |                                                                                                   |
| `nombre_clave`             | `TEXT GENERATED ALWAYS AS (public.textil_clave(nombre)) STORED`                                 |                                                                                                   |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()`                                                            |                                                                                                   |

Índices: `textil_productos_referencia_unica` UNIQUE `(empresa_id, marca_clave, referencia_clave)
WHERE referencia_clave <> ''`; `textil_productos_nombre_unico` UNIQUE
`(empresa_id, marca_clave, nombre_clave) WHERE referencia_clave = ''`.

#### 1.1.4 `public.textil_stock`: columnas nuevas

| Columna        | Tipo                                                                 | Notas                                                              |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `producto_id`  | `UUID REFERENCES textil_productos(id) ON DELETE RESTRICT`            | nulo aquí; `NOT NULL` en la migración de reglas                    |
| `ean`          | `TEXT`                                                               | CHECK `textil_stock_ean_formato` (texto exacto debajo de la tabla) |
| `repetida`     | `BOOLEAN NOT NULL DEFAULT false`                                     | duplicado heredado: no se casa, no se vende, se fusiona            |
| `color_clave`  | `TEXT GENERATED ALWAYS AS (public.textil_clave(color)) STORED`       |                                                                    |
| `talla_clave`  | `TEXT GENERATED ALWAYS AS (public.textil_clave_talla(talla)) STORED` |                                                                    |
| `fusionada_en` | `UUID REFERENCES textil_stock(id) ON DELETE SET NULL`                | variante en la que se fusionó esta (1.3.9); nulo si no             |

CHECK exacto (fuera de la tabla para que el `|` no se lea como columna):

```sql
CONSTRAINT textil_stock_ean_formato CHECK (ean IS NULL OR ean ~ '^([0-9]{8}|[0-9]{12,14})$')
```

El dígito de control lo valida el dominio; en la base solo entran EAN ya normalizados (2.2:
`normalizarEan` devuelve 8, 13 o 14 cifras).

Índice `textil_stock_por_producto (producto_id)`.

#### 1.1.5 `public.textil_referencias_proveedor` (nueva, memoria del escáner)

| Columna                    | Tipo                                                                                            | Notas                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `id`                       | `UUID PK`                                                                                       |                                                                  |
| `empresa_id`               | `UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT DEFAULT public.empresa_por_defecto()` |                                                                  |
| `proveedor_id`             | `UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE`                                    |                                                                  |
| `clave`                    | `TEXT NOT NULL`                                                                                 | `textil_clave_memoria(…)`; CHECK `memoria_clave` `clave <> ''`   |
| `stock_id`                 | `UUID NOT NULL REFERENCES textil_stock(id) ON DELETE CASCADE`                                   |                                                                  |
| `unidades_por_pack`        | `NUMERIC NOT NULL DEFAULT 1`                                                                    | CHECK `memoria_pack` `> 0`                                       |
| `veces`                    | `INT NOT NULL DEFAULT 1`                                                                        | CHECK `memoria_veces` `>= 1`; cuántas veces seguidas se confirmó |
| `ultima_compra_id`         | `UUID REFERENCES textil_compras(id) ON DELETE SET NULL`                                         |                                                                  |
| `origen`                   | `TEXT NOT NULL DEFAULT 'escaner'`                                                               | CHECK `memoria_origen` IN (`escaner`,`migracion`,`manual`)       |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()`                                                            |                                                                  |

Índices: `textil_referencias_proveedor_clave_unica` UNIQUE `(empresa_id, proveedor_id, clave)`;
`textil_referencias_proveedor_por_stock (stock_id)`.

#### 1.1.6 Compras: columnas nuevas

`public.textil_compras`:

- `proveedor_id UUID REFERENCES proveedores(id) ON DELETE RESTRICT`. Se conservan `proveedor`
  y `nif_proveedor` (el texto de la factura).
- Índice `textil_compras_por_proveedor (proveedor_id) WHERE proveedor_id IS NOT NULL`.

`public.textil_compra_lineas`:

| Columna                                                  | Tipo                               | Notas                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tipo`                                                   | `TEXT NOT NULL DEFAULT 'articulo'` | CHECK `compra_linea_tipo` IN (`articulo`,`porte`,`descuento`,`otro`)                                                           |
| `referencia`, `marca`, `modelo`, `color`, `talla`, `ean` | `TEXT`                             | lo que lee la IA, corregido en la revisión                                                                                     |
| `unidades_por_pack`                                      | `NUMERIC NOT NULL DEFAULT 1`       | CHECK `compra_linea_pack` `> 0`                                                                                                |
| `unidades_stock`                                         | `NUMERIC`                          | `cantidad × unidades_por_pack`; lo escribe el registro en artículos textil                                                     |
| `coste_total_entrada`                                    | `NUMERIC(14,2)`                    | importe + parte repartida; lo escribe el registro                                                                              |
| `coste_unitario_entrada`                                 | `NUMERIC`                          | `coste_total_entrada / unidades_stock`, 8 decimales                                                                            |
| `casado_metodo`                                          | `TEXT`                             | CHECK `compra_linea_casado` `IS NULL OR IN (memoria, ean, referencia, sugerencia, manual, nueva)`; sirve para medir el escáner |

Y la restricción `compra_linea_id_compra UNIQUE (id, compra_id)` (la necesita la FK compuesta).

#### 1.1.7 `public.textil_stock_movimientos`: columnas nuevas

- `compra_id UUID REFERENCES textil_compras(id) ON DELETE RESTRICT`
- `compra_linea_id UUID`
- FK `stock_mov_linea_de_su_compra (compra_linea_id, compra_id) REFERENCES
textil_compra_lineas (id, compra_id) ON DELETE RESTRICT` (MATCH SIMPLE: sin línea no se
  comprueba).
- CHECK `stock_linea_con_compra CHECK (compra_linea_id IS NULL OR compra_id IS NOT NULL)`.
  Sin ella, con MATCH SIMPLE, un movimiento con `compra_linea_id` y `compra_id` nulo se salta
  la FK entera y puede apuntar a una línea que no existe.
- `fecha DATE` (**sin** valor por defecto en el `ADD COLUMN`: las filas viejas quedan en nulo y
  se leen por su `created_at`; las nuevas las rellena el trigger, 1.3.4). Es una fecha
  **contable de calendario** (la de la factura en las compras), del mismo tipo que
  `textil_compras.fecha`; no es un instante, por eso no es `timestamptz` (el instante sigue en
  `created_at`). Excepción justificada a la regla de CLAUDE.md, dicha en la cabecera de la
  migración.
- Índices `textil_stock_mov_por_compra (compra_id) WHERE compra_id IS NOT NULL` y
  `textil_stock_mov_por_fecha (empresa_id, fecha)`.

El libro sigue siendo inmutable: añadir columnas no toca filas.

#### 1.1.8 Líneas de presupuesto y pedido textil

`textil_presupuesto_items` y `textil_pedido_items`: `coste_unit_snapshot NUMERIC(12,4)` (nulo =
sin coste conocido). **No** se rellena hacia atrás: las líneas viejas se quedan sin coste (no se
recalcula leyendo el maestro).

#### 1.1.9 RLS, permisos, triggers comunes y auditoría

Tablas nuevas (`proveedores`, `textil_productos`, `textil_referencias_proveedor`):

- `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated; GRANT ALL … TO service_role;`
- `ENABLE ROW LEVEL SECURITY` (además del `rls_auto_enable()`).
- Cuatro políticas por tabla, `TO authenticated`, nombres `"<tabla> lectura|alta|edicion|baja"`:
  `USING (public.es_miembro_empresa(auth.uid(), empresa_id))` y/o `WITH CHECK (lo mismo)`.
  Nada de `FOR ALL`.
- Trigger `<tabla>_touch BEFORE UPDATE … touch_updated_at()`.
- Trigger `<tabla>_auditoria AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW EXECUTE FUNCTION
public.auditoria_registrar()` (uno y solo uno, `tgtype & 127 = 29`).

`textil_compras` (se sustituyen las cuatro políticas `USING (true)`, mismos nombres):

| Política          | Operación | Condición                                                                              |
| ----------------- | --------- | -------------------------------------------------------------------------------------- |
| `compras lectura` | SELECT    | `USING (es_miembro_empresa(auth.uid(), empresa_id))`                                   |
| `compras alta`    | INSERT    | `WITH CHECK (es_miembro_empresa(auth.uid(), empresa_id) AND estado = 'borrador')`      |
| `compras edicion` | UPDATE    | `USING (…miembro…) WITH CHECK (…miembro…)` (lo registrado lo protege el trigger 1.3.2) |
| `compras baja`    | DELETE    | `USING (es_miembro_empresa(auth.uid(), empresa_id) AND estado = 'borrador')`           |

`textil_compra_lineas` (mismos nombres que hoy, `compra lineas lectura|alta|edicion|baja`): la
condición es `EXISTS (SELECT 1 FROM public.textil_compras c WHERE c.id =
textil_compra_lineas.compra_id AND public.es_miembro_empresa(auth.uid(), c.empresa_id))`, en
`USING` y/o `WITH CHECK` según la operación. El estado lo sigue protegiendo
`compra_registrada_inmutable()`.

No se tocan las políticas de `textil_stock_movimientos` ni `textil_stock_reservas` (ver 8).

### 1.2 `20261028100100_escaner_textil_datos.sql`

Define y llama a `public.escaner_textil_migrar_datos() RETURNS JSONB` (`plpgsql`,
`SECURITY DEFINER`, `SET search_path = public`; `REVOKE ALL … FROM PUBLIC, anon, authenticated`;
`GRANT EXECUTE … TO service_role`). Idempotente: solo toca lo que aún no está hecho. Termina con
`RAISE NOTICE` del resultado. La migración de reglas vuelve a llamarla justo antes del
`SET NOT NULL`.

Pasos, en este orden:

- **A. Productos desde el stock.** Para cada `(empresa_id, textil_clave(nombre))` de las variantes
  con `producto_id IS NULL`, un producto `origen = 'migracion'`, `marca` y `referencia` nulas,
  `nombre = btrim(nombre)` y `categoria` de la variante más antigua del grupo
  (`ORDER BY created_at, id`). `INSERT … ON CONFLICT DO NOTHING`; después
  `UPDATE textil_stock SET producto_id` por `(empresa_id, nombre_clave)` con
  `marca_clave = '' AND referencia_clave = ''`.
- **B. Repetidas.** Entre las variantes `activa AND NOT repetida`, por
  `(producto_id, color_clave, talla_clave)` con más de una: se queda buena la que tiene más
  movimientos (empate: la más antigua, luego `id`); las demás, `repetida = true`. No se
  desactiva nada ni se mueve stock.
- **C. Proveedores desde las compras.** Para las compras con `proveedor_id IS NULL`:
  - con `nif_clave(nif_proveedor) <> ''`: un proveedor por `(empresa_id, nif_clave)`,
    `nombre` = el `proveedor` de la compra más reciente con nombre (si ninguna lo tiene, el NIF),
    `nif` = el de esa compra, `origen = 'migracion'`;
  - sin NIF y con `textil_clave(proveedor) <> ''`: uno por `(empresa_id, textil_clave(proveedor))`;
  - `ON CONFLICT DO NOTHING` y `UPDATE textil_compras SET proveedor_id` (permitido aunque estén
    registradas: de nulo a un proveedor, 1.3.2). Las compras sin NIF ni nombre se quedan sin
    proveedor.
- **D. Memoria desde lo ya registrado.** Para cada línea de compra **textil registrada** con
  `proveedor_id` y `stock_id` de una variante activa y no repetida:
  `clave = textil_clave_memoria(NULL, NULL, NULL, descripcion)` (forma `'d:' || descripción`);
  por `(empresa_id, proveedor_id, clave)`: si **todas** las líneas con esa clave fueron a la
  misma variante, se aprende con `veces` = cuántas fueron; si fueron a **más de una** variante
  (descripción sin talla ni color, por ejemplo), la clave es ambigua y **no se aprende**;
  `origen = 'migracion'`; `ON CONFLICT DO NOTHING`. Antes decía «gana la más reciente»: con una
  descripción sin talla, eso enseñaba a mandar todas las tallas a la última.

Devuelve `{"productos": n, "variantes_enlazadas": n, "repetidas": n, "proveedores": n,
"compras_enlazadas": n, "memoria": n}` (lo hecho en esta llamada).

Las variantes y compras que se actualizan dejan su fila de auditoría sin autor (es una
migración); está dicho en la cabecera.

### 1.3 `20261028100200_escaner_textil_reglas.sql`

En este orden.

#### 1.3.1 Producto automático y `NOT NULL`

- `public.textil_stock_producto_auto()` + trigger `textil_stock_producto_auto BEFORE INSERT ON
textil_stock`: si `NEW.producto_id IS NULL`, busca el producto de
  `(NEW.empresa_id, marca_clave = '', referencia_clave = '', nombre_clave =
textil_clave(NEW.nombre))` o lo crea (`nombre = btrim(NEW.nombre)`, `categoria =
NEW.categoria`, `origen = 'manual'`, `ON CONFLICT DO NOTHING` y vuelve a buscar). Así el código
  viejo, las pruebas viejas y cualquier alta sin producto siguen funcionando.
- `PERFORM public.escaner_textil_migrar_datos();` y después
  `ALTER TABLE textil_stock ALTER COLUMN producto_id SET NOT NULL`.
- Índices: `textil_stock_variante_unica` UNIQUE `(producto_id, color_clave, talla_clave)
WHERE activa AND NOT repetida`; `textil_stock_ean_unico` UNIQUE `(empresa_id, ean)
WHERE ean IS NOT NULL`.

#### 1.3.2 Cabecera de compra registrada inmutable

Función `public.compra_registrada_cabecera()` (`plpgsql`, `SET search_path = public`, **sin**
`SECURITY DEFINER`: mira `current_user`, que dentro de una función `SECURITY DEFINER` sería el
dueño y no quien escribe), usada por dos triggers:

- `textil_compras_registrada_inmutable AFTER UPDATE ON textil_compras FOR EACH ROW` (AFTER para
  ver ya calculadas las columnas generadas).
- `textil_compras_registrada_no_se_borra BEFORE DELETE ON textil_compras FOR EACH ROW`.

Lógica:

```text
DELETE: si OLD.estado = 'registrada' → error E-CAB-1. Si no, RETURN OLD.
UPDATE: si OLD.estado <> 'registrada':
          si NEW.estado = 'registrada' y current_user IN ('authenticated', 'anon') → E-CAB-6
            (registrar solo lo hacen textil_compra_registrar y
             textil_compra_guardar_y_registrar, que son SECURITY DEFINER: dentro de ellas
             current_user es el dueño; un UPDATE directo desde PostgREST, no).
          RETURN NEW (borrador: todo lo demás se puede).
        si NEW.estado <> 'registrada' → error E-CAB-2.
        v_viejo := to_jsonb(OLD); v_nuevo := to_jsonb(NEW);
        para cada k en {empresa_id, proveedor, nif_proveedor, numero, fecha, base, iva, irpf,
                        total, categoria, lectura_ia, cuota_iva, cuota_irpf, liquido}:
          si (v_viejo -> k) IS DISTINCT FROM (v_nuevo -> k) → error E-CAB-3 con k.
        proveedor_id, fichero_ruta, fichero_huella: solo de nulo a un valor (si no, E-CAB-3).
        gasto_id: solo de un valor a nulo (si no, E-CAB-3). Es lo que hace la FK
                  ON DELETE SET NULL al borrar un gasto fijo (gerencia.functions.ts lo
                  permite hoy; la prueba C1 3b lo comprueba).
        borrada_en: si OLD.categoria = 'textil' y cambia → E-CAB-4;
                    si pasa de un valor a nulo → E-CAB-5.
        RETURN NEW.
```

Lo que sí cambia en una registrada: `estado_pago`, `fecha_pago`, `forma_pago`, `notas`,
`concepto`, `nota_descuadre`, `revision`, `revision_motivo` y `confianza` (el CHECK
`compra_registrada_revisada` sigue obligando a `revisada`), `tipo_iva`/`tipo_irpf` **solo si
no cambian las cuotas** (así pasa la reaplicación de `C2`, cuando las cuotas aún no existen),
`gasto_id` a nulo, `updated_at`, y `borrada_en` de nulo a fecha en las no textil.

#### 1.3.3 El coste medio solo por movimientos

`CREATE OR REPLACE FUNCTION public.stock_cantidad_solo_por_movimiento()`: además de lo que hace
hoy con `cantidad`, si `NEW.coste_unitario IS DISTINCT FROM OLD.coste_unitario` y la bandera
`app.stock_via_movimiento` no vale `'1'` → error E-STK-1. En `INSERT` no se comprueba (una
variante nueva no tiene historia).

#### 1.3.4 Nuevo `stock_aplicar_movimiento()`

`CREATE OR REPLACE` con la misma firma y el mismo trigger. Cambios sobre la versión de
`20260903200000`, en este orden, dentro del bloque que ya bloquea la variante `FOR UPDATE`:

1. `NEW.fecha := COALESCE(NEW.fecha, (now() AT TIME ZONE 'Europe/Madrid')::date);`
2. Entradas sin coste:
   - `motivo = 'devolucion_cliente'`, `cantidad > 0`, `coste_unitario = 0`: si hay
     `textil_pedido_id`, coste = `sum(-cantidad × coste_unitario) / sum(-cantidad)` de los
     movimientos `venta` de **ese pedido** en **esa variante o en las fusionadas en ella**
     (`stock_id = NEW.stock_id OR stock_id IN (SELECT id FROM textil_stock WHERE fusionada_en =
NEW.stock_id)`): tras una fusión, las líneas del pedido apuntan al destino pero la venta
     salió del origen; si no hay ventas o no hay pedido, el coste medio vigente.
   - `motivo = 'ajuste_inventario'`, `cantidad > 0`, `coste_unitario = 0`: el coste medio
     vigente.
3. Recalcular la media cuando `cantidad > 0 AND (coste_unitario > 0 OR motivo = 'compra')`. Una
   compra a coste 0 (regalo, 100 % de descuento) **sí** baja la media. Con saldo ≤ 0, manda la
   entrada (como hoy).
4. **Toda** salida (`cantidad < 0`) se congela al coste medio vigente, traiga el coste que
   traiga (antes solo las de coste 0). Con coste medio ponderado no existe una salida a otro
   coste: si una merma o una devolución a proveedor entrase a un coste escrito a mano, el valor
   del libro y el de la caché (unidades × coste medio) dejarían de coincidir sin que nada lo
   explique. Hoy todas las salidas de la aplicación llegan con coste 0; la fusión (1.3.9) usa el
   coste medio, que es el mismo.

Además, trigger nuevo `textil_stock_mov_compra_solo_registro BEFORE INSERT ON
textil_stock_movimientos` con la función `public.stock_compra_solo_por_registro()` (`plpgsql`,
**sin** `SECURITY DEFINER`): si `NEW.motivo = 'compra'` y `current_user IN ('authenticated',
'anon')` → E-STK-2. Las entradas por compra solo las anotan las funciones de registro
(`SECURITY DEFINER`); sin esto, cualquiera con sesión podría anotar por PostgREST una entrada
`compra` enlazada a la línea de una factura ya registrada y duplicarla (la FK y la CHECK de 1.3.5
se cumplirían).

#### 1.3.5 Entradas por compra, siempre con su factura

Restricciones en `textil_stock_movimientos` (dentro de `DO … duplicate_object`):

- `stock_compra_con_factura CHECK (motivo <> 'compra' OR compra_linea_id IS NOT NULL) NOT VALID`
  (las entradas viejas sin enlace se quedan; las nuevas no pasan).
- `stock_linea_solo_compra CHECK (compra_linea_id IS NULL OR motivo = 'compra')`.
- `stock_compra_id_motivo CHECK (compra_id IS NULL OR motivo IN ('compra', 'devolucion_proveedor'))`.

#### 1.3.6 Coste congelado en líneas de presupuesto y pedido

`public.textil_item_coste_congelado()` + triggers `textil_presupuesto_items_coste_congelado` y
`textil_pedido_items_coste_congelado` `BEFORE INSERT OR UPDATE`:

- INSERT: si `coste_unit_snapshot IS NULL AND stock_id IS NOT NULL` →
  `NULLIF(coste_unitario, 0)` de la variante (nulo si no tiene coste).
- UPDATE: si `OLD.coste_unit_snapshot IS NOT NULL` y además `NEW.stock_id IS NOT DISTINCT FROM
OLD.stock_id`, o `NEW.stock_id IS NULL` (la FK `ON DELETE SET NULL` al retirar la variante), o
  `current_setting('app.fusion_variantes', true) = '1'` (1.3.9) → se conserva el de `OLD`. Solo
  si la persona cambia la línea a **otra** variante se toma el coste de la nueva. Sin estas dos
  excepciones, retirar o fusionar una variante reescribiría costes ya congelados.

#### 1.3.7 `public.textil_compra_guardar_y_registrar(_compra JSONB, _usuario_id UUID) RETURNS JSONB`

`plpgsql`, `SECURITY DEFINER`, `SET search_path = public`.
`REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
La llama el servidor con `adminComoUsuario(context.userId)` y `_usuario_id = context.userId`.
Sirve para **todas** las categorías; solo `textil` toca el stock. Todo en una transacción: si
algo falla, no queda nada (ni compra, ni líneas, ni proveedor, ni variantes, ni memoria, ni
movimientos).

Claves de `_compra` (forma exacta: tipo `RegistroCompra`, 2.1). Texto vacío cuenta como nulo.

| Clave                                                                                              | Uso                                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `id`                                                                                               | compra existente en borrador (de la cola) o nulo para crearla   |
| `empresa_id`                                                                                       | obligatoria si `id` es nulo (si falta, `empresa_por_defecto()`) |
| `proveedor_id`                                                                                     | proveedor elegido; si nulo, se busca o crea por NIF o nombre    |
| `proveedor`, `nif_proveedor`, `numero`, `fecha` (`YYYY-MM-DD`), `concepto`, `notas`                | cabecera                                                        |
| `base`, `iva`, `irpf`, `total`                                                                     | números                                                         |
| `categoria`, `gasto_id`, `tipo_iva`, `tipo_irpf`, `liquido_origen`, `nota_descuadre`, `forma_pago` | como hoy                                                        |
| `lectura_ia`                                                                                       | JSON; solo se escribe si la fila no tenía                       |
| `lineas[]`                                                                                         | `LineaRegistro` (2.1)                                           |

Pasos:

0. **Autor y acceso.** `_usuario_id` nulo → E-REG-1. `set_config('app.usuario_id',
_usuario_id::text, true)`. Empresa = la de la compra existente o la del JSON;
   `NOT es_miembro_empresa(_usuario_id, empresa)` → E-REG-2.
1. **Cabecera.** Si hay `id`: `SELECT … FOR UPDATE`; no existe → E-REG-3; `estado =
'registrada'` → E-REG-4. `fecha` nula → E-REG-5. `fecha` posterior a hoy en Madrid → E-REG-23
   (una fecha mal leída, 2062 por 2026, escondería las entradas de stock de todas las cuentas
   del almacén hasta ese año). Se escribe la cabecera (UPDATE o INSERT) en `estado = 'borrador'`.
2. **Proveedor.** Con `proveedor_id`: tiene que ser de la empresa (si no, E-REG-6) y, si el
   proveedor tiene NIF y la factura también, tienen que coincidir por `nif_clave` (si no,
   E-REG-25: la persona corrigió el NIF en la revisión y el `proveedor_id` es del NIF viejo).
   Sin él: por `nif_clave(nif_proveedor)` si no es `''`; si no lo encuentra y hay un proveedor
   **sin NIF** con el mismo `nombre_clave`, se le pone el NIF de la factura y se usa ese (así un
   proveedor que primero llegó sin NIF no se parte en dos, con la memoria repartida); si la
   factura no trae NIF, por `textil_clave(proveedor)` entre los sin NIF; si no existe, se crea
   (`origen = 'escaner'`, `nombre` = texto de la factura o el NIF; `ON CONFLICT … WHERE …
DO NOTHING` (1.0.8) y se vuelve a buscar). Categoría `textil` sin proveedor posible → E-REG-7.
   En otras categorías puede quedar nulo.
3. **Líneas.** `DELETE` de las líneas del borrador e `INSERT` de `lineas[]` con
   `orden = posición` (0…n−1) y todas las columnas de 1.1.6. «Línea N» en los mensajes es
   `orden + 1`. Fuera de textil, `stock_id`, `nueva_variante`, `unidades_stock` y `coste_*` se
   ignoran (nulos).
4. **Solo `categoria = 'textil'`.**
   1. Al menos un `articulo` → si no, E-REG-8.
   2. Por cada artículo: `importe < 0` → E-REG-9; `unidades_stock` ≠ `round(cantidad ×
unidades_por_pack, 6)`, no entero o ≤ 0 → E-REG-10; `coste_total_entrada` o
      `coste_unitario_entrada` nulos o < 0 → E-REG-11;
      `abs(unidades_stock × coste_unitario_entrada − coste_total_entrada) >= 0.005` → E-REG-12.
   3. `porte` con `importe < 0` o `descuento` con `importe > 0` → E-REG-13. Las líneas que no son
      artículo nunca llevan variante (se ignoran `stock_id` y `nueva_variante`).
   4. `abs(Σ round(importe, 2) de todas las líneas − round(base, 2)) > 0.02` → E-REG-14 (redondeo
      por línea, igual que el dominio, 2.3 paso 3: si no, un importe leído con tres decimales
      haría que el navegador y la base discreparan justo en el borde).
   5. `Σ coste_total_entrada de los artículos <> round(base, 2)` → E-REG-15 (I1).
   6. Variante de cada artículo:
      - con `stock_id`: tiene que existir, ser de la empresa (E-REG-16), estar activa (E-REG-17)
        y no ser repetida (E-REG-18);
      - sin `stock_id` y con `nueva_variante`: si trae `producto_id` y `producto` nulos a la vez →
        E-REG-20. Producto = `nueva_variante.producto_id` (de la
        empresa) o se busca/crea con `nueva_variante.producto`: si `textil_clave(referencia) <>
''`, por `(empresa, marca_clave, referencia_clave)`; si no, por `(empresa, marca_clave,
nombre_clave)` con `referencia_clave = ''`; se crea con `origen = 'escaner'`. Variante =
        la activa y no repetida de `(producto, textil_clave(color), textil_clave_talla(talla))` o
        se crea (`nombre` = nombre del producto, `categoria` del producto, `color`, `talla`,
        `ean`, `sku`, `precio_venta`, `cantidad_minima`, `cantidad 0`, `coste_unitario 0`). Si el
        EAN ya lo tiene otra variante → E-REG-19. Dos líneas con el mismo producto, color y talla
        acaban en la misma variante. `casado_metodo = 'nueva'`.
      - sin ninguna de las dos → E-REG-20.
        Se escribe `stock_id` (y `casado_metodo`) en la línea.
   7. **EAN aprendido:** si la línea trae `ean` con formato válido, la variante no tiene y
      ninguna otra de la empresa lo tiene, se le pone.
   8. **Movimientos:** por artículo, `INSERT INTO textil_stock_movimientos (empresa_id,
stock_id, motivo 'compra', cantidad = unidades_stock, coste_unitario =
coste_unitario_entrada, compra_id, compra_linea_id, fecha = fecha de la compra, nota =
'Compra <numero|(sin número)> de <proveedor> · línea N')`.
   9. **Memoria:** se agrupan los artículos con `clave = textil_clave_memoria(referencia, color,
talla, descripcion) <> ''` (y proveedor) **por clave**:
      - si todos los de una clave van a la **misma** variante: **un** `INSERT … ON CONFLICT
(empresa_id, proveedor_id, clave) DO UPDATE SET veces = CASE WHEN misma variante THEN
veces + 1 ELSE 1 END, stock_id, unidades_por_pack, ultima_compra_id, origen = 'escaner',
updated_at = now()` por clave y factura (`veces` cuenta facturas, no líneas);
      - si van a **variantes distintas**, la clave es ambigua: no se aprende y se **borra** la
        entrada que hubiera con esa clave (ya no es de fiar). `aprendidas` no la cuenta.
5. **Registrar.** `UPDATE textil_compras SET estado = 'registrada', revision = 'revisada',
revision_motivo = NULL, proveedor_id = v_proveedor`, en su **propio** bloque
   `BEGIN … EXCEPTION WHEN unique_violation`: solo si el `CONSTRAINT_NAME` (`GET STACKED
DIAGNOSTICS`) es `textil_compras_factura_unica` → E-REG-21; cualquier otro, se relanza tal
   cual. Un `unique_violation` de un EAN, una variante o la memoria no puede salir como «factura
   ya registrada».
6. **Devuelve** `{"id", "movidas", "variantes_creadas", "aprendidas", "proveedor_id",
"proveedor_nuevo"}`.

#### 1.3.8 `public.textil_compra_registrar(_compra_id UUID) RETURNS INT` (versión nueva)

Misma firma, mismos permisos (`authenticated`, `service_role`). Es el camino viejo (sin
reparto) y se mantiene por compatibilidad y por las pruebas viejas:

- Bloquea, falla si ya está registrada (como hoy).
- **Acceso** (nuevo): si `auth.uid()` no es nulo y `NOT es_miembro_empresa(auth.uid(),
empresa_id de la compra)` → E-REG-2. Es `SECURITY DEFINER` y la puede llamar `authenticated`:
  hoy registra la compra de cualquier empresa que se le pase. Sin `auth.uid()` (superusuario de
  las pruebas, `service_role`) no se comprueba.
- Textil: si alguna línea no es `articulo` → E-REG-22 (`restrict_violation`); si alguna no tiene
  `stock_id` → el mensaje de hoy, con `ERRCODE = 'restrict_violation'` (lo espera `C1`).
- Movimiento por línea con `cantidad × unidades_por_pack`, coste
  `COALESCE(coste_unitario_entrada, precio_unitario / unidades_por_pack)`, `compra_id`,
  `compra_linea_id` y `fecha = COALESCE(fecha de la compra, hoy en Madrid)`.
- No convierte el `unique_violation` del duplicado (lo esperan `C3` y `90`).

#### 1.3.9 `public.textil_stock_fusionar(_origen UUID, _destino UUID, _usuario_id UUID) RETURNS JSONB`

`SECURITY DEFINER`, solo `service_role`. Para resolver repetidas.

1. Autor (`app.usuario_id`) y acceso como en 1.3.7. Bloquea las dos variantes `FOR UPDATE` en
   orden de `id`. Iguales → E-FUS-1; distinta empresa → E-FUS-2; destino inactivo o repetido →
   E-FUS-3.
2. Si el origen tiene `cantidad = q ≠ 0`, dos `ajuste_inventario` al coste medio del origen
   `c`: `−q` en el origen y `+q` en el destino (si `q < 0`, al revés), nota `'Fusión: pasa a
<destino>'` / `'Fusión: viene de <origen>'`.
3. Reservas del origen → al destino (sumando si ya había una del mismo pedido) y se borran las
   del origen.
4. Con `set_config('app.fusion_variantes', '1', true)` (para que 1.3.6 conserve el coste
   congelado de cada línea) y quitándola al acabar: `textil_pedido_items` y
   `textil_presupuesto_items` con `stock_id = origen` → destino; `textil_referencias_proveedor`
   igual; y las líneas de compras **en borrador** (si no, al registrarlas darían E-REG-17). Las
   líneas de compras registradas y de facturas no se tocan (son historia).
5. Si el destino no tiene EAN y el origen sí, pasa (primero se quita del origen).
6. Origen: `activa = false`, `repetida = false`, `fusionada_en = destino` (lo usa 1.3.4 para
   devolver al coste de la venta las devoluciones de pedidos que salieron del origen).
7. Devuelve `{"unidades": q, "reservas": n, "lineas": n}`.

#### 1.3.10 `public.escaner_textil_version() RETURNS INT`

`LANGUAGE sql STABLE`, devuelve `1`. `GRANT EXECUTE … TO authenticated, service_role`. Es la
última sentencia de la migración (antes del `NOTIFY pgrst`): si existe, las tres están
aplicadas. La usa `escanerAplicado()` (3.1).

#### 1.3.11 Diagnóstico de migraciones

`supabase/pruebas/estado_migraciones_octubre.sql` (SQL) añade tres filas, una por migración:
`20261028100000` → `to_regclass('public.textil_referencias_proveedor') IS NOT NULL`;
`20261028100100` → existe `escaner_textil_migrar_datos()`; `20261028100200` → existe
`escaner_textil_version()`. Javier lo usa para comprobar que entraron las tres.

### 1.4 Errores (mensaje exacto, en castellano)

`%` se sustituye por el dato. Código entre paréntesis.

| Id       | Mensaje                                                                                                                                                        | Código             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| E-CAB-1  | `La factura % ya está registrada y no se borra. Si sobra, avisa: se corrige con una rectificativa del proveedor o, si es textil, con un ajuste de inventario.` | restrict_violation |
| E-CAB-2  | `La factura % ya está registrada: no vuelve a borrador.`                                                                                                       | restrict_violation |
| E-CAB-3  | `La factura % ya está registrada: «%» no se puede cambiar.`                                                                                                    | restrict_violation |
| E-CAB-4  | `La compra textil % movió stock y no se borra: para corregir, haz un ajuste de inventario.`                                                                    | restrict_violation |
| E-CAB-5  | `Una factura borrada no vuelve a contar.`                                                                                                                      | restrict_violation |
| E-CAB-6  | `Una compra se registra desde su revisión, no cambiando su estado a mano.`                                                                                     | restrict_violation |
| E-STK-1  | `El coste medio no se escribe a mano: lo calcula el libro de movimientos. Para corregirlo, anota un ajuste de inventario.`                                     | restrict_violation |
| E-STK-2  | `Las entradas por compra solo las anota el registro de su factura (Textil › Compras).`                                                                         | restrict_violation |
| E-STK-3  | `Una variante nace sin existencias y sin coste: las unidades entran con su factura (Textil › Compras) o con un ajuste de inventario.`                          | restrict_violation |
| E-STK-4  | `Esta variante tiene % unidades: para retirarla, anota antes una merma o un ajuste de inventario que la deje a 0, o fusiónala con la buena.`                   | restrict_violation |
| E-REG-1  | `Sin usuario: la compra necesita un autor.`                                                                                                                    | 22023              |
| E-REG-2  | `Sin acceso a esta empresa.`                                                                                                                                   | 42501              |
| E-REG-3  | `La compra no existe.`                                                                                                                                         | P0002              |
| E-REG-4  | `La compra % ya estaba registrada.`                                                                                                                            | restrict_violation |
| E-REG-5  | `Falta la fecha de la factura: sin ella no se sabe en qué periodo cuenta.`                                                                                     | 22023              |
| E-REG-6  | `El proveedor elegido no es de esta empresa.`                                                                                                                  | 42501              |
| E-REG-7  | `Falta el proveedor (nombre o NIF): en textil, la memoria del escáner y los pagos se apuntan a él.`                                                            | 22023              |
| E-REG-8  | `Una factura textil necesita al menos una línea de artículo.`                                                                                                  | 22023              |
| E-REG-9  | `Línea %: un artículo no puede tener importe negativo; si es un abono o un descuento, márcala como descuento.`                                                 | 22023              |
| E-REG-10 | `Línea %: las unidades de una prenda tienen que ser enteras y mayores que cero (% × % = %).`                                                                   | 22023              |
| E-REG-11 | `Línea %: falta el coste de entrada. Vuelve a abrir la revisión y regístrala otra vez.`                                                                        | 22023              |
| E-REG-12 | `Línea %: % unidades a % no dan % de coste de entrada.`                                                                                                        | 22023              |
| E-REG-13 | `Línea %: un porte no puede ser negativo ni un descuento positivo.`                                                                                            | 22023              |
| E-REG-14 | `Las líneas suman % y la base dice %: falta o sobra una línea (porte, descuento…) o hay un importe mal leído.`                                                 | 22023              |
| E-REG-15 | `El coste de entrada suma % y la base es %: tienen que cuadrar al céntimo.`                                                                                    | 22023              |
| E-REG-16 | `Línea %: la variante no es de esta empresa.`                                                                                                                  | 42501              |
| E-REG-17 | `Línea %: la variante está desactivada. Elige otra o reactívala en Stock.`                                                                                     | restrict_violation |
| E-REG-18 | `Línea %: la variante está repetida. Usa la buena o fusiónalas en Stock.`                                                                                      | restrict_violation |
| E-REG-19 | `Línea %: el EAN % ya lo tiene otra variante.`                                                                                                                 | unique_violation   |
| E-REG-20 | `Línea %: falta la variante del catálogo. Elige una o crea una nueva.`                                                                                         | restrict_violation |
| E-REG-21 | `Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.`                                                                     | unique_violation   |
| E-REG-22 | `Esta compra tiene portes, descuentos u otros cargos: regístrala desde la revisión de Textil › Compras para repartirlos.`                                      | restrict_violation |
| E-REG-23 | `La fecha de la factura (%) es posterior a hoy: revisa que esté bien leída.`                                                                                   | 22023              |
| E-REG-25 | `El NIF de la factura (%) no es el del proveedor elegido (%). Vuelve a elegir el proveedor.`                                                                   | 22023              |
| E-REG-26 | `Línea %: la referencia % ya es del producto %; elígelo o cambia la referencia.`                                                                               | unique_violation   |
| E-FUS-1  | `No se fusiona una variante consigo misma.`                                                                                                                    | 22023              |
| E-FUS-2  | `Las dos variantes tienen que ser de la misma empresa.`                                                                                                        | 42501              |
| E-FUS-3  | `La variante de destino tiene que estar activa y no repetida.`                                                                                                 | restrict_violation |

### 1.5 Cómo deshacerlo

Tres ficheros en `supabase/reversiones/`, **en orden inverso**, cada uno en `BEGIN … COMMIT`.
Solo con autorización expresa de Javier (borran tablas y columnas).

1. `supabase/reversiones/20261028100200_escaner_textil_reglas.sql`: quita
   `escaner_textil_version()`, `textil_compra_guardar_y_registrar(jsonb, uuid)`,
   `textil_stock_fusionar(uuid, uuid, uuid)`, los triggers y funciones de 1.3.1, 1.3.2 y 1.3.6
   y el trigger `textil_stock_mov_compra_solo_registro` con su función (1.3.4),
   los índices `textil_stock_variante_unica` y `textil_stock_ean_unico`, el `NOT NULL` de
   `producto_id` y las tres CHECK de 1.3.5. Repone **copiadas tal cual**
   `stock_aplicar_movimiento()` y `stock_cantidad_solo_por_movimiento()` de
   `20260903200000_stock_movimientos.sql` y `textil_compra_registrar(uuid)` de
   `20261013100000_compras_generales.sql`. No toca datos.
2. `supabase/reversiones/20261028100100_escaner_textil_datos.sql`: deshace solo lo de la
   migración de datos: `producto_id = NULL` en las variantes de productos `origen =
'migracion'`, `repetida = false`, `proveedor_id = NULL` en compras de proveedores `origen =
'migracion'`, borra la memoria `origen = 'migracion'`, los productos `origen = 'migracion'` y
   los proveedores `origen = 'migracion'` que ya no use ninguna compra (los que use alguna
   registrada con el escáner se quedan y se dice con `NOTICE`). Quita
   `escaner_textil_migrar_datos()`.
3. `supabase/reversiones/20261028100000_escaner_textil_esquema.sql`: repone las políticas
   `USING (true)` de `textil_compras` y `textil_compra_lineas` copiadas de
   `20260903260000_compras_textil.sql`; quita las columnas nuevas (1.1.4 con `fusionada_en`,
   1.1.6, 1.1.7, 1.1.8) **antes** que las funciones de 1.1.1 de las que dependen sus columnas
   generadas, la CHECK `stock_linea_con_compra`, la restricción `compra_linea_id_compra`, las
   tablas `textil_referencias_proveedor`,
   `textil_productos` y `proveedores` y las cuatro funciones de 1.1.1.

Cada reversión termina con `NOTIFY pgrst, 'reload schema';` (dentro de su `BEGIN … COMMIT`).

Qué se pierde al revertir: el catálogo de productos y proveedores, la memoria, el tipo, la
referencia, el color, la talla y el EAN de las líneas, el enlace movimiento → compra, la fecha
de los movimientos y el coste congelado de las líneas de presupuesto y pedido. Qué **no** se
pierde: las unidades y el coste medio del stock, los movimientos y las compras registradas.

---

## 2. Dominio puro (`src/dominio/`)

Todo sin red ni base de datos, con pruebas `vitest` en `<fichero>.test.ts`. Se importa solo de
otros módulos de dominio (`importes.ts`, `fecha-documento.ts`, `compras.ts`, `margen.ts`…), con
rutas relativas como el resto de `src/dominio/`. Nombres de funciones y tipos **exactos**: los
usan los otros equipos.

**Errores del dominio, sin formatear.** El dominio no formatea números (CLAUDE.md: el formato
solo con `src/lib/format.ts`, y hoy ningún módulo de `src/dominio/` importa de `src/lib/`). Por
eso los errores de 2.3 y 2.10 no llevan texto: llevan `codigo` (el id de 1.4) y `datos`
(números y textos crudos), con el tipo `ErrorEscaner` de 2.1. El texto lo compone
`mensajeErrorEscaner` (3.1) con `src/lib/format.ts`, con los mismos textos de la tabla 1.4.
Desaparece el `numeroEs` interno que proponía 2.3.

### 2.1 `tipos-textil.ts` (nuevo, se entrega primero, tal cual)

```ts
/**
 * Tipos compartidos del escáner textil, el catálogo y el almacén. Los usan el
 * dominio, el servidor, la interfaz y las cuentas: si cambia uno, cambia en
 * docs/escaner-textil/contrato.md en el mismo commit.
 */

export const TIPOS_LINEA_COMPRA = ["articulo", "porte", "descuento", "otro"] as const;
export type TipoLineaCompra = (typeof TIPOS_LINEA_COMPRA)[number];
export const ETIQUETAS_TIPO_LINEA: Record<TipoLineaCompra, string> = {
  articulo: "Artículo",
  porte: "Porte",
  descuento: "Descuento",
  otro: "Otro cargo",
};

export const MOTIVOS_STOCK = [
  "inicial",
  "compra",
  "venta",
  "devolucion_cliente",
  "devolucion_proveedor",
  "ajuste_inventario",
  "merma",
] as const;
export type MotivoStock = (typeof MOTIVOS_STOCK)[number];

export const METODOS_CASADO = [
  "memoria",
  "ean",
  "referencia",
  "sugerencia",
  "manual",
  "nueva",
] as const;
export type MetodoCasado = (typeof METODOS_CASADO)[number];

export type Proveedor = { id: string; nombre: string; nif: string | null; activo: boolean };

export type ProductoTextil = {
  id: string;
  marca: string | null;
  referencia: string | null;
  nombre: string;
  categoria: string | null;
  activo: boolean;
};

/** Una variante de textil_stock lista para casar, elegir o valorar. */
export type VarianteCatalogo = {
  id: string;
  producto_id: string | null;
  producto: ProductoTextil | null;
  nombre: string;
  sku: string | null;
  ean: string | null;
  color: string | null;
  talla: string | null;
  categoria: string | null;
  /** Físico. */
  cantidad: number;
  cantidad_reservada: number;
  cantidad_minima: number;
  coste_unitario: number;
  precio_venta: number;
  activa: boolean;
  repetida: boolean;
};

export type EntradaMemoria = {
  id: string;
  clave: string;
  stock_id: string;
  unidades_por_pack: number;
  veces: number;
};

/** Lo que hace falta de una línea de factura para casarla. */
export type LineaParaCasar = {
  tipo: TipoLineaCompra;
  descripcion: string;
  referencia: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
};

export type Sugerencia = { stock_id: string; puntos: number; motivo: string };

export type Casado =
  | {
      estado: "casada";
      stock_id: string;
      metodo: "memoria" | "ean" | "referencia";
      /** El pack que aprendió la memoria; nulo si no viene de ella. */
      unidades_por_pack: number | null;
    }
  | { estado: "sugerida"; sugerencias: Sugerencia[] }
  | { estado: "sin_casar" }
  | { estado: "no_aplica" };

/** Variante que se crea al registrar la compra. */
export type NuevaVariante = {
  /** Producto existente; si es nulo, se busca o se crea con `producto`. */
  producto_id: string | null;
  producto: {
    marca: string | null;
    referencia: string | null;
    nombre: string;
    categoria: string | null;
  } | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
  sku: string | null;
  /** Lo pone Javier. 0 si todavía no. */
  precio_venta: number;
  cantidad_minima: number;
};

/** Una línea tal como la recibe textil_compra_guardar_y_registrar. */
export type LineaRegistro = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  unidad: string | null;
  tipo: TipoLineaCompra;
  referencia: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  ean: string | null;
  unidades_por_pack: number;
  stock_id: string | null;
  nueva_variante: NuevaVariante | null;
  casado_metodo: MetodoCasado | null;
  /** Solo artículos de compras textil (los calcula repartirCostes). */
  unidades_stock: number | null;
  coste_total_entrada: number | null;
  coste_unitario_entrada: number | null;
};

/** El JSON `_compra` de textil_compra_guardar_y_registrar. */
export type RegistroCompra = {
  id: string | null;
  empresa_id: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  nif_proveedor: string | null;
  numero: string | null;
  fecha: string | null;
  base: number;
  iva: number;
  irpf: number;
  total: number;
  categoria: string;
  gasto_id: string | null;
  tipo_iva: number | null;
  tipo_irpf: number | null;
  liquido_origen: "calculado" | "factura" | null;
  nota_descuadre: string | null;
  concepto: string | null;
  forma_pago: string | null;
  notas: string | null;
  lectura_ia: unknown;
  lineas: LineaRegistro[];
};

export type ResultadoRegistro = {
  id: string;
  movidas: number;
  variantes_creadas: number;
  aprendidas: number;
  proveedor_id: string | null;
  proveedor_nuevo: boolean;
};

/** Una línea de presupuesto o pedido textil en pantalla. */
export type LineaDocumentoTextil = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct: number;
  stock_id?: string | null;
  /** El coste congelado que trae la línea guardada; solo para enseñar. */
  coste_unit_snapshot?: number | null;
};

export type Partida = { unidades: number; valor: number };

/** Los ids de la tabla 1.4 que puede dar también el dominio. */
export type CodigoErrorEscaner =
  | "E-REG-8"
  | "E-REG-9"
  | "E-REG-10"
  | "E-REG-13" // porte negativo o descuento positivo (como la base)
  | "E-REG-14"
  | "E-REP-1" // «Línea %: el descuento deja el artículo en negativo; revisa el descuento.»
  | "E-EAN-1"; // «Línea %: el EAN % no es válido.»

/** Un error del dominio, sin texto: el texto lo pone mensajeErrorEscaner (3.1). */
export type ErrorEscaner = {
  /** Posición (0…n−1) de la línea; null si es de la factura entera. */
  linea: number | null;
  codigo: CodigoErrorEscaner;
  /** Los números y textos que van en el mensaje, en crudo y en orden. */
  datos: (number | string)[];
};
```

### 2.2 `normalizar-textil.ts` (nuevo)

```ts
export function claveTexto(t: string | null | undefined): string; // = textil_clave
export function claveTalla(t: string | null | undefined): string; // = textil_clave_talla
/** = nif_clave. NO se llama normalizarNif: ese nombre ya existe en src/dominio/clientes.ts
 *  con otra regla (no quita el prefijo ES); dos funciones iguales de nombre y distintas de
 *  efecto acaban importándose la que no es. */
export function claveNif(t: string | null | undefined): string;
export function claveMemoria(l: {
  referencia: string | null | undefined;
  color: string | null | undefined;
  talla: string | null | undefined;
  descripcion: string | null | undefined;
}): string; // = textil_clave_memoria
/** La clave de solo descripción ("d:" + claveTexto(descripción)); "" si no hay. Es la forma de
 *  la memoria migrada y el segundo intento del casado (2.4). */
export function claveMemoriaDescripcion(descripcion: string | null | undefined): string;
/** Solo cifras; null si queda vacío. No valida. */
export function cifrasEan(t: string | null | undefined): string | null;
/** GTIN-8/12/13/14 con dígito de control correcto, en forma canónica: un UPC-A de 12 cifras
 *  pasa a EAN-13 con un 0 delante y un GTIN-14 que empieza por 0 pierde ese 0 (es el mismo
 *  artículo y el dígito de control no cambia). Devuelve 8, 13 o 14 cifras; si no vale, null. */
export function normalizarEan(t: string | null | undefined): string | null;
export function eanValido(t: string | null | undefined): boolean;
/** Tipo de línea: el que diga la IA si es válido; si no, importe < 0 → descuento;
 *  /\b(portes?|transporte|env[ií]o|gastos de env[ií]o|shipping)\b/i → porte; si no, articulo. */
export function tipoDeLinea(
  tipoLeido: unknown,
  descripcion: string,
  importe: number,
): TipoLineaCompra;
/** «pack 5», «pack de 5», «caja 10», «lote de 12», «bolsa 5», «5 uds/pack», «10 uds por caja». null si no. */
export function packDesdeTexto(descripcion: string | null | undefined): number | null;
/** Palabras para comparar: claveTexto por palabra, sin vacías ni STOPWORDS. */
export function palabras(t: string | null | undefined): string[];
export const STOPWORDS: readonly string[]; // de, del, la, el, los, las, con, sin, y, en, para, por, talla, color, ud, uds
```

Implementación de las claves: el mismo mapa de 48 caracteres de 1.1.1 (constante
`ACENTOS = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ"` y
`SIN_ACENTOS = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC"`, carácter a carácter),
después `/[^A-Za-z0-9]/g → ""`, después `toLowerCase()` o `toUpperCase()`. **No** usar
`normalize("NFD")`.

**Vectores compartidos con la prueba SQL** (los dos lados tienen que dar exactamente esto):

| Función      | Entrada                                                                   | Salida                              |
| ------------ | ------------------------------------------------------------------------- | ----------------------------------- |
| claveTexto   | `"  Camiseta Básica  Ñandú "`                                             | `"camisetabasicanandu"`             |
| claveTexto   | `null`                                                                    | `""`                                |
| claveTexto   | `"B&C #E190"`                                                             | `"bce190"`                          |
| claveTalla   | `"xxl"`                                                                   | `"2XL"`                             |
| claveTalla   | `"Talla M"`                                                               | `"M"`                               |
| claveTalla   | `"3-4 años"`                                                              | `"34"`                              |
| claveTalla   | `"T.U."`                                                                  | `"UNICA"`                           |
| claveTalla   | `"One Size"`                                                              | `"UNICA"`                           |
| claveTalla   | `"Única"`                                                                 | `"UNICA"`                           |
| claveTalla   | `"XXXL"`                                                                  | `"3XL"`                             |
| claveTalla   | `"2XL"`                                                                   | `"2XL"`                             |
| claveTalla   | `null`                                                                    | `""`                                |
| claveNif     | `"es-b12.345.678"`                                                        | `"B12345678"`                       |
| claveNif     | `"B-12345678"`                                                            | `"B12345678"`                       |
| claveNif     | `" 12345678z "`                                                           | `"12345678Z"`                       |
| claveNif     | `"ESX1234567L"`                                                           | `"X1234567L"`                       |
| claveNif     | `null`                                                                    | `""`                                |
| claveMemoria | ref `"5000"`, color `"Black"`, talla `"XXL"`, desc `"Camiseta"`           | `"r:5000\|black\|2XL"`              |
| claveMemoria | ref `null`, color `"Negro"`, talla `"L"`, desc `"Camiseta Heavy Negro L"` | `"d:camisetaheavynegrol\|negro\|L"` |
| claveMemoria | ref `null`, color `null`, talla `null`, desc `"Camiseta Heavy Negro L"`   | `"d:camisetaheavynegrol"`           |
| claveMemoria | ref `null`, color `null`, talla `"M"`, desc `"Sudadera"`                  | `"d:sudadera\|\|M"`                 |
| claveMemoria | todo vacío                                                                | `""`                                |

Pruebas de `normalizar-textil.test.ts`: la tabla entera; EAN `4006381333931` y `96385074`
válidos, `4006381333932` no; `"4006 3813 3393 1"` → `"4006381333931"`; UPC-A `"036000291452"` →
`"0036000291452"` y GTIN-14 `"00036000291452"` → `"0036000291452"`; `tipoDeLinea` con tipo
de la IA, con importe negativo, con «Portes» y con una camiseta; `packDesdeTexto` con los siete
patrones y con «Camiseta 5000» (→ null); `palabras` quita las STOPWORDS.

### 2.3 `reparto-compra.ts` (nuevo)

```ts
export const DECIMALES_COSTE_ENTRADA = 8;
export type LineaParaRepartir = {
  tipo: TipoLineaCompra;
  cantidad: number;
  unidades_por_pack: number;
  importe: number;
};
export type CosteEntrada = {
  /** Posición de la línea en el array original. */
  indice: number;
  unidades: number;
  importe: number;
  /** Lo que le toca de portes, descuentos, otros cargos y redondeo (con signo). */
  repartido: number;
  coste_total: number;
  coste_unitario: number;
};
export type ResultadoReparto =
  | {
      ok: true;
      entradas: CosteEntrada[];
      base: number;
      sumaLineas: number;
      aRepartir: number;
      criterio: "importe" | "unidades";
    }
  | { ok: false; errores: ErrorEscaner[] };
export function unidadesDeLinea(cantidad: number, unidadesPorPack: number): number;
export function repartirCostes(
  lineas: readonly LineaParaRepartir[],
  base: number,
): ResultadoReparto;
/** Aplica el reparto a las líneas de registro (rellena unidades_stock y coste_*; null en lo que no es artículo). */
export function conCostesDeEntrada(
  lineas: readonly LineaRegistro[],
  base: number,
): { ok: true; lineas: LineaRegistro[] } | { ok: false; errores: ErrorEscaner[] };
```

Algoritmo, todo en céntimos enteros:

1. Artículos = líneas `articulo`. Ninguno → `{ linea: null, codigo: "E-REG-8", datos: [] }`.
2. Cada artículo: `importe < 0` → `E-REG-9`; `unidades = redondear(cantidad ×
unidades_por_pack, 6)` no entera o ≤ 0 → `E-REG-10` con `datos: [cantidad, unidades_por_pack, unidades]`.
3. `baseC = round(base × 100)`, `sumaC = Σ round(importe × 100)` de todas las líneas;
   `|baseC − sumaC| > 2` → `E-REG-14` con `datos: [sumaC / 100, baseC / 100]`.
4. `Sa = Σ` céntimos de los artículos; `R = baseC − Sa` (portes + descuentos + otros + redondeo).
5. Pesos `w_i` = céntimos del artículo si `Sa > 0` (`criterio "importe"`); si `Sa = 0`, sus
   unidades (`criterio "unidades"`).
6. Mayor resto sobre `|R|`: `parte_i = floor(|R| × w_i / W)`; lo que falta (`|R| − Σ parte_i`)
   se reparte de céntimo en céntimo a los de mayor resto (`|R| × w_i mod W`); empate: mayor
   `w_i`, luego menor `indice`. Se aplica el signo de `R`.
7. `coste_total_i = (céntimos_i + parte_i) / 100`; si < 0 → `E-REP-1` («Línea N: el descuento deja
   el artículo en negativo; revisa el descuento.»).
8. `coste_unitario_i = redondear(coste_total_i / unidades_i, DECIMALES_COSTE_ENTRADA)`.
9. Garantiza `Σ coste_total = base` en céntimos (I1) y `|unidades × coste_unitario −
coste_total| < 0,005`.

Los errores van sin texto (`ErrorEscaner`, 2.1); el texto, el de 1.4, lo pone
`mensajeErrorEscaner` (3.1). Las pruebas comprueban `codigo`, `linea` y `datos`.

Pruebas obligatorias:

- R1: artículos 60,00 € (6 uds) y 40,00 € (2 packs × 2 = 4 uds), porte 10,00, descuento −5,00,
  base 105,00 → repartido 3,00 y 2,00; costes totales 63,00 y 42,00; unitarios 10,5 y 10,5.
- R2: tres artículos de 10,00 y porte 1,00 → 10,34 / 10,33 / 10,33 (el céntimo al primero).
- R3: artículos 10,00 y 20,00, descuento −1,00 → 9,67 y 19,33.
- R4: base 0,01 por encima de las líneas → se reparte y Σ = base.
- R5: base 0,50 por encima → error `E-REG-14`.
- R6: sin artículos → error. R7: artículo negativo → error. R8: 1,5 unidades → error.
- R9: artículos a 0 € con porte 5,00 → criterio «unidades».
- R10: descuento mayor que los artículos → error.
- R11: 200 repartos aleatorios (semilla fija): Σ coste_total = base al céntimo y la tolerancia
  por línea se cumple.

### 2.4 `casado-textil.ts` (nuevo)

```ts
export const PUNTOS_MINIMOS_SUGERENCIA = 40;
export const MAX_SUGERENCIAS = 3;
export const SINONIMOS_COLOR: readonly (readonly string[])[];
export type ContextoCasado = {
  variantes: readonly VarianteCatalogo[];
  memoria: readonly EntradaMemoria[];
};
export function mismoColor(a: string | null | undefined, b: string | null | undefined): boolean;
export function casarLinea(linea: LineaParaCasar, ctx: ContextoCasado): Casado;
export function casarLineas(lineas: readonly LineaParaCasar[], ctx: ContextoCasado): Casado[];
export function puntosParecido(
  linea: LineaParaCasar,
  v: VarianteCatalogo,
): { puntos: number; motivo: string };
/** Producto existente con la misma marca y referencia (claves); si no, null. */
export function productoParaLinea(
  linea: LineaParaCasar,
  productos: readonly ProductoTextil[],
): ProductoTextil | null;
/** Nombre de producto propuesto: el modelo; si no hay, la descripción sin color, talla, marca ni referencia. */
export function nombreProductoDesdeLinea(linea: LineaParaCasar): string;
/** Propuesta de variante nueva prerrellenada desde la línea (precio_venta 0, cantidad_minima 0). */
export function nuevaVarianteDesdeLinea(
  linea: LineaParaCasar,
  productos: readonly ProductoTextil[],
): NuevaVariante;
```

`SINONIMOS_COLOR` (claves ya normalizadas): `[negro, black, noir]`, `[blanco, white, blanc]`,
`[rojo, red]`, `[azulmarino, marino, navy, navyblue]`, `[azul, blue, royal, royalblue]`,
`[gris, grey, gray]`, `[verde, green]`, `[amarillo, yellow]`, `[naranja, orange]`,
`[rosa, pink]`, `[morado, purple, violeta]`, `[marron, brown]`, `[beige, sand, arena]`. Solo se
usan para comparar; la base guarda `textil_clave(color)` sin traducir.

Orden de `casarLinea` (solo variantes `activa && !repetida`):

1. `tipo !== "articulo"` → `no_aplica`.
2. **Memoria**: `claveMemoria(linea)` no vacía y entrada con esa clave cuya variante es
   utilizable → `casada / memoria` con su `unidades_por_pack`. Si no hay entrada, la línea no
   trae referencia y `claveMemoriaDescripcion(descripcion)` tiene entrada (memoria migrada),
   vale **solo si** la variante es compatible con lo que trae la línea: si la línea trae color,
   `mismoColor`; si trae talla, `claveTalla` igual. Si apunta a una variante inactiva o
   repetida, o no es compatible, se sigue con el paso siguiente.
3. **EAN**: `normalizarEan(linea.ean)` válido y una variante con ese `ean` → `casada / ean`.
4. **Referencia**: `claveTexto(referencia)` no vacía y: **exactamente una** variante con
   `claveTexto(sku)` igual y compatible en color y talla (como en el paso 2) → `casada /
referencia` (un SKU puesto a nivel de modelo, «5000», no puede mandar todas las tallas a la
   misma variante); si no, variantes cuyo `claveTexto(producto.referencia)` coincide y además
   `mismoColor` y `claveTalla` iguales: exactamente una → `casada / referencia`; más de una →
   `sugerida` con ellas.

**Veto por EAN** (pasos 2 y 4): si la línea trae un EAN válido y la variante propuesta tiene
**otro** EAN, esa propuesta no vale (el casado es de otra prenda) y se sigue con el paso
siguiente. El EAN de la factura manda sobre la memoria y la referencia. 5. **Parecido** (solo sugerencia, nunca casa sola): `puntos = round(60 × jaccard(palabras de
descripción + marca + modelo + referencia, palabras de producto.marca + producto.referencia +
producto.nombre + nombre + sku)) + (mismoColor ? 20 : 0) + (tallas iguales ? 20 : 0)`;
candidatas con `jaccard > 0` y `puntos ≥ 40`, de más a menos puntos (empate por etiqueta),
máximo 3 → `sugerida`; ninguna → `sin_casar`.

Pruebas: memoria gana a EAN; memoria a variante inactiva cae a EAN; memoria vetada por un EAN
distinto cae a EAN; memoria migrada (`d:` sin color ni talla) solo casa si color y talla
cuadran; SKU repetido en dos variantes no casa; EAN; referencia por SKU;
referencia + «Black»/«Negro» + «XXL»/«2XL»; referencia ambigua → sugerida; parecido nunca da
`casada`; porte → `no_aplica`; repetidas nunca salen; `productoParaLinea` por marca+referencia;
`nombreProductoDesdeLinea("Camiseta Gildan 5000 Negro XL", color Negro, talla XL, marca Gildan,
ref 5000)` → `"Camiseta"`; `nuevaVarianteDesdeLinea` usa el producto existente si lo hay.

### 2.5 `stock-textil.ts` (nuevo)

```ts
export const ORDEN_TALLAS: readonly string[]; // ["3XS","2XS","XS","S","M","L","XL","2XL","3XL","4XL","5XL"]
/** Conocidas por ORDEN_TALLAS; luego números ascendentes; luego "UNICA"; luego el resto alfabético; vacías al final. */
export function compararTallas(a: string | null | undefined, b: string | null | undefined): number;
/** Una fila de listStock (con o sin producto anidado, con o sin migración) → VarianteCatalogo. */
export function aVarianteCatalogo(fila: Record<string, unknown>): VarianteCatalogo;
/** [marca, nombre, color, talla] sin vacíos, unidos con " · ". */
export function etiquetaVariante(v: VarianteCatalogo): string;
export function disponible(
  v: Pick<VarianteCatalogo, "cantidad" | "cantidad_reservada">,
  reservadoPropio?: number,
): number;
export type GrupoProducto = {
  clave: string; // producto_id, o "n:" + claveTexto(nombre) sin migración
  producto_id: string | null;
  marca: string | null;
  referencia: string | null;
  nombre: string;
  variantes: VarianteCatalogo[];
  fisico: number;
  reservado: number;
  disponible: number;
};
export function agruparPorProducto(
  variantes: readonly VarianteCatalogo[],
  opciones?: { incluirInactivas?: boolean },
): GrupoProducto[];
/** Por marca, referencia, nombre, SKU o color (claveTexto contiene); un EAN válido exacto pone su producto primero. */
export function buscarProductos(grupos: readonly GrupoProducto[], texto: string): GrupoProducto[];
export type CeldaRejilla = {
  variante: VarianteCatalogo;
  fisico: number;
  reservado: number;
  disponible: number;
};
export type Rejilla = {
  grupo: GrupoProducto;
  colores: { clave: string; etiqueta: string }[]; // "" → "Sin color"
  tallas: { clave: string; etiqueta: string }[]; // ordenadas con compararTallas; "" → "Sin talla"
  celdas: (CeldaRejilla | null)[][]; // [color][talla]; null si no existe esa variante
};
export function rejillaProducto(
  grupo: GrupoProducto,
  reservadoPropio?: ReadonlyMap<string, number>,
): Rejilla;
/** Lo que reserva un pedido que se está editando, por variante (de sus líneas guardadas). */
export function reservadoPorVariante(
  items: readonly { stock_id?: string | null; cantidad: number | string }[],
): Map<string, number>;
/** Una línea por variante: etiqueta, cantidad (1 o la dada), precio_venta si > 0 (si no 0), IVA 21 (IVA_GENERAL), stock_id. */
export function lineasDesdeStock(
  variantes: readonly VarianteCatalogo[],
  cantidades?: ReadonlyMap<string, number>,
): LineaDocumentoTextil[];
export type MargenPrevisto = {
  base: number; // base de las líneas con coste conocido
  coste: number;
  margen: number;
  porcentaje: number | null; // porcentajeMargen(margen, base) de margen.ts (un decimal; null si base 0): no se reescribe
  lineasSinCoste: number;
  baseSinCoste: number;
};
/** coste_unitario por línea: el congelado si lo tiene; si no, el de la variante; null o 0 = sin coste. */
export function margenPrevisto(
  lineas: readonly { cantidad: number; precio_unitario: number; coste_unitario: number | null }[],
): MargenPrevisto;
```

Pruebas: orden de tallas (`["XL","S","2XL","M","38","36","UNICA",""]` →
`["S","M","XL","2XL","36","38","UNICA",""]`); `aVarianteCatalogo` con fila vieja sin
`producto`/`ean`/`repetida`; disponible con y sin reservado propio; agrupar sin migración por
nombre; buscar por EAN, marca y referencia; rejilla con huecos; `lineasDesdeStock` con precio 0;
`margenPrevisto` con líneas sin coste.

### 2.6 `precio-recomendado.ts` (nuevo)

```ts
export const MIN_MUESTRAS_CATALOGO = 3;
export type Recomendacion = {
  precio: number; // redondear(coste × ratio, 2)
  ratio: number; // redondear(mediana, 4)
  fuente: "producto" | "catalogo";
  muestras: number;
};
export function mediana(valores: readonly number[]): number | null;
export function precioRecomendado(
  objetivo: { id?: string | null; producto_id: string | null; coste_unitario: number },
  catalogo: readonly Pick<
    VarianteCatalogo,
    "id" | "producto_id" | "coste_unitario" | "precio_venta" | "activa" | "repetida"
  >[],
): Recomendacion | null;
```

Reglas: `coste_unitario ≤ 0` → `null`. Muestras = activas, no repetidas, distintas del
objetivo, con `coste > 0` y `precio_venta > 0`. Si hay al menos una del mismo `producto_id`
(no nulo) → mediana de `precio/coste` de esas, `fuente "producto"`. Si no, con al menos
`MIN_MUESTRAS_CATALOGO` muestras → mediana de todas, `fuente "catalogo"`. Si no, `null`. Sin
redondeos «comerciales».

Pruebas: mismo producto; caída al catálogo; menos de 3 → null; coste 0 → null; excluye
inactivas, repetidas, la propia y las de precio 0; mediana par = media de las dos centrales;
redondeo al céntimo.

### 2.7 `cuenta-almacen.ts` (nuevo)

```ts
export type MovimientoAlmacen = {
  fecha?: string | null; // YYYY-MM-DD
  created_at?: string | null; // ISO, para las filas sin fecha
  motivo: MotivoStock;
  cantidad: number | string;
  coste_unitario: number | string;
  stock_id?: string | null;
  compra_id?: string | null;
  /** Para separar lo que ya cuesta por pedido («Coste de la ropa») de lo que no. */
  textil_pedido_id?: string | null;
};
/** fecha si la hay; si no, el día de created_at en Madrid (diaEnEspana). */
export function fechaEfectiva(m: Pick<MovimientoAlmacen, "fecha" | "created_at">): string;
/** redondear(cantidad × coste_unitario, 2), con signo (I9). */
export function valorMovimiento(m: Pick<MovimientoAlmacen, "cantidad" | "coste_unitario">): number;
/** Σ de los movimientos con fecha efectiva ≤ fecha. */
export function valorAFecha(movs: readonly MovimientoAlmacen[], fecha: string): Partida;
export type CuentaAlmacen = {
  desde: string;
  hasta: string;
  inicial: Partida; // todo lo anterior a `desde`
  compras: Partida; // motivo compra en el periodo
  altas: Partida; // motivo inicial en el periodo
  devolucionesCliente: Partida;
  ventas: Partida; // en positivo: lo que sale
  mermas: Partida; // en positivo
  devolucionesProveedor: Partida; // en positivo
  ajustes: Partida; // con signo: + entra, − sale
  final: Partida; // todo hasta `hasta`
  /**
   * Lo que cuesta en Resultados y no cuesta ya por pedido: −Σ valorMovimiento de los
   * movimientos del periodo que no son `compra` ni `inicial` ni (`venta` o
   * `devolucion_cliente`) con `textil_pedido_id`. Es decir: mermas + devoluciones a
   * proveedor − ajustes − devoluciones de cliente sin pedido + ventas sin pedido.
   */
  perdidas: number;
  /** final − (inicial + compras + altas + devCli − ventas − mermas − devProv + ajustes); 0 siempre que los datos sean coherentes. */
  descuadre: Partida;
};
export function cuentaAlmacen(
  movs: readonly MovimientoAlmacen[],
  desde: string,
  hasta: string,
): CuentaAlmacen;
export function costeAlmacenPeriodo(
  movs: readonly MovimientoAlmacen[],
  desde: string,
  hasta: string,
): number;
/** Lo que necesita la página «Almacén» del informe de socios. */
export type InformeAlmacen = {
  cuenta: CuentaAlmacen;
  /** Unidades × coste medio de hoy (la caché); null si no se pudo leer. */
  valorHoy: number | null;
  controles: ResumenControles | null; // de controles-almacen.ts
  pagosProveedores: { total: number; facturas: number } | null;
};
```

Unidades: suma de `cantidad` con signo (en las partidas de salida, en positivo). Valores: suma
de `valorMovimiento` (I9), así la identidad es exacta y `descuadre` es `{0, 0}`.

Por qué `perdidas` no es solo «mermas + devoluciones a proveedor − ajustes»: una devolución de
cliente **sin pedido** (la permite «Otro movimiento», 4.5) mete valor en el almacén y no resta
en «Coste de la ropa» (que solo mira movimientos con pedido, `costePorPedido`); sin contarla
aquí, el almacén crecería sin que Resultados lo viera. Con esta definición se cumple, por
valor y en el periodo: compras + altas − (final − inicial) = coste de lo vendido con pedido +
`perdidas`. `costeAlmacenPeriodo` devuelve `perdidas`.

Pruebas: identidad con los siete motivos; inicial = lo anterior a `desde`; movimiento sin
`fecha` con `created_at = "2026-10-31T23:30:00Z"` cuenta el `2026-11-01`; `perdidas` con merma
de 2 a 4 € (+8), devolución a proveedor de 1 a 5 € (+5) y ajuste +1 a 3 € (−3) = 10; una
devolución de cliente sin pedido de 1 a 2 € resta 2 y una con pedido no cuenta;
`valorAFecha` coincide con `final` de la cuenta que termina ese día.

### 2.8 `controles-almacen.ts` (nuevo)

```ts
export type CompraControl = {
  id: string;
  numero: string | null;
  proveedor: string | null;
  fecha: string | null;
  base: number | string;
  categoria?: string | null;
  estado: string;
  borrada_en?: string | null;
};
export type EntradaControl = Pick<
  MovimientoAlmacen,
  "motivo" | "cantidad" | "coste_unitario" | "compra_id"
>;
export type FilaControlCompra = {
  compra: CompraControl;
  base: number;
  entradas: number;
  diferencia: number;
  estado: "cuadra" | "descuadre" | "sin_enlace";
};
export type ControlCompras = {
  filas: FilaControlCompra[]; // las con descuadre primero
  revisadas: number;
  descuadres: number;
  sinEnlace: number;
  diferenciaTotal: number; // Σ diferencias de las enlazadas: tiene que ser 0
};
/** Compras textil (o sin categoría) registradas y sin borrar, contra Σ valorMovimiento de sus entradas `compra`. Sin entradas enlazadas → "sin_enlace". */
export function controlComprasEntradas(
  compras: readonly CompraControl[],
  entradas: readonly EntradaControl[],
): ControlCompras;
export type ResumenControles = {
  comprasConDescuadre: number;
  diferenciaCompras: number;
  comprasSinEnlace: number;
  variantesDescuadradas: number | null; // filas de stock_descuadres(); null si no se pudo leer
  reservasDescuadradas: number | null; // filas de stock_reservas_descuadres()
  /**
   * Informativa, NO cuenta para todoEnCero: valor de la caché (Σ cantidad × coste_unitario
   * de textil_stock, redondeado por variante) − valor del libro a hoy (valorAFecha). Con
   * coste medio ponderado y todas las salidas al coste medio (1.3.4) solo la mueven los
   * redondeos y los saldos negativos (con saldo ≤ 0 la entrada manda). null sin datos.
   */
  diferenciaValorCache: number | null;
  /** descuadres 0, diferencia 0 y las dos de arriba 0. Si alguna es null (no se pudo leer),
   *  false: «no comprobado» no es «en cero». */
  todoEnCero: boolean;
};
export function resumenControles(
  c: ControlCompras | null,
  variantes: number | null,
  reservas: number | null,
  diferenciaValorCache?: number | null,
): ResumenControles;
```

Pruebas: una que cuadra, una con 0,01 de diferencia, una sin enlace (no cuenta como
descuadre), una borrada y una no textil fuera, `todoEnCero`; `todoEnCero` es `false` si
`variantes` o `reservas` son `null`; `diferenciaValorCache` no lo cambia.

### 2.9 `pagos-proveedores.ts` (nuevo)

```ts
export type CompraPendiente = {
  id: string;
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  numero: string | null;
  fecha: string | null;
  liquido?: number | string | null;
  total: number | string;
  estado: string;
  estado_pago?: string | null;
  borrada_en?: string | null;
};
export type TramoPago = {
  clave: "0-30" | "31-60" | "61-90" | "90+";
  etiqueta: string;
  facturas: number;
  importe: number;
};
export type DeudaProveedor = {
  clave: string;
  nombre: string;
  facturas: number;
  importe: number;
  masAntigua: string | null;
};
export type PagosProveedores = {
  total: number;
  facturas: number;
  porProveedor: DeudaProveedor[];
  tramos: TramoPago[];
};
/** Registradas, sin borrar y con estado_pago "pendiente"; importe = liquido ?? total; por proveedor_id, si no por claveNif(nif_proveedor), si no por claveTexto(proveedor); antigüedad desde la fecha. */
export function pagosPendientesProveedores(
  compras: readonly CompraPendiente[],
  hoy: Date,
): PagosProveedores;
```

Pruebas: filtra borradores, borradas y pagadas; agrupa dos NIF escritos distinto; tramos en
los bordes (30, 31, 60, 61, 90, 91 días); `liquido` nulo usa `total`; lista vacía → ceros.

### 2.10 Cambios en módulos que ya existen

- `factura-compra.ts`: `LineaLeida` añade, **opcionales**, `tipo?: TipoLineaCompra`,
  `referencia?`, `marca?`, `modelo?`, `color?`, `talla?`, `ean?` (`string | null`),
  `unidades_por_pack?: number` y `pack_deducido?: boolean`. `normalizarCompra`: `tipo` con
  `tipoDeLinea`; textos con `texto()`; `ean` con `cifrasEan` (la validez la avisa
  `revisarCompra`); `unidades_por_pack` = el de la IA si es entero ≥ 1, si no
  `packDesdeTexto(descripcion)` (con `pack_deducido: true`), si no 1. **Ninguna línea con
  importe distinto de 0 se pierde por su cantidad**: si la cantidad es nula, 0 **o negativa**
  (los abonos vienen a menudo como «−2 × 10,00 = −20,00»), queda `cantidad 1` y
  `precio_unitario = importe`, y si además era `articulo` con importe negativo pasa a
  `descuento`; se marca `cantidad_ajustada: true` (campo opcional nuevo de `LineaLeida`). Hoy
  esas líneas las tira el filtro `cantidad > 0` de `procesarFactura` y la base deja de cuadrar
  sin decir por qué. `revisarCompra` avisa «Línea N: el EAN X no es válido.», «Línea N: pack
  deducido del texto (X uds): compruébalo.» y «Línea N: tenía cantidad X; queda como 1 ×
  importe: compruébalo.».
  Pruebas nuevas para todo esto; las de antes siguen pasando.
- `cola-compras.ts`: `esquemaLectura.lineas[]` añade `tipo: z.enum(TIPOS_LINEA_COMPRA).nullable().optional()` y
  `referencia`, `marca`, `modelo`, `color`, `talla`, `ean`, `unidades_por_pack` como
  `texto.optional()` (string o null; si falta, null). En zod son **tolerantes** a propósito: si
  el modelo se deja una de estas claves o pone un tipo raro, no se pierde la lectura entera de
  la factura (el tipo lo decide luego `tipoDeLinea`). `ESQUEMA_LECTURA_JSON`: esas ocho claves en `required` y en `properties`
  (`tipo: { type: "string", enum: [...TIPOS_LINEA_COMPRA] }`, el resto `tOn`). Pruebas
  actualizadas.
- `compras.ts`: `lineaCompraNueva()` devuelve además `tipo: "articulo"` y
  `unidades_por_pack: 1`. Nada más.

---

## 3. Servidor

### 3.1 `src/lib/escaner-textil.ts` (nuevo, sin dependencias de servidor)

```ts
export const MIGRACION_ESCANER = "20261028100000";
export const AVISO_MIGRACION_ESCANER =
  "Faltan aplicar las migraciones 20261028100000, 20261028100100 y 20261028100200 " +
  "(escáner textil: esquema, datos y reglas), en ese orden. Hasta entonces, Textil › Compras " +
  "funciona como antes: casado a mano y sin repartir portes.";
/** true si existe escaner_textil_version(); false si falta la migración; lanza otros errores. */
export async function escanerAplicado(cliente: unknown): Promise<boolean>;
/** El texto de 1.4 para un ErrorEscaner del dominio (2.1), con los números de
 *  src/lib/format.ts («Línea 3: …», 1.234,56). Lo usan el servidor al lanzar y la interfaz. */
export function mensajeErrorEscaner(e: ErrorEscaner): string;
```

Se importa **solo** de forma estática (desde `*.functions.ts`, `gerencia.ts` y los componentes).
El aviso nombra las tres migraciones: `escanerAplicado` mira la función de la **última**, así
que con solo la primera aplicada decía «falta la 20261028100000» y no era verdad.

### 3.2 `src/lib/compras.functions.ts`

- Refactor interno: `guardarBorrador(supabase, data)` y `registrarBorrador(supabase, id)` con la
  lógica actual de `guardarCompra` y `registrarCompra`; las dos server functions viejas las
  usan y siguen igual.
- **Nueva** `guardarYRegistrarCompra` (POST). Entrada (zod, primera línea del validador):

  ```ts
  const nuevaVarianteSchema = z
    .object({
      producto_id: z.string().uuid().nullable(),
      producto: z
        .object({
          marca: z.string().nullable(),
          referencia: z.string().nullable(),
          nombre: z.string().trim().min(1),
          categoria: z.string().nullable(),
        })
        .nullable(),
      color: z.string().nullable(),
      talla: z.string().nullable(),
      ean: z.string().nullable(),
      sku: z.string().nullable(),
      precio_venta: z.number().min(0),
      cantidad_minima: z.number().min(0),
    })
    .refine((v) => v.producto_id !== null || v.producto !== null, {
      message: "La variante nueva necesita un producto: elige uno o escribe el nuevo.",
    });
  const lineaRegistroSchema = z.object({
    descripcion: z.string().trim().min(1),
    cantidad: z.number().positive(),
    precio_unitario: z.number(),
    importe: z.number(),
    unidad: z.string().nullable(),
    tipo: z.enum(TIPOS_LINEA_COMPRA),
    referencia: z.string().nullable(),
    marca: z.string().nullable(),
    modelo: z.string().nullable(),
    color: z.string().nullable(),
    talla: z.string().nullable(),
    ean: z.string().nullable(),
    unidades_por_pack: z.number().positive(),
    stock_id: z.string().uuid().nullable(),
    nueva_variante: nuevaVarianteSchema.nullable(),
    casado_metodo: z.enum(METODOS_CASADO).nullable(),
  });
  // + la cabecera de compraSchema con fecha obligatoria (/^\d{4}-\d{2}-\d{2}$/),
  //   proveedor_id: z.string().uuid().nullable() y lectura_ia: z.string().nullable()
  //   (texto JSON, como hoy: el serializador de las server functions no mueve JSON libre).
  ```

  Handler:
  1. `empresa_id = id ? null : await empresaActiva(context.supabase)`; `lectura_ia` con
     `parsearLectura` (texto → JSON o nulo) antes de montar el `RegistroCompra`.
  2. EAN de cada línea y de cada `nueva_variante` con `normalizarEan`; si venía escrito y no es
     válido: en la línea se manda `null`; en `nueva_variante` → error «Línea N: el EAN X no es
     válido.».
  3. Si `categoria === "textil"`: `conCostesDeEntrada(lineas, base)`; si no `ok`, error con
     `mensajeErrorEscaner(errores[0])`. **El reparto del servidor es el que manda**; el del
     navegador solo se enseña.
  4. `const { adminComoUsuario } = await import("@/integrations/supabase/client.server")`;
     `llamarRpcConError<ResultadoRegistro>(adminComoUsuario(context.userId),
"textil_compra_guardar_y_registrar", { _compra, _usuario_id: context.userId })`.
  5. Si `faltaLaFuncion(error)`: si es textil y alguna línea no es artículo, lleva
     `nueva_variante` o `unidades_por_pack ≠ 1` → error `AVISO_MIGRACION_ESCANER`; si no, camino
     viejo `guardarBorrador` + `registrarBorrador` (con **solo** las columnas de siempre: sin
     `proveedor_id` ni los campos nuevos de línea) y se devuelve `{ id, movidas,
variantes_creadas: 0, aprendidas: 0, proveedor_id: null, proveedor_nuevo: false, atomica:
false }`.
  6. Otro error → `throw new Error(error.message)` (los mensajes de 1.4 ya son para la persona).
     Salida: `ResultadoRegistro & { atomica: boolean }`.

- `subirFacturaRecibida`: acepta en el `FormData` el campo opcional `categoria` (solo
  `"textil"`; otro valor → error). Con él, la fila nace con `categoria: "textil"` y se llama a
  `procesarFactura(…, { categoria: "textil" })`.
- `listCompras`: devuelve además `escaner: boolean` (`escanerAplicado(context.supabase)`). El
  `select` de las líneas pasa a `"*, lineas:textil_compra_lineas!compra_id(*)"` (pista por
  columna; vale con y sin la migración). Con la migración, `textil_stock_movimientos` tiene FK a
  `textil_compras` **y** a `textil_compra_lineas`: según la versión de PostgREST puede verla
  como tabla puente y responder `PGRST201` («more than one relationship») al incrustar sin
  pista, y la lista de compras dejaría de cargar.
- **Todas** las pantallas registran con `guardarYRegistrarCompra`, también `RevisarCompra`
  (categorías no textil, y textil sin la migración): mapea cada línea con `tipo: l.tipo ??
"articulo"`, `referencia`/`marca`/`modelo`/`color`/`talla`/`ean` de la lectura o `null`,
  `unidades_por_pack: l.unidades_por_pack ?? 1`, `nueva_variante: null` y `casado_metodo:
stock_id ? "manual" : null`. Las server functions `guardarCompra` y `registrarCompra` se
  quedan (compatibilidad), pero la interfaz deja de llamarlas.
- **Nueva** `guardarProveedor` (POST, en `escaner-textil.functions.ts`, 3.5).

### 3.3 `src/lib/cola-compras.server.ts`

- `procesarFactura(supabase, id, bytes, tipoMime, aviso, opciones?: { categoria?: "textil" })`.
  Con `categoria: "textil"` la categoría no la decide la IA (no sale el motivo «La IA no sabe qué
  es»).
- Al insertar las líneas, además: `tipo`, `referencia`, `marca`, `modelo`, `color`, `talla`,
  `ean`, `unidades_por_pack`. Si el insert falla con `faltaLaColumna`, se repite con las columnas
  de siempre y se añade el motivo «Falta aplicar la migración 20261028100000: se han guardado las
  líneas sin tipo, talla, color ni referencia.».
- El filtro de líneas guardables sigue siendo `descripcion && cantidad > 0` (con la
  normalización nueva, los descuentos llegan con cantidad 1 y ya no se pierden).

### 3.4 `src/lib/lector-facturas.server.ts`

`INSTRUCCIONES`: en la lista de campos, `lineas` pasa a decir «cada línea del papel con su tipo,
cantidad, unidad, precio unitario, importe y los datos de la prenda». Y se añade, antes de
«Reglas:», exactamente:

```text
En cada línea, además:
- tipo: "articulo" si es una prenda o un producto que entra en el almacén; "porte" si son portes, transporte o gastos de envío; "descuento" si es un descuento, un rappel o un abono (con importe negativo); "otro" para cualquier otro cargo (embalaje, seguro, recargo, gastos de gestión).
- referencia: el código del artículo tal como lo escribe el proveedor (referencia, código, SKU). Si no hay, null.
- marca: la marca de la prenda (Gildan, B&C, Stanley/Stella, Roly, Fruit of the Loom…), no la del proveedor. Si no aparece, null.
- modelo: el nombre del modelo de la prenda (por ejemplo «Heavy Cotton» o «Exact 190»), sin color ni talla. Si no aparece, null.
- color y talla: tal como aparecen en esa línea. Si la línea no los dice, null; no los deduzcas de otras líneas.
- ean: el código de barras (EAN o GTIN, de 8 a 14 cifras) si la línea lo trae; si no, null.
- unidades_por_pack: si la línea vende packs, cajas o lotes («pack 5», «caja de 10»), cuántas prendas lleva cada uno, tal como está escrito; si se vende por unidades, null.
- Cada línea del papel es una línea: no juntes tallas ni colores de líneas distintas ni separes una línea en varias. Si una línea lleva varias tallas juntas, déjala así y dilo en dudas.
```

### 3.5 `src/lib/escaner-textil.functions.ts` (nuevo)

Todas con `requireSupabaseAuth`, zod en la primera línea, lecturas con `context.supabase` y
`tabla()`. Tolerantes: sin la migración devuelven `disponible: false` y listas vacías.

| Función                 | Método | Entrada                                                                                                                               | Salida                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estadoEscanerTextil`   | GET    | —                                                                                                                                     | `{ aplicada: boolean }`                                                                                                                                                                                                                                                                                |
| `leerMemoriaEscaner`    | POST   | `{ proveedor_id?: uuid \| null, nif?: string \| null, proveedor?: string \| null }`                                                   | `{ disponible: boolean; proveedor: (Proveedor & { compras: number }) \| null; entradas: EntradaMemoria[] }` (resuelve por id; si no, por `nif_clave = claveNif(nif)`; si no, por `nombre_clave = claveTexto(proveedor)` con `nif_clave = ''`)                                                          |
| `olvidarMemoriaEscaner` | POST   | `{ id: uuid }`                                                                                                                        | `{ ok: true }` (DELETE con `context.supabase`)                                                                                                                                                                                                                                                         |
| `listProveedores`       | GET    | —                                                                                                                                     | `{ disponible: boolean; proveedores: Proveedor[] }`                                                                                                                                                                                                                                                    |
| `listProductosTextil`   | GET    | —                                                                                                                                     | `{ disponible: boolean; productos: ProductoTextil[] }`                                                                                                                                                                                                                                                 |
| `guardarProductoTextil` | POST   | `{ id?: uuid, marca: string \| null, referencia: string \| null, nombre: string min 1, categoria: string \| null, activo?: boolean }` | `{ id }`; `unique_violation` → «Ya existe un producto con esa marca y referencia (o ese nombre).»                                                                                                                                                                                                      |
| `fusionarVariantes`     | POST   | `{ origen: uuid, destino: uuid }`                                                                                                     | resultado de `textil_stock_fusionar` vía `adminComoUsuario(context.userId)` con `_usuario_id`; sin la función → error `AVISO_MIGRACION_ESCANER`                                                                                                                                                        |
| `guardarProveedor`      | POST   | `{ id: uuid, nombre: string min 1, nif: string \| null, activo: boolean }`                                                            | `{ ok: true }` con `context.supabase` (autor por JWT); `unique_violation` → «Ya hay otro proveedor con ese NIF (o ese nombre, sin NIF).». Sirve para corregir un NIF o un nombre mal leídos; no toca las compras (conservan el texto de su factura). Fusionar dos proveedores queda fuera (sección 8). |

### 3.6 `src/lib/textil.functions.ts`

- `listStock`: `select("*, producto:textil_productos(id, marca, referencia, nombre, categoria, activo)")`;
  si el error es `PGRST200`, `faltaLaColumna` o `faltaLaTabla`, vuelve a `select("*")`. Sigue
  devolviendo todas (activas y no); el filtro lo hace la interfaz.
- `upsertStockItem`: el esquema acepta además `producto_id: uuid nullable optional` y
  `ean: string nullable optional` (normalizado con `normalizarEan`; escrito y no válido → error
  «El EAN X no es válido.»). Al **editar** nunca manda `cantidad` ni `coste_unitario`. Si el
  `update`/`insert` falla con `faltaLaColumna`, se repite sin `producto_id` ni `ean`.
  **Al crear, la variante nace sin existencias y sin coste** (`cantidad 0`, `coste_unitario 0`,
  sin movimiento `inicial`): decisión 3, «todo entra por factura». El esquema deja de aceptar
  `cantidad` y `coste_unitario` (los ignora si llegan, para no romper un cliente viejo). Lo que
  aparezca en el almacén sin factura entra por «Recuento» (`ajuste_inventario`), que se ve en
  Resultados (5.2). Un coste escrito a mano en una variante sin historia, además, alimentaría
  el precio recomendado (2.6) con un dato inventado. `unique_violation` del EAN → «Ese EAN ya lo
  tiene otra variante.»; el de `textil_stock_variante_unica` → «Ya hay una variante activa de
  ese producto con ese color y esa talla.».
- `registrarMovimientoStock`: `motivo` ∈ {`merma`, `ajuste_inventario`, `devolucion_cliente`,
  `devolucion_proveedor`} (fuera `compra`); **sin `coste_unitario`**: siempre manda 0 y el coste
  lo pone la base (1.3.4: salidas al coste medio; devolución de cliente al de su venta o al
  medio; ajuste al alza al medio). Acepta `compra_id: uuid nullable optional` (solo con
  `devolucion_proveedor`; si la columna no existe, se manda sin él).
- `upsertPresupuesto`: **no lanza** por falta de stock. Devuelve `{ id, avisos: string[] }`
  (mismos textos que hoy: «Camiseta …: solicitado 5, disponible 3»). Para eso,
  `validarDisponibilidad` pasa a `faltantesDisponibilidad(...)`: devuelve la lista; el pedido
  sigue lanzando con ella.
- Coste congelado (si existe la columna `coste_unit_snapshot`, comprobado con un `select` de
  prueba): al reescribir las líneas de un presupuesto o pedido, cada línea nueva lleva el
  `coste_unit_snapshot` de la línea anterior con el mismo `stock_id` (si lo tenía);
  `confirmarPresupuestoTextil` copia el de cada línea del presupuesto. Si no hay anterior, se
  deja nulo y lo pone el trigger. El cliente **no** manda el coste (`itemSchema` no cambia).
  Las líneas anteriores se leen **antes** del `delete` (hoy `itemsDelPedido` solo lee
  `stock_id, cantidad`: tiene que leer también `coste_unit_snapshot` cuando la columna existe).

---

## 4. Interfaz

Sin rutas nuevas. Componentes de `src/components/ui/`. Avisos de migración con
`AVISO_MIGRACION_ESCANER`. Todo funciona en móvil (gutter 16 px, sin scroll horizontal de
página; las tablas anchas, dentro de su contenedor con scroll).

### 4.1 Textil › Compras (`PaginaCompras modo="textil"`)

- Con la cola (`data.cola`) también en textil: `SubidaFacturas categoria="textil"` (arrastrar o
  elegir varios PDF/JPG/PNG; uno detrás de otro; estados esperando/leyendo/pendiente/duplicado/
  error) y `ColaRevision` con las de la cola de textil. El botón «Subir factura» de una en una
  solo queda si no hay cola. «A mano» sigue.
- Sin la migración del escáner (`data.escaner === false`): tarjeta ámbar con
  `AVISO_MIGRACION_ESCANER` y la revisión de siempre (`RevisarCompra`, casado con el `Select`).
- Con ella, toda compra con `categoria === "textil"` (en Textil y en Compras generales) se revisa
  con **`RevisarCompraTextil`** y se registra con `guardarYRegistrarCompra`. Las demás categorías
  siguen con `RevisarCompra`, pero también registran con `guardarYRegistrarCompra` (atómico).
  Si en `RevisarCompra` se cambia la categoría **a** textil, se cierra y se abre
  `RevisarCompraTextil` con lo ya editado (cabecera y líneas); en `RevisarCompraTextil` la
  categoría es fija y «Cambiar categoría» hace lo contrario. Así ninguna factura textil se
  registra con el casado a mano y sin ver el reparto.
- Botón «Proveedores» (diálogo, sin ruta nueva) en las dos pantallas de compras, con escáner:
  lista de `listProveedores` y edición de nombre, NIF y activo con `guardarProveedor`.

**Flujo: revisar y registrar una factura textil**

1. Pulsar «Revisar» en la cola (o «A mano»). Se abre `RevisarCompraTextil` (diálogo ancho).
2. Arriba: proveedor y NIF leídos (editables), número, fecha, base, tipo de IVA, total; si
   `leerMemoriaEscaner` lo encuentra: «Proveedor conocido: X · N compras · M referencias
   aprendidas»; si no: «Proveedor nuevo: se dará de alta al registrar». Si la persona cambia el
   NIF o el nombre, se vuelve a llamar a `leerMemoriaEscaner` y se recalcula el casado (el
   `proveedor_id` viejo no se manda: daría E-REG-25). Los motivos de revisión y los duplicados,
   como en `RevisarCompra`.
3. Tabla de líneas (una fila por línea; en móvil, tarjetas): Tipo (`Select` con
   `ETIQUETAS_TIPO_LINEA`), Descripción, Referencia, Color, Talla, EAN, Cantidad, Uds/pack,
   Unidades (calculadas), Importe, **Coste de entrada por unidad** (del reparto) y **Variante**.
4. Variante, calculada con `casarLineas` al abrir y al cambiar referencia/color/talla/EAN/tipo:
   - verde «Memoria» / «EAN» / «Referencia» con la etiqueta de la variante (cambiable);
   - ámbar «Sugerencia»: hasta tres botones con la etiqueta y los puntos; **nada se asigna sin
     pulsar**;
   - rojo «Sin casar»;
   - gris «No va al stock» en portes, descuentos y otros;
   - azul «Nueva» si la línea lleva `nueva_variante`.
     Acciones por línea: «Elegir…» (abre `SelectorStockTextil` en modo «una variante», con el
     texto de la línea ya buscado) y «Crear variante» (abre `CrearVarianteDialog` con
     `nuevaVarianteDesdeLinea`). Si la memoria apuntaba a otra variante y se cambia, al registrar
     se reaprende sola (no hace falta «olvidar»).
     **Pack de la memoria:** si el casado es `memoria` con `unidades_por_pack ≠ 1` y la línea
     trae pack 1 sin haberlo leído ni deducido, se propone el de la memoria **a la vista**
     («Pack de la memoria: 5 uds»), cambiable; nunca en silencio, porque cambia las unidades que
     entran.
5. Botón «Crear las variantes que faltan (N)»: el mismo diálogo en forma de tabla, una fila por
   línea sin casar, con el producto agrupado por marca + referencia.
6. Pie del reparto (de `repartirCostes`, en vivo): «Portes, descuentos y otros: +12,50 €
   repartidos entre 8 artículos por importe» y «Coste de entrada 1.234,56 € = base 1.234,56 € ✓»
   (o el error en rojo).
7. «Registrar y dar de alta en el stock» deshabilitado mientras haya: líneas sin variante,
   errores de reparto, duplicado que bloquea, posible duplicado sin confirmar, falta de fecha o
   de proveedor (nombre y NIF vacíos). Al pulsar: `guardarYRegistrarCompra` con el
   `proveedor_id` que encontró `leerMemoriaEscaner` (o nulo) y, por línea, `casado_metodo`:
   el `metodo` del `Casado` si se dejó como estaba; `"sugerencia"` si se aceptó una sugerencia;
   `"manual"` si se eligió a mano; `"nueva"` si lleva `nueva_variante`; nulo en lo que no es
   artículo. Éxito → «Registrada:
   12 líneas al stock, 3 variantes nuevas, 9 referencias aprendidas»; se invalidan `compras`,
   `textil-stock`, `gerencia-compras`, `escaner-memoria`.

`CrearVarianteDialog` (`src/components/textil/CrearVarianteDialog.tsx`): producto existente
(`Select` de `listProductosTextil`, preelegido con `productoParaLinea`) o «Producto nuevo»
(marca, referencia, nombre, categoría); color, talla, EAN (aviso si no es válido), SKU,
precio de venta (vacío; debajo, «Recomendado: X € (×R sobre coste, mediana de N prendas del
mismo producto/de tu catálogo)» con `precioRecomendado` sobre el coste de entrada de la línea, o
«Sin datos para recomendar»; ⓘ `g_precio_recomendado`), mínimo. No escribe en la base: deja la
`nueva_variante` en la línea.

### 4.2 `SelectorStockTextil` (`src/components/textil/SelectorStockTextil.tsx`)

Diálogo con dos modos: `"cantidades"` (presupuesto y pedido) y `"una"` (casado en compras).

1. Buscador (marca, referencia, nombre, SKU, color o EAN) sobre
   `agruparPorProducto(variantes activas no repetidas)` + `buscarProductos`. Cada resultado:
   «marca · referencia · nombre», nº de variantes y disponible total.
2. Al elegir producto: rejilla `rejillaProducto` (filas color, columnas talla en orden). Cada
   celda: **disponible** grande y «físico F · reservado R» en pequeño; celda inexistente «—».
   - Modo `"cantidades"`: un campo de cantidad por celda; si supera el disponible, la celda se
     pone roja con «Faltan N». En un pedido no deja añadir lo que falta (el servidor tampoco); en
     un presupuesto solo avisa.
   - Modo `"una"`: pulsar la celda elige la variante.
3. «Añadir N líneas» → `lineasDesdeStock(variantes, cantidades)`.

### 4.3 `LineasEditor` (`src/components/textil/LineasEditor.tsx`)

- `Linea` pasa a ser `LineaDocumentoTextil`; `stock` pasa a `VarianteCatalogo[]` (las páginas
  mapean con `aVarianteCatalogo`); prop nueva `reservadoPropio?: ReadonlyMap<string, number>`.
- El indicador de cada línea usa **disponible** (`disponible(v, propio)` menos lo pedido en el
  propio documento), no el físico. El `Select` de variante solo ofrece activas y no repetidas
  (más la que ya tenga la línea, para que un documento viejo se vea entero).
- Botón «Elegir del stock» → `SelectorStockTextil` en modo `"cantidades"`.
- Por línea con variante: «Coste X» (el congelado si lo trae, si no el de la variante; «Sin
  coste» si es 0 o nulo) y, si el precio está vacío o es 0, «Recomendado: Y €» (solo informa; no
  rellena nada).
- Pie: además de Subtotal/IVA/Total, «Coste previsto · Margen previsto (Z %)» de
  `margenPrevisto`, con «N líneas sin coste» si las hay; ⓘ `m_margen_previsto`.

### 4.4 Presupuestos y pedidos (`src/routes/panel/textil/presupuestos.tsx`, `pedidos.tsx`)

- Pasan `stock` mapeado con `aVarianteCatalogo`. En pedidos, al editar uno que no está enviado,
  entregado ni cancelado: `reservadoPropio = reservadoPorVariante(items guardados)`.
- Presupuesto: `upsertPresupuesto` devuelve `avisos`; si hay, `toast.warning` con ellos (se
  guarda igual).
- **Desde el stock**: si la dirección trae `?desde_stock=<id>,<id>,…` y el stock está cargado,
  se abre el diálogo de nuevo documento con `lineasDesdeStock(variantes elegidas)` y se quita el
  parámetro (`navigate({ to: ".", search: …, replace: true })`). Ids que no existan, inactivos
  o repetidos se ignoran con un aviso.
- Las dos rutas declaran `validateSearch: (s) => ({ desde_stock: typeof s.desde_stock ===
"string" ? s.desde_stock : undefined })` en su `createFileRoute` (hoy no tienen
  `validateSearch`, y sin él `navigate({ search: { desde_stock } })` desde `stock.tsx` no
  compila). Es un cambio dentro del fichero de la ruta: **no** toca `src/routeTree.gen.ts`. El
  parámetro es opcional, así que los `Link` que ya apuntan a estas rutas no cambian.

### 4.5 Textil › Stock (`src/routes/panel/textil/stock.tsx`)

- Columnas nuevas: Producto (marca · referencia) y EAN; badge «Repetida» con acción
  «Fusionar con…» (elige destino entre las de su mismo producto, color y talla; confirma; llama a
  `fusionarVariantes`).
- Selección: casilla por fila. Con alguna marcada, barra «N variantes · Crear presupuesto ·
  Crear pedido · Quitar selección» → navega a `/panel/textil/presupuestos` o
  `/panel/textil/pedidos` con `search: { desde_stock: ids.join(",") }`.
- `StockDialog`: producto (existente o nuevo, con `guardarProductoTextil` antes de guardar la
  variante; el `nombre` de la variante nueva se propone con el del producto y se puede
  cambiar), EAN, precio de venta con «Recomendado…» (ⓘ `g_precio_recomendado`). **Al crear**,
  sin campos de existencias ni de coste: debajo, «Las existencias entran con su factura (Textil ›
  Compras) o con un recuento» (3.6). Al **editar**, el coste medio se ve pero **no se edita**
  («Lo calcula el libro de movimientos»).
- `EntradaDialog` (entrada por compra) **desaparece**. En su lugar, «Otro movimiento»:
  merma, devolución a proveedor (con la compra textil del proveedor, opcional), devolución de
  cliente sin pedido y ajuste; cantidad positiva y el signo lo pone el motivo (en el ajuste,
  la persona elige «Sobran» o «Faltan»); sin coste (lo congela la base). Debajo: «Las entradas por compra se registran con su factura en Textil ›
  Compras».
- Sin migración: sin columnas Producto/EAN/Repetida ni fusión; con el aviso. La pantalla lo sabe
  con `estadoEscanerTextil` (3.5): `listStock` sigue devolviendo una lista (la usan también
  `PaginaCompras`, presupuestos, pedidos y la portada de Textil) y no cambia de forma.

---

## 5. Cuentas

### 5.1 Datos (`src/lib/gerencia.ts`, navegador, `tabla()` + `leerTodas`)

| Gancho                               | Qué lee                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tolerancia                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `useMovimientosAlmacen(hasta: Date)` | **Todos** los movimientos (paginado): `stock_id, motivo, cantidad, coste_unitario, created_at, fecha, compra_id, textil_pedido_id`; el filtro por fecha efectiva lo hace el dominio. Devuelve `{ movimientos: MovimientoAlmacen[]; conFecha: boolean }`.                                                                                                                                                                                                         | `faltaLaColumna` → sin `fecha` ni `compra_id`, `conFecha: false`; `faltaLaTabla` → `null`. |
| `useControlesAlmacen(rango)`         | Compras textil registradas con fecha en el rango (`id, numero, proveedor, fecha, base, categoria, estado` y `borrada_en` si existe); entradas `motivo = 'compra'` con `compra_id` en esas (el `.in()` en trozos de 100 ids: una URL con cientos de UUID la corta PostgREST); `rpc('stock_descuadres')` y `rpc('stock_reservas_descuadres')` (contar filas); `textil_stock` (`cantidad, coste_unitario`) para `diferenciaValorCache` contra `valorAFecha` de hoy. | Sin `compra_id`: `{ disponible: false }` y el aviso.                                       |
| `usePagosProveedores()`              | Compras con `estado = 'registrada'` y `estado_pago = 'pendiente'` (cualquier fecha y categoría): `id, proveedor, nif_proveedor, proveedor_id, numero, fecha, liquido, total, estado, estado_pago, borrada_en`.                                                                                                                                                                                                                                                   | Sin `proveedor_id`, sin él; sin `estado_pago` (`20261014100000`), `null`.                  |

### 5.2 Dónde va cada cifra

| Sitio                                                                                                     | Qué se ve                                                                                                                                                                                                                                                                                                                                                                        | Cálculo                                                      | ⓘ                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Gerencia › Textil, tarjeta nueva «Cuenta del almacén»                                                     | Tabla unidades / valor: Existencias al «desde» · + Compras · + Altas con existencias · + Devoluciones de clientes · − Coste de lo vendido · − Mermas · − Devoluciones a proveedores · ± Ajustes · = Existencias al «hasta»                                                                                                                                                       | `cuentaAlmacen(movs, desde, hasta)`                          | `g_almacen_cuenta`                |
| Gerencia › Textil, tarjeta nueva «Controles del almacén»                                                  | Tres filas con ✓ o la cifra en rojo (o «No comprobado» si no se pudo leer): compras textil frente a entradas (diferencia €, nº con descuadre, nº «anteriores al enlace»), variantes descuadradas, reservas descuadradas; lista de las compras con descuadre; debajo, en gris y sin ✓/✗, «Valor según caché − valor según libro: X €» con su explicación (`diferenciaValorCache`) | `controlComprasEntradas` + `resumenControles`                | `g_almacen_controles`             |
| Gerencia › Textil, KPI «Valor del almacén»                                                                | Igual que hoy (caché, hoy)                                                                                                                                                                                                                                                                                                                                                       | `resumenStock`                                               | `g_stock_valor` (texto ampliado)  |
| Gerencia › Resultados, fila nueva «Mermas y ajustes de almacén» (detrás de «Amortizaciones», solo si ≠ 0) | Resta en A y en el total; 0 en B                                                                                                                                                                                                                                                                                                                                                 | `costeAlmacenPeriodo` → `resultadosPorGrupo({ …, almacen })` | `g_almacen_perdidas`              |
| Gerencia › Tesorería, tarjeta nueva «Pagos pendientes a proveedores»                                      | KPI total y nº de facturas; tabla por proveedor (top 10 + «resto»); tramos 0–30 / 31–60 / 61–90 / +90 días; enlace «Ver facturas de compra» a `/panel/compras`                                                                                                                                                                                                                   | `pagosPendientesProveedores`                                 | `g_pagos_proveedores`             |
| Informe PDF de socios, página nueva «Almacén» (después de «Gastos del periodo»)                           | La cuenta del almacén del periodo, el valor de hoy, los controles con ✓/✗ y los pagos pendientes a proveedores. Sin datos: «Sin datos del almacén para este periodo.»                                                                                                                                                                                                            | `InformeAlmacen`                                             | textos de las mismas definiciones |

`grupos.ts`: `ColumnaResultados` añade `almacen: number`; `resultadosPorGrupo` acepta
`almacen?: number` (va a A, como compras y amortizaciones) y
`bai = margen − costesFijos − compras − amortizacion − almacen`. Pruebas en `grupos.test.ts`.

`pdf-informe-socios.ts`: `DatosInformeSocios.almacen?: InformeAlmacen | null`;
`ResumenDiario.tsx` lo rellena con `useMovimientosAlmacen`, `useControlesAlmacen` y
`usePagosProveedores` (si alguno falla, esa parte va a `null`, el informe sale igual).

### 5.3 Definiciones nuevas o cambiadas (`src/dominio/definiciones.ts`), texto exacto

```ts
g_almacen_cuenta: {
  que: "Cómo ha cambiado el almacén textil en el periodo, en unidades y a precio de compra: lo que había, lo que entró, lo que salió y lo que queda.",
  calculo: "Existencias al inicio + compras + altas con existencias + devoluciones de clientes − coste de lo vendido − mermas − devoluciones a proveedores ± ajustes de inventario = existencias al final. Cada movimiento cuenta a su coste: las entradas por compra al de la factura, con portes y descuentos repartidos, y las salidas al coste medio congelado al salir. El valor a una fecha es la suma de todos los movimientos hasta ese día.",
  fuente: "Libro de movimientos del almacén textil, por la fecha del movimiento (en las compras, la de la factura). No depende de los filtros de tienda ni canal. El coste de lo vendido va por la fecha de salida y el «Coste de la ropa» de Resultados por la fecha del pedido: en un periodo pueden no coincidir.",
},
g_almacen_perdidas: {
  que: "Lo que se ha perdido o encontrado en el almacén textil fuera de los pedidos: mermas, recuentos, devoluciones a proveedores y devoluciones de clientes sin pedido.",
  calculo: "Mermas + devoluciones a proveedores − ajustes de inventario − devoluciones de clientes sin pedido, cada movimiento a su coste congelado: un recuento que encuentra prendas resta coste y uno que no las encuentra lo suma. Lo que sale o vuelve con un pedido ya está en «Coste de la ropa» y no se cuenta aquí. Va en A: la ropa se compró con factura.",
  fuente: "Libro de movimientos del almacén textil con fecha en el periodo. El CRM todavía no recoge abonos de proveedor: una devolución cuesta aquí hasta que exista el abono.",
},
g_almacen_controles: {
  que: "Comprobaciones que tienen que dar 0. Si alguna no da 0, hay algo que mirar antes de fiarse de las cifras del almacén.",
  calculo: "1) La base de cada factura textil registrada menos el valor de sus entradas en el stock, con portes y descuentos repartidos: 0,00 €. 2) Variantes cuyas unidades guardadas no coinciden con la suma de su libro: 0. 3) Variantes cuyo reservado no coincide con sus reservas: 0.",
  fuente: "Facturas de compra textil registradas con fecha en el periodo y sus entradas enlazadas. Las registradas antes del enlace (migración 20261028100000) no tienen entradas enlazadas: se cuentan aparte y no se pueden comprobar.",
},
g_pagos_proveedores: {
  que: "Lo que se debe hoy a los proveedores: facturas registradas que aún no se han pagado.",
  calculo: "Suma del líquido (total menos retención) de las facturas de compra registradas, sin borrar y pendientes de pago, de todas las categorías, por proveedor y por antigüedad desde la fecha de la factura.",
  fuente: "Facturas de compra. No depende del periodo. Una factura deja de estar pendiente al marcarla pagada o al conciliarla con el banco.",
},
g_precio_recomendado: {
  que: "Un precio de referencia, solo informativo: el precio de venta lo pones tú.",
  calculo: "Coste medio de la prenda × la relación precio/coste típica (la mediana) de las otras tallas y colores del mismo producto; si el producto no tiene ninguna con precio, la de todas tus prendas activas con precio y coste (al menos 3). Sin coste o sin esos datos, no se recomienda nada.",
  fuente: "Almacén textil: prendas activas con precio de venta y coste medio mayores que cero.",
},
m_margen_previsto: {
  que: "Lo que dejaría este documento si la ropa costase lo que cuesta en el almacén.",
  calculo: "Base de las líneas con prenda del almacén − cantidad × coste congelado en la línea (o, si aún no se ha guardado, el coste medio de hoy). Las líneas sin prenda del almacén no tienen coste y se cuentan aparte.",
  fuente: "Coste medio del almacén textil, congelado en cada línea al guardarla. El margen real sale al entregar el pedido, con el coste de la salida.",
},
```

Cambios en definiciones que ya existen:

- `g_stock_valor.fuente` → «Almacén textil, hoy: las unidades y el coste medio guardados. No
  depende del periodo. Puede diferir unos céntimos del valor según el libro de la Cuenta del
  almacén.»
- `g_resultado.calculo`: donde dice «− otras compras − amortizaciones» pasa a «− otras compras −
  amortizaciones − mermas y ajustes de almacén».

---

## 6. Reparto de ficheros

Ningún fichero está en dos equipos. Lo que no está en la tabla no se toca.

| Equipo         | Ficheros (exactos)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL**        | `supabase/migrations/20261028100000_escaner_textil_esquema.sql` (nuevo) · `supabase/migrations/20261028100100_escaner_textil_datos.sql` (nuevo) · `supabase/migrations/20261028100200_escaner_textil_reglas.sql` (nuevo) · `supabase/reversiones/20261028100000_escaner_textil_esquema.sql` (nuevo) · `supabase/reversiones/20261028100100_escaner_textil_datos.sql` (nuevo) · `supabase/reversiones/20261028100200_escaner_textil_reglas.sql` (nuevo) · `supabase/pruebas/C18_escaner_textil.sql` (nuevo) · `supabase/pruebas/probar-migraciones.sh` · `supabase/pruebas/60_stock_movimientos.sql` · `supabase/pruebas/70_stock_reservas.sql` · `supabase/pruebas/estado_migraciones_octubre.sql` |
| **DOMINIO**    | `src/dominio/tipos-textil.ts` (nuevo) · `src/dominio/normalizar-textil.ts` + `.test.ts` (nuevos) · `src/dominio/reparto-compra.ts` + `.test.ts` (nuevos) · `src/dominio/casado-textil.ts` + `.test.ts` (nuevos) · `src/dominio/stock-textil.ts` + `.test.ts` (nuevos) · `src/dominio/precio-recomendado.ts` + `.test.ts` (nuevos) · `src/dominio/cuenta-almacen.ts` + `.test.ts` (nuevos) · `src/dominio/controles-almacen.ts` + `.test.ts` (nuevos) · `src/dominio/pagos-proveedores.ts` + `.test.ts` (nuevos) · `src/dominio/factura-compra.ts` + `factura-compra.test.ts` · `src/dominio/cola-compras.ts` + `cola-compras.test.ts` · `src/dominio/compras.ts` + `compras.test.ts`               |
| **SERVIDOR**   | `src/lib/escaner-textil.ts` (nuevo) · `src/lib/escaner-textil.functions.ts` (nuevo) · `src/lib/compras.functions.ts` · `src/lib/cola-compras.server.ts` · `src/lib/lector-facturas.server.ts` · `src/lib/textil.functions.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **INTERFAZ**   | `src/components/compras/RevisarCompraTextil.tsx` (nuevo) · `src/components/textil/CrearVarianteDialog.tsx` (nuevo) · `src/components/textil/SelectorStockTextil.tsx` (nuevo) · `src/components/compras/PaginaCompras.tsx` · `src/components/compras/SubidaFacturas.tsx` · `src/components/compras/ColaRevision.tsx` · `src/components/textil/LineasEditor.tsx` · `src/routes/panel/textil/stock.tsx` · `src/routes/panel/textil/presupuestos.tsx` · `src/routes/panel/textil/pedidos.tsx`                                                                                                                                                                                                          |
| **CUENTAS**    | `src/lib/gerencia.ts` · `src/components/gerencia/Textil.tsx` · `src/components/gerencia/Resultados.tsx` · `src/components/gerencia/Tesoreria.tsx` · `src/components/gerencia/resumen-diario/ResumenDiario.tsx` · `src/lib/pdf-informe-socios.ts` · `src/dominio/definiciones.ts` · `src/dominio/grupos.ts` + `src/dominio/grupos.test.ts`                                                                                                                                                                                                                                                                                                                                                          |
| **ARQUITECTO** | `docs/escaner-textil/contrato.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Cambios en ficheros de pruebas viejos (SQL): en `60_stock_movimientos.sql` (casos 1 y 2) y
`70_stock_reservas.sql` (la entrada inicial) el motivo `'compra'` pasa a `'inicial'` y el texto
«compra» de los mensajes a «entrada»; nada más. Es lo que exige I2 (las pruebas corren como
superusuario, así que E-STK-2 no las para; las para la CHECK de 1.3.5).

Ficheros que **nadie** toca (y por qué no hace falta): `src/routes/panel/textil/compras.tsx` y
`src/routes/panel/compras.tsx` (solo montan `PaginaCompras`); `src/routes/panel/textil/index.tsx`
(sigue con `listStock`, que no cambia de forma; el «bajo mínimo» con físico va a la sección 8);
`src/dominio/textil.ts` (`costePorPedido`, `resumenStock`: no cambian); `src/lib/resumen-diario.ts`
(lee columnas que siguen existiendo); `src/integrations/supabase/types.ts` (se sigue con
`tabla()` y `llamarRpc`); `src/routeTree.gen.ts` (nunca); `supabase/pruebas/90_compras_textil.sql`,
`C1`, `C2`, `C3`, `C5`, `C14` (tienen que pasar sin tocarlas: si alguna falla, el error está en
la migración, no en la prueba).

---

## 7. Plan de pruebas

### 7.1 SQL: `supabase/pruebas/C18_escaner_textil.sql`

En `probar-migraciones.sh`, al final de la lista:
`seccion "Escáner textil: compras, catálogo, stock y cuentas" C18_escaner_textil.sql`.

Estructura como `C17`: `BEGIN;`, `SET client_min_messages = warning;`, `\ir` de las **tres**
migraciones **dos veces** (y en orden), `RESET client_min_messages;`, casos que imprimen
`BIEN  n.` o `MAL   n.`, y `ROLLBACK;` antes del caso 24, que va **fuera** de la transacción
(1.0.4) y es lo último del fichero. Usuario de prueba en `auth.users` +
`user_roles` admin; las llamadas a funciones de solo `service_role` se hacen como el
superusuario de la prueba con ese `_usuario_id`; las de RLS con
`set_config('request.jwt.claim.sub', …)` + `SET LOCAL ROLE authenticated` (como `C11`).

Casos (cada uno, al menos una línea BIEN/MAL):

1. Los vectores de 2.2, uno por línea, con `textil_clave`, `textil_clave_talla`, `nif_clave` y
   `textil_clave_memoria`.
2. Proveedores: `B-12345678` y `ES B12345678` en la misma empresa → `unique_violation`; dos sin
   NIF con «Tejidos Sur» y «TEJIDOS-SUR» → `unique_violation`.
3. Productos y variantes: alta de variante sin `producto_id` → producto creado por nombre;
   otra con el mismo nombre → mismo producto; variante activa repetida («Negro»/«xxl» frente a
   «negro»/«2XL») → `unique_violation`; la misma desactivada → se admite; EAN repetido →
   `unique_violation`; EAN `'123'` → `check_violation`.
4. RLS: `textil_compras` y `textil_compra_lineas` tienen exactamente cuatro políticas cada una
   (SELECT, INSERT, UPDATE, DELETE), ninguna `ALL`, todas con `es_miembro_empresa`; un usuario
   sin tienda ni rol no ve compras; el admin sí; `authenticated` no puede insertar una compra
   `registrada`.
5. Registro feliz: compra textil nueva (id nulo), artículo 60,00 € (6 uds) y artículo 40,00 € (2
   packs × 2), porte 10,00, descuento −5,00, base 105,00, costes de entrada 63,00 y 42,00:
   devuelve `movidas = 2`, proveedor creado y enlazado, compra `registrada` y `revisada`,
   movimientos con `compra_id`, `compra_linea_id` y `fecha` de la factura,
   `round(Σ cantidad × coste_unitario, 2) = 105.00`, unidades 6 y 4, memoria con 2 claves
   `veces = 1`, y la fila de `auditoria` de la compra con `usuario_id` = el de la prueba.
6. Atomicidad: el mismo registro con costes que suman 104,99 → error E-REG-15 y **nada**
   escrito (ni compra, ni proveedor, ni variantes, ni movimientos, ni memoria: conteos iguales).
7. Errores: sin variante (E-REG-20 con «Línea 2»), unidades 1,5 (E-REG-10), artículo negativo
   (E-REG-9), líneas que no suman la base (E-REG-14), sin artículos (E-REG-8), sin fecha
   (E-REG-5), usuario no miembro (E-REG-2), variante desactivada (E-REG-17), repetida (E-REG-18).
8. Variante nueva: dos líneas del mismo producto nuevo (marca + referencia) en tallas M y L →
   un producto `origen 'escaner'` y dos variantes; una tercera línea igual que la M → misma
   variante; `variantes_creadas = 2`; EAN de la línea aprendido en la variante.
9. Duplicado: registrar otra vez mismo proveedor y número → E-REG-21 (`unique_violation`).
10. Cabecera inmutable: en la registrada, `UPDATE base` → error; `estado_pago/fecha_pago` → bien;
    `fichero_ruta` de nulo a valor → bien y otra vez → error; `estado = 'borrador'` → error;
    `DELETE` → error; `borrada_en` en textil → error; en una `otros` registrada → bien; y
    `UPDATE tipo_iva` que no cambia la cuota → bien.
11. Memoria: segunda compra del mismo proveedor y la misma referencia/color/talla a la misma
    variante → `veces = 2`; a otra variante → `stock_id` nuevo y `veces = 1`.
12. Guardián del coste: `UPDATE textil_stock SET coste_unitario = 99` → error E-STK-1; renombrar
    → bien.
13. Compra a coste 0 baja la media: 10 a 5,00 (`inicial`) + una compra registrada con
    `textil_compra_guardar_y_registrar` cuyo artículo de 10 uds queda a coste de entrada 0
    (artículo 10,00 y descuento −10,00, base 0) → coste medio 2,50.
14. Devolución de cliente al coste de su venta: 10 a 4,00 (`inicial`); venta −2 del pedido P;
    entrada `inicial` de 10 a 10,00; devolución +1 del pedido P sin coste → el movimiento queda
    a 4,00 (ni 0 ni la media).
15. Ajuste positivo sin coste toma el coste medio.
16. Entrada manual `compra` sin línea → `check_violation`; `inicial` → bien.
17. Coste congelado en líneas: presupuesto con variante a 7,50 → `coste_unit_snapshot = 7.5`;
    variante a 0 → nulo; `UPDATE` de la cantidad conserva el coste aunque la variante cambie de
    coste medio.
18. Migración de datos: dentro de la transacción, quitar `NOT NULL`, el índice
    `textil_stock_variante_unica` y el trigger `textil_stock_producto_auto`; insertar «Polo
    Piqué» azul M (2 veces) y «polo pique» azul L sin producto; `escaner_textil_migrar_datos()` →
    un producto con tres variantes y una `repetida`; volver a aplicar la migración de reglas sin
    error; llamarla otra vez → todo a 0 (idempotente).
19. Fusión: la repetida con 3 uds a 2,00 y una reserva de 1 → `textil_stock_fusionar`: origen
    a 0 e inactiva, destino +3, reserva movida, líneas de pedido apuntando al destino,
    `stock_descuadres()` y `stock_reservas_descuadres()` sin filas.
20. `textil_compra_registrar` nueva: compra con artículos casados → movimientos con enlace; con
    un porte → E-REG-22.
21. Compra `consumibles` con `textil_compra_guardar_y_registrar` → registrada, 0 movimientos,
    proveedor enlazado.
22. Auditoría: `proveedores`, `textil_productos` y `textil_referencias_proveedor` con un solo
    trigger `<tabla>_auditoria` y `tgtype & 127 = 29`. Ninguna FK nueva a `empresas` en cascada.
23. `escaner_textil_version() = 1`.
24. Reversión (después del `ROLLBACK`): aplicar las tres reversiones (200, 100, 000) y después
    las tres migraciones (000, 100, 200) sin error; las columnas vuelven y
    `escaner_textil_version() = 1`. La base queda como tras aplicar todas las migraciones (con
    la versión nueva de `textil_compra_registrar`, no la que dejó `C1`).
25. Registrar a mano: como `authenticated`, `UPDATE textil_compras SET estado = 'registrada'`
    de un borrador → E-CAB-6; `textil_compra_registrar` de la misma compra → bien.
26. Entrada `compra` a mano: como `authenticated`, `INSERT` en `textil_stock_movimientos` con
    motivo `compra` y la `compra_linea_id` de una línea ya registrada → E-STK-2; movimiento con
    `compra_linea_id` y `compra_id` nulo → `check_violation` (`stock_linea_con_compra`).
27. Gasto fijo: compra `servicios` registrada con `gasto_id`; borrar el gasto → bien y
    `gasto_id` nulo; `UPDATE gasto_id` a otro gasto → E-CAB-3.
28. Salida con coste escrito: merma −1 con `coste_unitario = 99` → queda al coste medio.
29. Devolución tras fusión: venta −2 del pedido P desde la variante A a 4,00; fusionar A en B
    (B a 9,00); devolución +1 del pedido P en B sin coste → queda a 4,00; las líneas del pedido
    conservan su `coste_unit_snapshot`.
30. Memoria ambigua: factura con dos artículos sin referencia, misma descripción, sin color ni
    talla, a dos variantes distintas → `aprendidas` no los cuenta y no queda entrada con esa
    clave; y la migración de datos no aprende una descripción que fue a dos variantes.
31. Fecha futura → E-REG-23; `proveedor_id` de un proveedor con otro NIF → E-REG-25; factura sin
    NIF de un proveedor que ya existía sin NIF con el mismo nombre y ahora trae NIF → no crea
    otro: le pone el NIF.
32. Acceso: usuario no miembro llama a `textil_compra_registrar` de una compra de otra empresa
    → E-REG-2.
33. Dos registros seguidos que crean la misma variante nueva (mismo producto, color y talla)
    → la segunda la reutiliza (comprueba el `ON CONFLICT … WHERE` de 1.0.8).

Además, con las migraciones nuevas, **todas** las pruebas viejas siguen en verde (en especial
`60`, `70`, `90`, `99`, `C1`, `C2`, `C3`, `C5`, `C11`, `C14`) y el veredicto final dice «TODO
EN VERDE».

### 7.2 Dominio

Los casos de 2.2–2.10 en sus `*.test.ts`, más `grupos.test.ts` (CUENTAS): `almacen` resta en A
y en el total y no en B. `npm run test` en verde.

### 7.3 Comprobaciones manuales para Javier

Antes de aplicar las migraciones (la aplicación ya desplegada):

1. Textil › Compras, Stock, Presupuestos, Pedidos y Gerencia funcionan como antes, con el aviso
   de la migración donde toca. Un presupuesto con más cantidad que el disponible se guarda con
   aviso (antes daba error). Cambios a propósito que se notan ya: una variante nueva nace sin
   existencias ni coste (entran con su factura o con un recuento) y «Entrada por compra»
   desaparece de Stock.

Después de aplicar `20261028100000`, `20261028100100` y `20261028100200` (en ese orden):

2. Leer los `NOTICE` de la migración de datos: productos creados, variantes enlazadas,
   repetidas, proveedores, compras enlazadas, memoria.
3. Textil › Stock: cada variante con su producto; si hay repetidas, fusionar una y comprobar en
   el historial los dos ajustes «Fusión».
4. Textil › Compras: arrastrar tres facturas de un proveedor textil. Revisar una: tipos de línea,
   referencia, color, talla y pack leídos; crear las variantes que faltan poniendo el precio de
   venta (ver el recomendado o «Sin datos»); comprobar el pie «Coste de entrada = base ✓»;
   registrar. En Stock, las unidades × pack entran al coste de entrada y el historial dice la
   compra y la línea.
5. Revisar la segunda factura del mismo proveedor: las líneas ya vistas salen casadas
   «Memoria».
6. Intentar registrar con una línea sin variante (botón deshabilitado y motivo) y una factura
   cuyas líneas no suman la base (mensaje).
7. En la lista de compras, marcar pagada y adjuntar fichero a una registrada: funciona; no hay
   forma de cambiarle importes.
8. Presupuesto nuevo → «Elegir del stock» → buscar por marca o EAN → rejilla con disponible →
   cantidades → añadir. Ver coste y margen previstos. Guardar con más de lo disponible: aviso,
   se guarda. Confirmarlo como pedido: el pedido reserva.
9. Pedido con más de lo disponible: no deja.
10. Stock: marcar tres variantes → «Crear presupuesto» → se abre con las tres líneas.
11. Stock → «Otro movimiento» → merma de 2. Gerencia › Resultados: fila «Mermas y ajustes de
    almacén». Gerencia › Textil: la cuenta del almacén cuadra y los controles están en 0.
12. Gerencia › Tesorería: pagos pendientes a proveedores; marcar una pagada y ver que baja.
13. Gerencia › Resumen diario → «Informe PDF para socios»: página «Almacén».
14. Un pedido entregado que vuelve a pendiente: en el historial de la variante, la devolución
    entra al coste de la venta, no a 0.

---

## 8. Encontrado por el camino (no se arregla en esta obra)

1. `textil_stock_movimientos` y `textil_stock_reservas` tienen RLS `USING (true)`: no filtran por
   empresa.
2. Guardar un pedido textil y confirmar un presupuesto textil no son una sola transacción
   (varias llamadas desde la server function).
3. No hay abonos de proveedor (compra negativa): una devolución a proveedor solo puede costar.
4. `pagarCompra` no mira si la compra está conciliada con el banco; las compras en efectivo no
   cuadran con la caja.
5. `textil_pedidos.estado` es texto sin CHECK; `textil_factura_items` no guarda `stock_id`.
6. El «Beneficio» de la pestaña Resumen no incluye las mermas (solo Resultados).
7. La retención de una compra suelta va siempre al 111 (un alquiler sin gasto fijo debería ir
   al 115); la pestaña Fiscal calcula el IVA soportado distinto que el 303 de Resultados.
8. La portada de Textil (`src/routes/panel/textil/index.tsx`) cuenta «bajo mínimo» con el físico,
   no con el disponible.
9. La revisión de una factura no guarda el casado a medias: si se cierra sin registrar, al
   volver a abrirla se recalcula (la memoria lo recupera casi todo).
10. Los consumibles (tinta, film) no tienen inventario; solo se comparan.
11. `proveedor_clave` (columna generada de `20261015100000`, la que usa el índice de factura
    duplicada) no quita el prefijo `ES` del NIF y `nif_clave` sí: «ESB12345678» y «B12345678»
    son el mismo proveedor en `proveedores` pero no en la detección de duplicados.
12. `costePorPedido` (`src/dominio/textil.ts`) redondea por pedido y la cuenta del almacén por
    movimiento (I9): «Coste de la ropa» y «Coste de lo vendido» pueden diferir unos céntimos,
    además de por la fecha (pedido frente a salida).
13. `guardarPedidoTextil` no impide guardar líneas con variantes inactivas o repetidas (la
    interfaz no las ofrece, pero el servidor no lo comprueba).
14. No hay forma de fusionar dos proveedores (un NIF mal leído que creó uno de más): se corrige
    el NIF con `guardarProveedor`, pero las compras y la memoria del sobrante no se pasan.
15. `textil_stock_ean_unico` incluye las variantes desactivadas: un EAN de una variante retirada
    no se puede usar en otra nueva hasta quitárselo o reactivarla.

---

## 9. Revisión del crítico (19-10-2026)

Contrastado con el código y las migraciones de la rama. Cada cambio ya está aplicado arriba;
aquí, el qué y el porqué.

### Pérdida de información y descuadres

1. **Clave de memoria sin talla** (1.1.1, 2.2, 1.2 D, 1.3.7 paso 4.9). Sin referencia, la clave
   era solo la descripción: una factura con «Camiseta Heavy» en cinco tallas enseñaba a la
   memoria a mandar las cinco a la última variante, y la siguiente factura entraba todo en una
   talla. Ahora la clave `d:` lleva color y talla cuando la línea los trae; la memoria migrada y
   la del registro **no aprenden** claves que fueron a variantes distintas (y el registro borra
   la entrada que hubiera); `veces` cuenta facturas, no líneas; el casado solo usa la clave de
   solo descripción si color y talla son compatibles.
2. **Salidas a coste escrito** (1.3.4 paso 4, 3.6). `registrarMovimientoStock` aceptaba
   `coste_unitario` y el trigger lo respetaba en las salidas: una merma a coste inventado
   desligaba el valor del libro del de la caché. Ahora toda salida sale al coste medio y el
   servidor ya no manda coste.
3. **Devoluciones de cliente sin pedido no costaban en ningún sitio** (2.7, 5.3). Metían valor
   en el almacén sin pasar por Resultados. `perdidas` pasa a ser todo lo que no es compra,
   alta ni movimiento con pedido; se añade `textil_pedido_id` a `MovimientoAlmacen` y al
   gancho; invariante nueva I10 y definición `g_almacen_perdidas` corregida.
4. **Alta con existencias** (3.6, 4.5, 7.3). Crear una variante con cantidad y coste metía
   stock sin factura y un coste inventado (que además alimentaba el precio recomendado):
   contradice la decisión 3. La variante nace a 0; lo encontrado entra por recuento.
5. **Líneas con cantidad negativa se perdían** (2.10). Un abono «−2 × 10,00» lo tiraba el filtro
   `cantidad > 0` de la cola y la base dejaba de cuadrar sin explicación. Ahora queda como
   `1 × importe`, pasa a descuento si era artículo negativo y se avisa.
6. **Lectura de la IA frágil** (2.10). `tipo` como `z.enum` obligatorio hacía que un tipo raro
   tirase la lectura entera de la factura. Ahora es tolerante y decide `tipoDeLinea`.
7. **Fecha futura** (1.3.7, E-REG-23). Una fecha mal leída (2062) escondía las entradas de stock
   de toda cuenta del almacén hasta ese año.
8. **Proveedor partido en dos** (1.3.7 paso 2). Si llegaba primero sin NIF y luego con NIF, se
   creaban dos y la memoria quedaba repartida. Ahora se completa el NIF del que ya existía. Y
   `guardarProveedor` (3.5, 4.1) para corregir un NIF o nombre mal leídos.
9. **Coste congelado reescrito** (1.3.6, 1.3.9). Retirar una variante (FK `SET NULL`) o
   fusionarla cambiaba el `stock_id` de las líneas y el trigger tomaba el coste de la nueva.
   Ahora se conserva en esos dos casos.
10. **Devolución tras una fusión** (1.1.4, 1.3.4, 1.3.9). Las líneas del pedido pasan al destino
    pero la venta salió del origen: la devolución no encontraba la venta y entraba al coste
    medio. Columna nueva `fusionada_en` y búsqueda en las fusionadas. La fusión también mueve
    las líneas de compras en borrador (si no, daban E-REG-17).
11. **Diferencia de valor caché − libro** (2.8, 5.2). El control «caché vs libro» solo miraba
    unidades; ahora se enseña también la diferencia de valor, informativa, y «no comprobado» ya
    no cuenta como «en cero».

### Agujeros de seguridad y de integridad

12. **Registrar sin pasar por el registro** (1.3.2, E-CAB-6). Con la política `compras edicion`
    cualquiera con sesión podía hacer `UPDATE … SET estado = 'registrada'` y dejar una compra
    textil registrada sin stock ni reparto. Ahora solo pasa a registrada dentro de las
    funciones `SECURITY DEFINER` (se mira `current_user`, no una bandera, para que la versión
    vieja que deja `C1` siga funcionando en las pruebas).
13. **Entradas `compra` a mano enlazadas a una línea** (1.3.4, E-STK-2). La FK y la CHECK
    dejaban duplicar por PostgREST la entrada de una línea ya registrada. Ahora solo las
    funciones de registro anotan entradas `compra`.
14. **FK compuesta con `MATCH SIMPLE`** (1.1.7). Con `compra_id` nulo la FK no se comprobaba:
    CHECK `stock_linea_con_compra`.
15. **`textil_compra_registrar` sin control de empresa** (1.3.8). Es `SECURITY DEFINER` y la
    ejecuta `authenticated`: registraba compras de cualquier empresa. Ahora comprueba
    `es_miembro_empresa(auth.uid(), …)` cuando hay usuario.
16. **`unique_violation` mal traducido** (1.3.7 paso 5). Cualquier único (EAN, variante,
    memoria) habría salido como «factura ya registrada». Ahora solo el del índice
    `textil_compras_factura_unica`, en su propio bloque.
17. **NIF corregido con el proveedor viejo** (1.3.7, E-REG-25, 4.1). Si la persona corregía el NIF
    en la revisión, se mandaba el `proveedor_id` del NIF anterior y la compra quedaba con el
    proveedor equivocado.

### Cosas que rompían lo que ya funciona

18. **Borrar un gasto fijo** (1.3.2). `gasto_id` era inmutable en las registradas, pero la FK
    `ON DELETE SET NULL` lo pone a nulo y `gerencia.functions.ts` borra gastos fijos: habría
    fallado con E-CAB-3. Ahora se admite de un valor a nulo, y nada más.
19. **Lista de compras con PostgREST** (3.2). Con la FK doble de movimientos a compras y
    líneas, incrustar `textil_compra_lineas` sin pista puede dar `PGRST201`. Pista por columna
    `!compra_id`.
20. **`desde_stock` sin `validateSearch`** (4.4). Las rutas no declaran parámetros de búsqueda y
    `navigate({ search: { desde_stock } })` no compila. `validateSearch` opcional en cada ruta,
    sin tocar `routeTree.gen.ts`.
21. **`RevisarCompra` y el registro nuevo** (3.2, 4.1). El esquema de `guardarYRegistrarCompra`
    pide campos que `RevisarCompra` no tiene: se dice cómo rellenarlos. Y cambiar a textil desde
    `RevisarCompra` abre `RevisarCompraTextil`.
22. **Aviso de migración engañoso** (3.1). Con solo la primera migración aplicada decía que
    faltaba esa. Ahora nombra las tres.

### SQL que no habría pasado o no sería repetible

23. **Regex del EAN rota por la tabla** (1.1.4). El `|` de la expresión se leía como separador de
    columna y quedaba `'^([0-9]{8} | [0-9]{12,14})$'` (con espacios): copiada tal cual, ningún
    EAN válido entraba. El CHECK va ahora en un bloque de código.
24. **Reaplicar una `UNIQUE`** (1.0.7). Da `duplicate_table`, no `duplicate_object`: la
    migración no se podía aplicar dos veces (C18 lo hace).
25. **`ON CONFLICT` con índices parciales** (1.0.8). Sin repetir el predicado, Postgres no
    encuentra el índice y el `INSERT` falla. Se dan las cinco formas exactas.
26. **Reversiones dentro de `BEGIN … ROLLBACK`** (1.0.4, 7.1). Las reversiones llevan su
    `COMMIT`: dentro de C18 habrían confirmado a medias la transacción de la prueba. El caso 24
    va después del `ROLLBACK`.
27. **`NOTIFY pgrst`** (1.0.6, 1.5). Sin recargar el esquema, PostgREST no ve las funciones
    nuevas y el servidor caería al camino viejo creyendo que falta la migración.
28. Casos nuevos 25–33 en C18 para todo lo anterior; diagnóstico de las tres migraciones en
    `estado_migraciones_octubre.sql` (1.3.11, asignado a SQL).

### Conflictos de nombres, capas y reparto

29. **`normalizarNif`** ya existe en `src/dominio/clientes.ts` con otra regla (no quita `ES`).
    El nuevo se llama `claveNif` (como `nif_clave` en SQL).
30. **Formato en el dominio** (2, 2.3, 3.1). El contrato pedía un `numeroEs` propio en dominio:
    duplicaba `src/lib/format.ts` contra CLAUDE.md. Los errores del dominio van sin texto
    (`ErrorEscaner`) y el texto lo pone `mensajeErrorEscaner` con `format.ts`.
31. **`margenPrevisto`** reutiliza `porcentajeMargen` de `margen.ts` (regla 7 de CLAUDE.md).
32. **EAN canónico** (2.2). UPC-A de 12 cifras y GTIN-14 con 0 delante son el mismo artículo que
    su EAN-13: sin normalizar, el casado por EAN fallaba según cómo lo imprima cada proveedor.
33. **Casado por SKU** (2.4). Un SKU de modelo («5000») casaba todas las tallas con una variante.
    Ahora tiene que ser único y compatible en color y talla, y un EAN distinto en la factura veta
    la propuesta de la memoria o de la referencia.
34. **Dependencias entre equipos** (0.5). `definiciones.ts` es de CUENTAS y lo usa INTERFAZ:
    CUENTAS añade sus claves lo primero. Lista explícita de ficheros que nadie toca (6).
35. **`fecha DATE` en movimientos** (1.1.7). Choca con «timestamptz siempre» de CLAUDE.md; se
    deja como excepción justificada (fecha contable de calendario, igual que
    `textil_compras.fecha`) y se dice en la cabecera de la migración.

### Lo que se ha comprobado y está bien

Que las pruebas `C2` y `C3` siguen pasando con el trigger de cabecera (el `UPDATE` de `C2` se
hace cuando las cuotas aún no existen; ninguna prueba vieja escribe `estado = 'registrada'` a
mano); que `C5` y `C14` solo registran compras sin líneas; que ninguna prueba vieja hace salidas
con coste escrito; que `C11` no toca las políticas de compras; que `redondear` es simétrico
(los dos ajustes de una fusión suman 0); los vectores de normalización de 2.2 contra el SQL de
1.1.1; los repartos R1–R3 a mano; que `escaner-textil.ts`, `cola-compras.server` y
`pdf-informe-socios` respetan la regla de importaciones mixtas.

---

## 10. Cambios durante la obra

### DOMINIO (19-10-2026)

1. **`tipo` tolerante en `esquemaLectura`** (2.10). `z.enum(TIPOS_LINEA_COMPRA).nullable().optional()`
   rechaza un tipo raro y tiraba la lectura entera, contra lo que pide el mismo párrafo. Se
   añade `.catch(null)`: un tipo desconocido queda en `null` y lo decide `tipoDeLinea`. Las otras
   siete claves son `texto.optional().transform(v => v ?? null)` (si faltan, `null`).
2. **Avisos de línea de `revisarCompra` sin «Línea N:»** (2.10). `motivosRevision` ya antepone
   `Línea ${linea + 1}: ` a todo aviso con `linea`; con el prefijo dentro saldría dos veces. Los
   mensajes son «el EAN X no es válido.», «pack deducido del texto (X uds): compruébalo.» y
   «tenía cantidad X; queda como 1 × importe: compruébalo.», y en pantalla quedan exactamente
   como pide el contrato.
3. **`LineaLeida.cantidad_leida?: number`** (nuevo, opcional). Lo necesita el aviso de cantidad
   ajustada para decir la X original. Solo se rellena junto con `cantidad_ajustada: true`.
4. **`puntosParecido`**: el +20 de color y el +20 de talla solo cuentan si la línea **trae**
   color o talla. Con `mismoColor(null, null) = true` (dos sin color son el mismo, y así lo
   necesita el paso 4 de referencia), una línea sin color ni talla daba 40 puntos regalados a
   cualquier variante sin color ni talla que compartiera una sola palabra.
5. **Parecido y EAN**: el veto por EAN (pasos 2 y 4) también se aplica a las sugerencias del
   paso 5: una variante con otro EAN válido no se sugiere.
6. **Referencia ambigua**: las sugeridas del paso 4 llevan los puntos de `puntosParecido`, el
   motivo «Misma referencia, color y talla» y como mucho `MAX_SUGERENCIAS`.
7. **Memoria migrada**: el intento con `claveMemoriaDescripcion` solo se hace si no hay entrada
   con la clave completa (al pie de la letra de 2.4); si la hay y su variante no vale (inactiva,
   repetida o vetada por EAN), se pasa al EAN sin probar la migrada.
8. **`nuevaVarianteDesdeLinea`**: `sku: null` (no se copia la referencia: un SKU de modelo no
   casa, 2.4) y `ean` = `normalizarEan(linea.ean)` (un EAN que no vale no se propone; la base
   solo admite EAN normalizados).
9. **`agruparPorProducto`** sin `incluirInactivas` deja fuera también las **repetidas** (no se
   venden). **`buscarProductos`** con varias palabras exige que estén todas (cada una por
   «claveTexto contiene»).
10. **`fechaEfectiva`** devuelve `""` si no hay `fecha` ni `created_at` válidos: cuenta como
    anterior a cualquier fecha (existencias iniciales), en vez de perderse.
11. **`cuentaAlmacen`**: un motivo desconocido va a `ajustes` (con signo) para que la identidad
    no se rompa.
12. **`pagosPendientesProveedores`**: las etiquetas de tramo son «Hasta 30 días», «De 31 a 60
    días», «De 61 a 90 días» y «Más de 90 días»; una compra sin fecha (no debería: E-REG-5) va al
    primer tramo; sin nombre ni NIF, el proveedor se llama «Sin proveedor». La antigüedad se
    cuenta en días de calendario desde el día de `hoy` en Madrid.
13. **`controlComprasEntradas`**: en una fila `sin_enlace`, `diferencia` = 0 − base (informativa);
    no entra en `diferenciaTotal`. Orden: descuadres, sin enlace, cuadradas; dentro, la más
    reciente primero.
14. **`normalizar-textil.ts`** exporta además `ACENTOS` y `SIN_ACENTOS`; **`stock-textil.ts`**
    exporta además `utilizable(v)` (activa y no repetida), que usa el casado.

### SQL (19-10-2026)

Ninguno impedía implementar el contrato; son huecos que se han cerrado en el SQL. El banco
(`probar-migraciones.sh`, con `C18`) da «TODO EN VERDE».

1. **Fusión con coste 0 en el origen** (1.3.4, 1.3.9). Con la regla 2 de 1.3.4, la entrada
   `ajuste_inventario` del destino a coste 0 tomaba el coste medio del destino: los dos ajustes
   de la fusión no sumaban 0 y entraba valor de la nada. La fusión pone `app.fusion_variantes`
   desde el paso 2 (no solo en el 4) y, con ella, `stock_aplicar_movimiento` deja la entrada al
   coste del origen (aunque sea 0) y **siempre** recalcula la media. Los dos ajustes suman 0 y
   la caché sigue valiendo lo mismo que el libro.
2. **Coste congelado al editar una línea sin coste** (1.3.6). En `UPDATE`, mientras la línea siga
   en la misma variante (o la variante se retire o se fusione), se conserva el coste de `OLD`
   **también si era nulo**: así una línea vieja no se «rellena» desde el maestro al editarla. Solo
   al pasar a otra variante se toma el coste de la nueva.
3. **Nombre en blanco** (1.2 A, 1.3.1). Una variante con `nombre` en blanco daría un producto que
   no cumple `producto_nombre` y la migración no podría poner `NOT NULL`. Esas variantes van al
   producto «(sin nombre)», en la migración y en el trigger.
4. **Mensajes que no estaban en 1.4**: `Línea %: el producto no es de esta empresa.` (42501, la
   `nueva_variante.producto_id` es de otra empresa) y `La variante no existe.` (P0002, en la
   fusión). `textil_compra_registrar` da `La compra no existe.` con P0002 (antes P0001).
5. **E-REG-19 también al reutilizar** (1.3.7 paso 4.6): si la `nueva_variante` cae en una
   variante que ya existía y su EAN lo tiene **otra**, error; si la que existía no tiene EAN, se le
   pone.
6. **Números en los mensajes**: coma decimal y sin separador de miles (`trim_scale` para unidades
   y costes unitarios, dos decimales para importes); la fecha de E-REG-23, `DD/MM/AAAA`.
7. **Memoria migrada** (1.2 D): la ambigüedad se mira sobre todas las líneas de la clave, con la
   variante «resuelta» (`COALESCE(fusionada_en, id)`), y solo se aprende si esa variante está
   activa y no repetida. El pack y la última compra son los de la línea más reciente.
8. **Reversión de datos** (1.5.2): «compra registrada con el escáner» = tiene entradas de stock
   con `compra_id` o líneas con `casado_metodo`; esas conservan su proveedor de migración.
9. **Pruebas**: C18 también comprueba E-REG-1, 11, 12, 13 y 7, E-CAB-5, la FK compuesta con una
   línea de otra compra, la RLS de borrado y que el libro y las reservas cuadran al final.

### INTEGRADOR (20-10-2026)

1. **Sin las migraciones, una factura textil con portes se podía dejar de registrar** (3.2,
   paso 5). El camino viejo bloqueaba con `AVISO_MIGRACION_ESCANER` toda factura textil con una
   línea que no fuera artículo, y la IA ya marca los portes y descuentos: hasta aplicar las
   migraciones no se habría podido registrar ninguna factura textil con portes, que hoy sí se
   registra. Ahora solo bloquea lo que el camino viejo perdería: una `nueva_variante`, o una
   línea **casada con una variante** que no sea artículo o tenga `unidades_por_pack ≠ 1`. Los
   portes y descuentos sin variante no mueven stock, como siempre.
2. **Sin las migraciones, el reparto no bloquea** (3.2, paso 3). Si `conCostesDeEntrada` da error
   (por ejemplo, las líneas no suman la base: E-REG-14), el servidor mira `escanerAplicado`: con
   las migraciones, lanza el error; sin ellas, registra por el camino viejo, como hoy (sin
   reparto ni comprobación al céntimo, que la base aún no tiene).
3. **`lineaDesdeFila`, `lineaEnvioSimple`, `tipoDe`, `packDe`, `textoONulo` y el tipo
   `LineaEnvio`** pasan de `RevisarCompraTextil.tsx` a `src/lib/escaner-textil.ts`: un fichero
   de componentes que exporta funciones rompe el refresco en caliente (dos avisos nuevos de
   `react-refresh/only-export-components`). `compras.functions.ts` y
   `escaner-textil.functions.ts` usan el mismo `textoONulo` en vez de una copia cada uno.

### CORRECTOR (20-10-2026)

Lo que encontraron los tres revisores y se ha arreglado. Manda sobre lo que diga más arriba.

1. **Proveedor sin NIF que ya está con NIF** (1.3.7 paso 2, 1.2 C, `leerMemoriaEscaner`). Si la
   factura no trae NIF, primero se busca por `nombre_clave` el proveedor **con** NIF; si es uno
   solo, se usa ese; si no, el de ese nombre sin NIF; si no, se crea. La migración de datos
   enlaza igual una compra antigua sin NIF antes de crear proveedores de solo nombre, y
   `leerMemoriaEscaner` encuentra igual al proveedor. Así no se parte en dos (memoria y pagos).
2. **Proveedor elegido sin NIF y factura con NIF** (1.3.7 paso 2). Con `proveedor_id`, si el
   proveedor no tenía NIF y la factura sí (y ningún otro lo tiene), se le pone.
3. **Producto nuevo con la marca y referencia de otro** (1.3.7 paso 4.6). Si ya existe un
   producto con esa marca y referencia y **otro** `nombre_clave`, E-REG-26 en vez de reutilizarlo
   en silencio. `CrearVarianteDialog` lo avisa antes con `productoQueChoca` (dominio).
4. **Cabecera del borrador de la cola** (1.3.7 paso 1). En el `UPDATE`, `concepto`, `notas`,
   `irpf`, `gasto_id`, `nota_descuadre` y `forma_pago` que **no vienen** en el JSON conservan lo que
   había; si vienen (aunque sea nulos), mandan. El servidor no rellena con nulo o 0 lo que la
   pantalla no manda (en `RegistroCompra` esas claves son opcionales).
5. **Devolución de cliente a coste 0** (1.3.4 paso 3). La condición de la media es `cantidad > 0
AND (coste_unitario > 0 OR motivo IN ('compra', 'devolucion_cliente') OR fusión)`: la
   devolución recalcula la media al coste resuelto aunque sea 0, y el libro y la caché no se
   separan.
6. **Fusión con existencias negativas** (1.3.9 paso 2). Con `q < 0`, los dos ajustes van al coste
   medio del **destino** (la salida es la del destino y toda salida sale a su coste medio): suman 0.
7. **Coste congelado al reescribir líneas** (1.3.6). Guardar un presupuesto o pedido borra y
   reinserta sus líneas. La línea que ya existía sin coste se manda con `coste_unit_snapshot =
-1` (`SIN_COSTE_CONGELADO`, `costeAlReescribir` en `src/dominio/stock-textil.ts`) y el trigger
   la deja nula en el `INSERT`. Solo se manda si `escanerAplicado` (sin el trigger, el -1 se
   guardaría tal cual).
8. **Alta de variante con existencias** (1.3.3). `stock_alta_sin_existencias()`, `BEFORE INSERT
ON textil_stock`: cantidad o coste distintos de 0 sin la bandera → E-STK-3.
9. **Valor del almacén, una sola definición** (5, `g_stock_valor`). `resumenStock().valor` (y
   `unidades`) suman **todas** las variantes con su signo, `redondear(cantidad × coste, 2)` cada
   una: la misma cifra que `valorCache` (informe de socios y controles) y que el libro salvo
   redondeos y entradas en saldo negativo. `textil_stock_retirar()` ya no desactiva una variante
   con unidades (E-STK-4): primero salen por el libro (merma, ajuste o fusión) y pasan por
   Resultados. El pie de la tabla de Stock (`totalesStock`) sigue contando las negativas como 0,
   como dice su explicación.
10. **Página «Almacén» del informe de socios**. Las mermas y ajustes restan en Gerencia ›
    Resultados (A), no en el «Beneficio» del informe (margen − gastos fijos): la tarjeta y una
    nota lo dicen.
11. **Duplicados en Textil › Compras** (3.3). La revisión compara con **todas** las compras
    (`listCompras({ soloTextil: false })`, la misma consulta de la pantalla general), no solo las
    textil.
12. **Reintento de «Nuevo artículo» con producto nuevo** (Stock). Si la variante falla después de
    crear el producto, el reintento reutiliza ese producto y la lista de productos se refresca.
13. **Signo de portes y descuentos en el dominio** (2.3). `repartirCostes` da E-REG-13 como la
    base, y la revisión no deja registrar.
14. **Camino viejo con portes casados** (3.2). Sin la migración de reglas, una línea que no es
    artículo **casada** con una variante ya no bloquea: se guarda sin tipo y entra como artículo,
    como antes de esta obra (la revisión de siempre obliga a casar todas las líneas).
15. **Cantidad 0 en una línea que no es artículo**. La revisión textil lo dice en «pendientes» y
    el esquema de zod tiene mensaje en castellano.

La reversión de 20261028100200 quita también `stock_alta_sin_existencias` y repone
`textil_stock_retirar()` tal cual estaba en 20260903200000.
