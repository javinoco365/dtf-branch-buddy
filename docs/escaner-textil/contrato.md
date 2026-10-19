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

| Id  | Invariante                                                                                                                                                                                                                                         | Quién lo garantiza                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| I1  | En una compra textil registrada con el escáner, Σ coste de entrada de sus artículos = base de la factura, **al céntimo**.                                                                                                                          | Dominio calcula (`repartirCostes`), servidor recalcula, SQL comprueba y rechaza. |
| I2  | Toda entrada de stock con motivo `compra` lleva `compra_id` y `compra_linea_id` (FK).                                                                                                                                                              | SQL (CHECK `NOT VALID`, las antiguas quedan como están).                         |
| I3  | `textil_stock.cantidad` y `textil_stock.coste_unitario` solo cambian por movimientos.                                                                                                                                                              | SQL (guardián).                                                                  |
| I4  | Una compra registrada no cambia proveedor, NIF, número, fecha, importes, categoría, gasto ni líneas, no vuelve a borrador y no se borra (las no textil admiten borrado lógico).                                                                    | SQL (triggers).                                                                  |
| I5  | Una devolución de cliente entra al coste al que salió en ese pedido.                                                                                                                                                                               | SQL (`stock_aplicar_movimiento`).                                                |
| I6  | Únicos: proveedor por (empresa, NIF normalizado) o, sin NIF, por (empresa, nombre normalizado); producto por (empresa, marca, referencia); variante activa por (producto, color, talla); EAN por empresa; memoria por (empresa, proveedor, clave). | SQL (índices únicos).                                                            |
| I7  | La base y el dominio normalizan igual (claves de texto, tallas, NIF, memoria).                                                                                                                                                                     | Vectores de prueba compartidos (2.2 y 7.1).                                      |
| I8  | Sin datos no hay cifra: ni precio recomendado, ni coste, ni margen inventados.                                                                                                                                                                     | Dominio devuelve `null`; la interfaz enseña «—» o estado vacío.                  |
| I9  | El valor de un movimiento es `redondear(cantidad × coste_unitario, 2)`; todas las cuentas del almacén suman esos valores.                                                                                                                          | Dominio (`valorMovimiento`).                                                     |

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
   y va entero dentro de `BEGIN … ROLLBACK`.

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
    WHEN public.textil_clave(_descripcion) <> '' THEN 'd:' || public.textil_clave(_descripcion)
    ELSE '' END
$$;
```

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

| Columna       | Tipo                                                                 | Notas                                                              |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `producto_id` | `UUID REFERENCES textil_productos(id) ON DELETE RESTRICT`            | nulo aquí; `NOT NULL` en la migración de reglas                    |
| `ean`         | `TEXT`                                                               | CHECK `textil_stock_ean_formato` `ean IS NULL OR ean ~ '^([0-9]{8} | [0-9]{12,14})$'` (el dígito de control lo valida el dominio) |
| `repetida`    | `BOOLEAN NOT NULL DEFAULT false`                                     | duplicado heredado: no se casa, no se vende, se fusiona            |
| `color_clave` | `TEXT GENERATED ALWAYS AS (public.textil_clave(color)) STORED`       |                                                                    |
| `talla_clave` | `TEXT GENERATED ALWAYS AS (public.textil_clave_talla(talla)) STORED` |                                                                    |

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
- `fecha DATE` (**sin** valor por defecto en el `ADD COLUMN`: las filas viejas quedan en nulo y
  se leen por su `created_at`; las nuevas las rellena el trigger, 1.3.4).
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
  `clave = textil_clave_memoria(NULL, NULL, NULL, descripcion)`; por
  `(empresa_id, proveedor_id, clave)` gana la variante de la compra más reciente;
  `veces` = cuántas líneas de ese proveedor con esa clave fueron a esa variante;
  `origen = 'migracion'`; `ON CONFLICT DO NOTHING`.

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

Función `public.compra_registrada_cabecera()` (`plpgsql`, `SET search_path = public`), usada por
dos triggers:

- `textil_compras_registrada_inmutable AFTER UPDATE ON textil_compras FOR EACH ROW` (AFTER para
  ver ya calculadas las columnas generadas).
- `textil_compras_registrada_no_se_borra BEFORE DELETE ON textil_compras FOR EACH ROW`.

Lógica:

```text
DELETE: si OLD.estado = 'registrada' → error E-CAB-1. Si no, RETURN OLD.
UPDATE: si OLD.estado <> 'registrada' → RETURN NEW (borrador: todo se puede).
        si NEW.estado <> 'registrada' → error E-CAB-2.
        v_viejo := to_jsonb(OLD); v_nuevo := to_jsonb(NEW);
        para cada k en {empresa_id, proveedor, nif_proveedor, numero, fecha, base, iva, irpf,
                        total, categoria, gasto_id, lectura_ia, cuota_iva, cuota_irpf, liquido}:
          si (v_viejo -> k) IS DISTINCT FROM (v_nuevo -> k) → error E-CAB-3 con k.
        proveedor_id, fichero_ruta, fichero_huella: solo de nulo a un valor (si no, E-CAB-3).
        borrada_en: si OLD.categoria = 'textil' y cambia → E-CAB-4;
                    si pasa de un valor a nulo → E-CAB-5.
        RETURN NEW.
```

Lo que sí cambia en una registrada: `estado_pago`, `fecha_pago`, `forma_pago`, `notas`,
`revision`, `revision_motivo`, `confianza`, `tipo_iva`/`tipo_irpf` **solo si no cambian las
cuotas** (así pasa la reaplicación de `C2`, cuando las cuotas aún no existen), `updated_at`, y
`borrada_en` de nulo a fecha en las no textil.

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
     movimientos `venta` de **ese pedido y esa variante**; si no hay ventas o no hay pedido, el
     coste medio vigente.
   - `motivo = 'ajuste_inventario'`, `cantidad > 0`, `coste_unitario = 0`: el coste medio
     vigente.
3. Recalcular la media cuando `cantidad > 0 AND (coste_unitario > 0 OR motivo = 'compra')`. Una
   compra a coste 0 (regalo, 100 % de descuento) **sí** baja la media. Con saldo ≤ 0, manda la
   entrada (como hoy).
4. Salidas con coste 0: congelan el coste medio vigente (como hoy).

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
- UPDATE: si `OLD.coste_unit_snapshot IS NOT NULL AND NEW.stock_id IS NOT DISTINCT FROM
OLD.stock_id` → se conserva el de `OLD`. Si cambia la variante, se toma el de la nueva.

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
'registrada'` → E-REG-4. `fecha` nula → E-REG-5. Se escribe la cabecera (UPDATE o INSERT) en
   `estado = 'borrador'`.
2. **Proveedor.** Con `proveedor_id`: tiene que ser de la empresa (si no, E-REG-6). Sin él: por
   `nif_clave(nif_proveedor)` si no es `''`; si no, por `textil_clave(proveedor)` entre los sin
   NIF; si no existe, se crea (`origen = 'escaner'`, `nombre` = texto de la factura o el NIF;
   `ON CONFLICT DO NOTHING` y se vuelve a buscar). Categoría `textil` sin proveedor posible →
   E-REG-7. En otras categorías puede quedar nulo.
3. **Líneas.** `DELETE` de las líneas del borrador e `INSERT` de `lineas[]` con
   `orden = posición` (0…n−1) y todas las columnas de 1.1.6. «Línea N» en los mensajes es
   `orden + 1`. Fuera de textil, `stock_id`, `nueva_variante`, `unidades_stock` y `coste_*` se
   ignoran (nulos).
4. **Solo `categoria = 'textil'`.**
   1. Al menos un `articulo` → si no, E-REG-8.
   2. Por cada artículo: `importe < 0` → E-REG-9; `unidades_stock` ≠ `cantidad ×
unidades_por_pack`, no entero o ≤ 0 → E-REG-10; `coste_total_entrada` o
      `coste_unitario_entrada` nulos o < 0 → E-REG-11;
      `abs(unidades_stock × coste_unitario_entrada − coste_total_entrada) >= 0.005` → E-REG-12.
   3. `porte` con `importe < 0` o `descuento` con `importe > 0` → E-REG-13. Las líneas que no son
      artículo nunca llevan variante (se ignoran `stock_id` y `nueva_variante`).
   4. `abs(Σ importe de todas las líneas − base) > 0.02` → E-REG-14.
   5. `Σ coste_total_entrada de los artículos <> round(base, 2)` → E-REG-15 (I1).
   6. Variante de cada artículo:
      - con `stock_id`: tiene que existir, ser de la empresa (E-REG-16), estar activa (E-REG-17)
        y no ser repetida (E-REG-18);
      - sin `stock_id` y con `nueva_variante`: producto = `nueva_variante.producto_id` (de la
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
   9. **Memoria:** por artículo con `clave = textil_clave_memoria(referencia, color, talla,
descripcion) <> ''` y proveedor: `INSERT … ON CONFLICT (empresa_id, proveedor_id, clave) DO
UPDATE SET veces = CASE WHEN misma variante THEN veces + 1 ELSE 1 END, stock_id,
unidades_por_pack, ultima_compra_id, origen = 'escaner', updated_at = now()`.
5. **Registrar.** `UPDATE textil_compras SET estado = 'registrada', revision = 'revisada',
revision_motivo = NULL, proveedor_id = v_proveedor`. Si salta `unique_violation` (factura ya
   registrada) → E-REG-21.
6. **Devuelve** `{"id", "movidas", "variantes_creadas", "aprendidas", "proveedor_id",
"proveedor_nuevo"}`.

#### 1.3.8 `public.textil_compra_registrar(_compra_id UUID) RETURNS INT` (versión nueva)

Misma firma, mismos permisos (`authenticated`, `service_role`). Es el camino viejo (sin
reparto) y se mantiene por compatibilidad y por las pruebas viejas:

- Bloquea, falla si ya está registrada (como hoy).
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
4. `textil_pedido_items` y `textil_presupuesto_items` con `stock_id = origen` → destino;
   `textil_referencias_proveedor` igual. Las líneas de compras registradas y de facturas no se
   tocan (son historia).
5. Si el destino no tiene EAN y el origen sí, pasa (primero se quita del origen).
6. Origen: `activa = false`, `repetida = false`.
7. Devuelve `{"unidades": q, "reservas": n, "lineas": n}`.

#### 1.3.10 `public.escaner_textil_version() RETURNS INT`

`LANGUAGE sql STABLE`, devuelve `1`. `GRANT EXECUTE … TO authenticated, service_role`. Es la
última sentencia de la migración: si existe, las tres están aplicadas. La usa
`escanerAplicado()` (3.1).

### 1.4 Errores (mensaje exacto, en castellano)

`%` se sustituye por el dato. Código entre paréntesis.

| Id       | Mensaje                                                                                                                                                        | Código             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| E-CAB-1  | `La factura % ya está registrada y no se borra. Si sobra, avisa: se corrige con una rectificativa del proveedor o, si es textil, con un ajuste de inventario.` | restrict_violation |
| E-CAB-2  | `La factura % ya está registrada: no vuelve a borrador.`                                                                                                       | restrict_violation |
| E-CAB-3  | `La factura % ya está registrada: «%» no se puede cambiar.`                                                                                                    | restrict_violation |
| E-CAB-4  | `La compra textil % movió stock y no se borra: para corregir, haz un ajuste de inventario.`                                                                    | restrict_violation |
| E-CAB-5  | `Una factura borrada no vuelve a contar.`                                                                                                                      | restrict_violation |
| E-STK-1  | `El coste medio no se escribe a mano: lo calcula el libro de movimientos. Para corregirlo, anota un ajuste de inventario.`                                     | restrict_violation |
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
| E-FUS-1  | `No se fusiona una variante consigo misma.`                                                                                                                    | 22023              |
| E-FUS-2  | `Las dos variantes tienen que ser de la misma empresa.`                                                                                                        | 42501              |
| E-FUS-3  | `La variante de destino tiene que estar activa y no repetida.`                                                                                                 | restrict_violation |

### 1.5 Cómo deshacerlo

Tres ficheros en `supabase/reversiones/`, **en orden inverso**, cada uno en `BEGIN … COMMIT`.
Solo con autorización expresa de Javier (borran tablas y columnas).

1. `supabase/reversiones/20261028100200_escaner_textil_reglas.sql`: quita
   `escaner_textil_version()`, `textil_compra_guardar_y_registrar(jsonb, uuid)`,
   `textil_stock_fusionar(uuid, uuid, uuid)`, los triggers y funciones de 1.3.1, 1.3.2 y 1.3.6,
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
   `20260903260000_compras_textil.sql`; quita las columnas nuevas (1.1.4, 1.1.6, 1.1.7, 1.1.8),
   la restricción `compra_linea_id_compra`, las tablas `textil_referencias_proveedor`,
   `textil_productos` y `proveedores` y las cuatro funciones de 1.1.1.

Qué se pierde al revertir: el catálogo de productos y proveedores, la memoria, el tipo, la
referencia, el color, la talla y el EAN de las líneas, el enlace movimiento → compra, la fecha
de los movimientos y el coste congelado de las líneas de presupuesto y pedido. Qué **no** se
pierde: las unidades y el coste medio del stock, los movimientos y las compras registradas.

---

## 2. Dominio puro (`src/dominio/`)

Todo sin red ni base de datos, con pruebas `vitest` en `<fichero>.test.ts`. Se importa solo de
otros módulos de dominio (`importes.ts`, `fecha-documento.ts`, `compras.ts`…). Nombres de
funciones y tipos **exactos**: los usan los otros equipos.

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
```

### 2.2 `normalizar-textil.ts` (nuevo)

```ts
export function claveTexto(t: string | null | undefined): string; // = textil_clave
export function claveTalla(t: string | null | undefined): string; // = textil_clave_talla
export function normalizarNif(t: string | null | undefined): string; // = nif_clave
export function claveMemoria(l: {
  referencia: string | null | undefined;
  color: string | null | undefined;
  talla: string | null | undefined;
  descripcion: string | null | undefined;
}): string; // = textil_clave_memoria
/** Solo cifras; null si queda vacío. No valida. */
export function cifrasEan(t: string | null | undefined): string | null;
/** GTIN-8/12/13/14 con dígito de control correcto; si no, null. */
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

| Función       | Entrada                                                                   | Salida                    |
| ------------- | ------------------------------------------------------------------------- | ------------------------- |
| claveTexto    | `"  Camiseta Básica  Ñandú "`                                             | `"camisetabasicanandu"`   |
| claveTexto    | `null`                                                                    | `""`                      |
| claveTexto    | `"B&C #E190"`                                                             | `"bce190"`                |
| claveTalla    | `"xxl"`                                                                   | `"2XL"`                   |
| claveTalla    | `"Talla M"`                                                               | `"M"`                     |
| claveTalla    | `"3-4 años"`                                                              | `"34"`                    |
| claveTalla    | `"T.U."`                                                                  | `"UNICA"`                 |
| claveTalla    | `"One Size"`                                                              | `"UNICA"`                 |
| claveTalla    | `"Única"`                                                                 | `"UNICA"`                 |
| claveTalla    | `"XXXL"`                                                                  | `"3XL"`                   |
| claveTalla    | `"2XL"`                                                                   | `"2XL"`                   |
| claveTalla    | `null`                                                                    | `""`                      |
| normalizarNif | `"es-b12.345.678"`                                                        | `"B12345678"`             |
| normalizarNif | `"B-12345678"`                                                            | `"B12345678"`             |
| normalizarNif | `" 12345678z "`                                                           | `"12345678Z"`             |
| normalizarNif | `"ESX1234567L"`                                                           | `"X1234567L"`             |
| normalizarNif | `null`                                                                    | `""`                      |
| claveMemoria  | ref `"5000"`, color `"Black"`, talla `"XXL"`, desc `"Camiseta"`           | `"r:5000\|black\|2XL"`    |
| claveMemoria  | ref `null`, color `"Negro"`, talla `"L"`, desc `"Camiseta Heavy Negro L"` | `"d:camisetaheavynegrol"` |
| claveMemoria  | todo vacío                                                                | `""`                      |

Pruebas de `normalizar-textil.test.ts`: la tabla entera; EAN `4006381333931` y `96385074`
válidos, `4006381333932` no; `"4006 3813 3393 1"` → `"4006381333931"`; `tipoDeLinea` con tipo
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
  | { ok: false; errores: { linea: number | null; mensaje: string }[] };
export function unidadesDeLinea(cantidad: number, unidadesPorPack: number): number;
export function repartirCostes(
  lineas: readonly LineaParaRepartir[],
  base: number,
): ResultadoReparto;
/** Aplica el reparto a las líneas de registro (rellena unidades_stock y coste_*; null en lo que no es artículo). */
export function conCostesDeEntrada(
  lineas: readonly LineaRegistro[],
  base: number,
):
  | { ok: true; lineas: LineaRegistro[] }
  | { ok: false; errores: { linea: number | null; mensaje: string }[] };
```

Algoritmo, todo en céntimos enteros:

1. Artículos = líneas `articulo`. Ninguno → error (`linea: null`) con el texto de E-REG-8.
2. Cada artículo: `importe < 0` → texto de E-REG-9; `unidades = redondear(cantidad ×
unidades_por_pack, 6)` no entera o ≤ 0 → texto de E-REG-10.
3. `baseC = round(base × 100)`, `sumaC = Σ round(importe × 100)` de todas las líneas;
   `|baseC − sumaC| > 2` → texto de E-REG-14.
4. `Sa = Σ` céntimos de los artículos; `R = baseC − Sa` (portes + descuentos + otros + redondeo).
5. Pesos `w_i` = céntimos del artículo si `Sa > 0` (`criterio "importe"`); si `Sa = 0`, sus
   unidades (`criterio "unidades"`).
6. Mayor resto sobre `|R|`: `parte_i = floor(|R| × w_i / W)`; lo que falta (`|R| − Σ parte_i`)
   se reparte de céntimo en céntimo a los de mayor resto (`|R| × w_i mod W`); empate: mayor
   `w_i`, luego menor `indice`. Se aplica el signo de `R`.
7. `coste_total_i = (céntimos_i + parte_i) / 100`; si < 0 → error «Línea N: el descuento deja
   el artículo en negativo; revisa el descuento.».
8. `coste_unitario_i = redondear(coste_total_i / unidades_i, DECIMALES_COSTE_ENTRADA)`.
9. Garantiza `Σ coste_total = base` en céntimos (I1) y `|unidades × coste_unitario −
coste_total| < 0,005`.

Los mensajes de error son los de 1.4 (mismo texto, con los números formateados con coma y dos
decimales a mano en dominio: `numeroEs(n)` interno; nada de `src/lib/format.ts`).

Pruebas obligatorias:

- R1: artículos 60,00 € (6 uds) y 40,00 € (2 packs × 2 = 4 uds), porte 10,00, descuento −5,00,
  base 105,00 → repartido 3,00 y 2,00; costes totales 63,00 y 42,00; unitarios 10,5 y 10,5.
- R2: tres artículos de 10,00 y porte 1,00 → 10,34 / 10,33 / 10,33 (el céntimo al primero).
- R3: artículos 10,00 y 20,00, descuento −1,00 → 9,67 y 19,33.
- R4: base 0,01 por encima de las líneas → se reparte y Σ = base.
- R5: base 0,50 por encima → error con el texto de E-REG-14.
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
   utilizable → `casada / memoria` con su `unidades_por_pack`. Si apunta a una variante
   inactiva o repetida, se sigue con el paso siguiente.
3. **EAN**: `normalizarEan(linea.ean)` válido y una variante con ese `ean` → `casada / ean`.
4. **Referencia**: `claveTexto(referencia)` no vacía y: una variante con
   `claveTexto(sku)` igual → `casada / referencia`; si no, variantes cuyo
   `claveTexto(producto.referencia)` coincide y además `mismoColor` y `claveTalla` iguales:
   exactamente una → `casada / referencia`; más de una → `sugerida` con ellas.
5. **Parecido** (solo sugerencia, nunca casa sola): `puntos = round(60 × jaccard(palabras de
descripción + marca + modelo + referencia, palabras de producto.marca + producto.referencia +
producto.nombre + nombre + sku)) + (mismoColor ? 20 : 0) + (tallas iguales ? 20 : 0)`;
   candidatas con `jaccard > 0` y `puntos ≥ 40`, de más a menos puntos (empate por etiqueta),
   máximo 3 → `sugerida`; ninguna → `sin_casar`.

Pruebas: memoria gana a EAN; memoria a variante inactiva cae a EAN; EAN; referencia por SKU;
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
  porcentaje: number | null; // margen / base × 100; null si base 0
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
  /** mermas + devolucionesProveedor − ajustes (valor): lo que cuesta en Resultados. */
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

Pruebas: identidad con los siete motivos; inicial = lo anterior a `desde`; movimiento sin
`fecha` con `created_at = "2026-10-31T23:30:00Z"` cuenta el `2026-11-01`; `perdidas` con merma
de 2 a 4 € (+8), devolución a proveedor de 1 a 5 € (+5) y ajuste +1 a 3 € (−3) = 10;
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
  todoEnCero: boolean; // descuadres 0, diferencia 0 y las dos de arriba 0
};
export function resumenControles(
  c: ControlCompras | null,
  variantes: number | null,
  reservas: number | null,
): ResumenControles;
```

Pruebas: una que cuadra, una con 0,01 de diferencia, una sin enlace (no cuenta como
descuadre), una borrada y una no textil fuera, `todoEnCero`.

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
/** Registradas, sin borrar y con estado_pago "pendiente"; importe = liquido ?? total; por proveedor_id, si no por NIF normalizado, si no por nombre; antigüedad desde la fecha. */
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
  `packDesdeTexto(descripcion)` (con `pack_deducido: true`), si no 1; en líneas que no son
  artículo con cantidad nula o 0: `cantidad 1` y `precio_unitario = importe`. `revisarCompra`
  avisa «Línea N: el EAN X no es válido.» y «Línea N: pack deducido del texto (X uds): compruébalo.».
  Pruebas nuevas para todo esto; las de antes siguen pasando.
- `cola-compras.ts`: `esquemaLectura.lineas[]` añade `tipo: z.enum(TIPOS_LINEA_COMPRA)` y
  `referencia`, `marca`, `modelo`, `color`, `talla`, `ean`, `unidades_por_pack` como `texto`
  (string o null). `ESQUEMA_LECTURA_JSON`: esas ocho claves en `required` y en `properties`
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
  "Falta aplicar la migración 20261028100000 (escáner textil: esquema, datos y reglas). " +
  "Hasta entonces, Textil › Compras funciona como antes: casado a mano y sin repartir portes.";
/** true si existe escaner_textil_version(); false si falta la migración; lanza otros errores. */
export async function escanerAplicado(cliente: unknown): Promise<boolean>;
```

Se importa **solo** de forma estática (desde `*.functions.ts` y desde `gerencia.ts`).

### 3.2 `src/lib/compras.functions.ts`

- Refactor interno: `guardarBorrador(supabase, data)` y `registrarBorrador(supabase, id)` con la
  lógica actual de `guardarCompra` y `registrarCompra`; las dos server functions viejas las
  usan y siguen igual.
- **Nueva** `guardarYRegistrarCompra` (POST). Entrada (zod, primera línea del validador):

  ```ts
  const nuevaVarianteSchema = z.object({
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
  3. Si `categoria === "textil"`: `conCostesDeEntrada(lineas, base)`; si no `ok`, error con el
     primer mensaje. **El reparto del servidor es el que manda**; el del navegador solo se
     enseña.
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
- `listCompras`: devuelve además `escaner: boolean` (`escanerAplicado(context.supabase)`).

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

| Función                 | Método | Entrada                                                                                                                               | Salida                                                                                                                                                                                                                                             |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estadoEscanerTextil`   | GET    | —                                                                                                                                     | `{ aplicada: boolean }`                                                                                                                                                                                                                            |
| `leerMemoriaEscaner`    | POST   | `{ proveedor_id?: uuid \| null, nif?: string \| null, proveedor?: string \| null }`                                                   | `{ disponible: boolean; proveedor: (Proveedor & { compras: number }) \| null; entradas: EntradaMemoria[] }` (resuelve por id; si no, por `nif_clave = normalizarNif(nif)`; si no, por `nombre_clave = claveTexto(proveedor)` con `nif_clave = ''`) |
| `olvidarMemoriaEscaner` | POST   | `{ id: uuid }`                                                                                                                        | `{ ok: true }` (DELETE con `context.supabase`)                                                                                                                                                                                                     |
| `listProveedores`       | GET    | —                                                                                                                                     | `{ disponible: boolean; proveedores: Proveedor[] }`                                                                                                                                                                                                |
| `listProductosTextil`   | GET    | —                                                                                                                                     | `{ disponible: boolean; productos: ProductoTextil[] }`                                                                                                                                                                                             |
| `guardarProductoTextil` | POST   | `{ id?: uuid, marca: string \| null, referencia: string \| null, nombre: string min 1, categoria: string \| null, activo?: boolean }` | `{ id }`; `unique_violation` → «Ya existe un producto con esa marca y referencia (o ese nombre).»                                                                                                                                                  |
| `fusionarVariantes`     | POST   | `{ origen: uuid, destino: uuid }`                                                                                                     | resultado de `textil_stock_fusionar` vía `adminComoUsuario(context.userId)` con `_usuario_id`; sin la función → error `AVISO_MIGRACION_ESCANER`                                                                                                    |

### 3.6 `src/lib/textil.functions.ts`

- `listStock`: `select("*, producto:textil_productos(id, marca, referencia, nombre, categoria, activo)")`;
  si el error es `PGRST200`, `faltaLaColumna` o `faltaLaTabla`, vuelve a `select("*")`. Sigue
  devolviendo todas (activas y no); el filtro lo hace la interfaz.
- `upsertStockItem`: el esquema acepta además `producto_id: uuid nullable optional` y
  `ean: string nullable optional` (normalizado con `normalizarEan`; escrito y no válido → error
  «El EAN X no es válido.»). Al **editar** nunca manda `cantidad` ni `coste_unitario`. Si el
  `update`/`insert` falla con `faltaLaColumna`, se repite sin `producto_id` ni `ean`. Al crear,
  igual que hoy (movimiento `inicial` si hay existencias). `unique_violation` del EAN → «Ese EAN
  ya lo tiene otra variante.».
- `registrarMovimientoStock`: `motivo` ∈ {`merma`, `ajuste_inventario`, `devolucion_cliente`,
  `devolucion_proveedor`} (fuera `compra`); acepta `compra_id: uuid nullable optional` (solo con
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

**Flujo: revisar y registrar una factura textil**

1. Pulsar «Revisar» en la cola (o «A mano»). Se abre `RevisarCompraTextil` (diálogo ancho).
2. Arriba: proveedor y NIF leídos (editables), número, fecha, base, tipo de IVA, total; si
   `leerMemoriaEscaner` lo encuentra: «Proveedor conocido: X · N compras · M referencias
   aprendidas»; si no: «Proveedor nuevo: se dará de alta al registrar». Los motivos de revisión y
   los duplicados, como en `RevisarCompra`.
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
  parámetro (`navigate({ to: ".", search: …, replace: true })`). Ids que no existan se ignoran
  con un aviso.

### 4.5 Textil › Stock (`src/routes/panel/textil/stock.tsx`)

- Columnas nuevas: Producto (marca · referencia) y EAN; badge «Repetida» con acción
  «Fusionar con…» (elige destino entre las de su mismo producto, color y talla; confirma; llama a
  `fusionarVariantes`).
- Selección: casilla por fila. Con alguna marcada, barra «N variantes · Crear presupuesto ·
  Crear pedido · Quitar selección» → navega a `/panel/textil/presupuestos` o
  `/panel/textil/pedidos` con `search: { desde_stock: ids.join(",") }`.
- `StockDialog`: producto (existente o nuevo, con `guardarProductoTextil` antes de guardar la
  variante), EAN, precio de venta con «Recomendado…» (ⓘ `g_precio_recomendado`). Al **editar**,
  el coste medio se ve pero **no se edita** («Lo calcula el libro de movimientos»).
- `EntradaDialog` (entrada por compra) **desaparece**. En su lugar, «Otro movimiento»:
  merma, devolución a proveedor (con la compra textil del proveedor, opcional), devolución de
  cliente sin pedido y ajuste; cantidad positiva y el signo lo pone el motivo; sin coste (lo
  congela la base). Debajo: «Las entradas por compra se registran con su factura en Textil ›
  Compras».
- Sin migración: sin columnas Producto/EAN/Repetida ni fusión; con el aviso.

---

## 5. Cuentas

### 5.1 Datos (`src/lib/gerencia.ts`, navegador, `tabla()` + `leerTodas`)

| Gancho                               | Qué lee                                                                                                                                                                                                                                                                   | Tolerancia                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `useMovimientosAlmacen(hasta: Date)` | **Todos** los movimientos (paginado): `stock_id, motivo, cantidad, coste_unitario, created_at, fecha, compra_id`; el filtro por fecha efectiva lo hace el dominio. Devuelve `{ movimientos: MovimientoAlmacen[]; conFecha: boolean }`.                                    | `faltaLaColumna` → sin `fecha` ni `compra_id`, `conFecha: false`; `faltaLaTabla` → `null`. |
| `useControlesAlmacen(rango)`         | Compras textil registradas con fecha en el rango (`id, numero, proveedor, fecha, base, categoria, estado` y `borrada_en` si existe); entradas `motivo = 'compra'` con `compra_id` en esas; `rpc('stock_descuadres')` y `rpc('stock_reservas_descuadres')` (contar filas). | Sin `compra_id`: `{ disponible: false }` y el aviso.                                       |
| `usePagosProveedores()`              | Compras con `estado = 'registrada'` y `estado_pago = 'pendiente'` (cualquier fecha y categoría): `id, proveedor, nif_proveedor, proveedor_id, numero, fecha, liquido, total, estado, estado_pago, borrada_en`.                                                            | Sin `proveedor_id`, sin él; sin `estado_pago` (`20261014100000`), `null`.                  |

### 5.2 Dónde va cada cifra

| Sitio                                                                                                     | Qué se ve                                                                                                                                                                                                                  | Cálculo                                                      | ⓘ                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Gerencia › Textil, tarjeta nueva «Cuenta del almacén»                                                     | Tabla unidades / valor: Existencias al «desde» · + Compras · + Altas con existencias · + Devoluciones de clientes · − Coste de lo vendido · − Mermas · − Devoluciones a proveedores · ± Ajustes · = Existencias al «hasta» | `cuentaAlmacen(movs, desde, hasta)`                          | `g_almacen_cuenta`                |
| Gerencia › Textil, tarjeta nueva «Controles del almacén»                                                  | Tres filas con ✓ o la cifra en rojo: compras textil frente a entradas (diferencia €, nº con descuadre, nº «anteriores al enlace»), variantes descuadradas, reservas descuadradas; lista de las compras con descuadre       | `controlComprasEntradas` + `resumenControles`                | `g_almacen_controles`             |
| Gerencia › Textil, KPI «Valor del almacén»                                                                | Igual que hoy (caché, hoy)                                                                                                                                                                                                 | `resumenStock`                                               | `g_stock_valor` (texto ampliado)  |
| Gerencia › Resultados, fila nueva «Mermas y ajustes de almacén» (detrás de «Amortizaciones», solo si ≠ 0) | Resta en A y en el total; 0 en B                                                                                                                                                                                           | `costeAlmacenPeriodo` → `resultadosPorGrupo({ …, almacen })` | `g_almacen_perdidas`              |
| Gerencia › Tesorería, tarjeta nueva «Pagos pendientes a proveedores»                                      | KPI total y nº de facturas; tabla por proveedor (top 10 + «resto»); tramos 0–30 / 31–60 / 61–90 / +90 días; enlace «Ver facturas de compra» a `/panel/compras`                                                             | `pagosPendientesProveedores`                                 | `g_pagos_proveedores`             |
| Informe PDF de socios, página nueva «Almacén» (después de «Gastos del periodo»)                           | La cuenta del almacén del periodo, el valor de hoy, los controles con ✓/✗ y los pagos pendientes a proveedores. Sin datos: «Sin datos del almacén para este periodo.»                                                      | `InformeAlmacen`                                             | textos de las mismas definiciones |

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
  que: "Lo que se ha perdido o encontrado en el almacén textil: mermas, recuentos y devoluciones a proveedores.",
  calculo: "Mermas + devoluciones a proveedores − ajustes de inventario, cada movimiento a su coste congelado: un recuento que encuentra prendas resta coste y uno que no las encuentra lo suma. Va en A: la ropa se compró con factura.",
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

| Equipo         | Ficheros (exactos)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SQL**        | `supabase/migrations/20261028100000_escaner_textil_esquema.sql` (nuevo) · `supabase/migrations/20261028100100_escaner_textil_datos.sql` (nuevo) · `supabase/migrations/20261028100200_escaner_textil_reglas.sql` (nuevo) · `supabase/reversiones/20261028100000_escaner_textil_esquema.sql` (nuevo) · `supabase/reversiones/20261028100100_escaner_textil_datos.sql` (nuevo) · `supabase/reversiones/20261028100200_escaner_textil_reglas.sql` (nuevo) · `supabase/pruebas/C18_escaner_textil.sql` (nuevo) · `supabase/pruebas/probar-migraciones.sh` · `supabase/pruebas/60_stock_movimientos.sql` · `supabase/pruebas/70_stock_reservas.sql`                                       |
| **DOMINIO**    | `src/dominio/tipos-textil.ts` (nuevo) · `src/dominio/normalizar-textil.ts` + `.test.ts` (nuevos) · `src/dominio/reparto-compra.ts` + `.test.ts` (nuevos) · `src/dominio/casado-textil.ts` + `.test.ts` (nuevos) · `src/dominio/stock-textil.ts` + `.test.ts` (nuevos) · `src/dominio/precio-recomendado.ts` + `.test.ts` (nuevos) · `src/dominio/cuenta-almacen.ts` + `.test.ts` (nuevos) · `src/dominio/controles-almacen.ts` + `.test.ts` (nuevos) · `src/dominio/pagos-proveedores.ts` + `.test.ts` (nuevos) · `src/dominio/factura-compra.ts` + `factura-compra.test.ts` · `src/dominio/cola-compras.ts` + `cola-compras.test.ts` · `src/dominio/compras.ts` + `compras.test.ts` |
| **SERVIDOR**   | `src/lib/escaner-textil.ts` (nuevo) · `src/lib/escaner-textil.functions.ts` (nuevo) · `src/lib/compras.functions.ts` · `src/lib/cola-compras.server.ts` · `src/lib/lector-facturas.server.ts` · `src/lib/textil.functions.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **INTERFAZ**   | `src/components/compras/RevisarCompraTextil.tsx` (nuevo) · `src/components/textil/CrearVarianteDialog.tsx` (nuevo) · `src/components/textil/SelectorStockTextil.tsx` (nuevo) · `src/components/compras/PaginaCompras.tsx` · `src/components/compras/SubidaFacturas.tsx` · `src/components/compras/ColaRevision.tsx` · `src/components/textil/LineasEditor.tsx` · `src/routes/panel/textil/stock.tsx` · `src/routes/panel/textil/presupuestos.tsx` · `src/routes/panel/textil/pedidos.tsx`                                                                                                                                                                                            |
| **CUENTAS**    | `src/lib/gerencia.ts` · `src/components/gerencia/Textil.tsx` · `src/components/gerencia/Resultados.tsx` · `src/components/gerencia/Tesoreria.tsx` · `src/components/gerencia/resumen-diario/ResumenDiario.tsx` · `src/lib/pdf-informe-socios.ts` · `src/dominio/definiciones.ts` · `src/dominio/grupos.ts` + `src/dominio/grupos.test.ts`                                                                                                                                                                                                                                                                                                                                            |
| **ARQUITECTO** | `docs/escaner-textil/contrato.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Cambios en ficheros de pruebas viejos (SQL): en `60_stock_movimientos.sql` (casos 1 y 2) y
`70_stock_reservas.sql` (la entrada inicial) el motivo `'compra'` pasa a `'inicial'` y el texto
«compra» de los mensajes a «entrada»; nada más. Es lo que exige I2.

---

## 7. Plan de pruebas

### 7.1 SQL: `supabase/pruebas/C18_escaner_textil.sql`

En `probar-migraciones.sh`, al final de la lista:
`seccion "Escáner textil: compras, catálogo, stock y cuentas" C18_escaner_textil.sql`.

Estructura como `C17`: `BEGIN;`, `SET client_min_messages = warning;`, `\ir` de las **tres**
migraciones **dos veces** (y en orden), `RESET client_min_messages;`, casos que imprimen
`BIEN  n.` o `MAL   n.`, y `ROLLBACK;` al final. Usuario de prueba en `auth.users` +
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
24. Reversión: aplicar las tres reversiones (200, 100, 000) y después las tres migraciones
    (000, 100, 200) sin error; las columnas vuelven.

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
   aviso (antes daba error).

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
