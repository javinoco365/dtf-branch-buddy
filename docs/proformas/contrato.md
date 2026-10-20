# Contrato de la obra: proformas de proveedor, regularización del stock y líneas por talla

Fuente de verdad para los cuatro equipos (SQL, DOMINIO, SERVIDOR, PANTALLAS) que trabajan a la
vez en la rama `claude/crm-dtf-app-review-ftg3di`. Si el código y este contrato no coinciden,
manda el contrato; si el contrato tiene un hueco o un error, se avisa al arquitecto y **no se
improvisa en el fichero de otro equipo**.

Fecha: 20-10-2026. Migraciones con prefijo `20261029…`.

Lecturas obligatorias antes de empezar: `docs/proformas/decisiones.md` (decisiones de Javier, no
se discuten) y `CLAUDE.md`. El informe `docs/proformas/mapa.md` es orientativo: donde no coincida
con este contrato, manda este contrato (los números de línea del mapa pueden estar desfasados).

---

## 0. Reglas comunes

### 0.1 Decisiones de Javier (resumen; el texto completo está en `decisiones.md`)

1. La IA clasifica cada documento como `factura` o `proforma`; si duda, lo deja vacío y lo dice
   en dudas. La persona lo ve y lo corrige siempre en la revisión.
2. Registrar una **proforma textil mete el stock** por el mismo camino que una factura textil.
3. La proforma **no es documento fiscal**: fuera del IVA (303/111), de Gerencia (compras, gastos,
   amortización), del ZIP de la gestoría y del pie de la lista. Sí cuenta en almacén y tesorería.
4. Pago por adelantado: la proforma se concilia o se marca pagada; pagada y sin factura es un
   **anticipo a proveedor** en Tesorería.
5. Casado 1:1 factura↔proforma, **siempre propuesto, nunca automático**. Al registrar la factura
   casada, en la misma transacción: enlace `proforma_id`; no se vuelve a meter el stock; el pago
   pasa a la factura (los enlaces bancarios se mueven, la factura hereda `estado_pago` /
   `fecha_pago`; si el líquido difiere, el grupo queda en `revisar`); la proforma casada deja de
   salir en pendientes, conciliables y pagos pendientes.
6. Unidades distintas → regularización automática por variante (más → `compra`; menos →
   `devolucion_proveedor`; solo en factura → entra entera; solo en proforma → sale entera). La
   pantalla enseña antes la comparación talla a talla.
7. Coste distinto → coste de la factura: el stock que aún queda de la variante se revaloriza
   con un movimiento nuevo `ajuste_coste` (cantidad 0, con importe), enlazado a la factura. Lo ya
   vendido no se toca; esa parte se anota.
8. Aviso de proforma sin factura **desde el día 1**, sin umbral: Compras (general y textil),
   Gerencia (avisos) y el informe donde salen los controles del almacén.
9. La IA parte una línea del papel con varias tallas en una línea por prenda+color+talla, con
   `linea_papel` (número de la línea del papel de la que sale); las partidas suman exactamente el
   importe de la línea del papel. Sin reparto en el papel, no se inventa: se deja y se dice en
   dudas. Vale para proformas y facturas.

### 0.2 Decisiones del arquitecto tomadas en este contrato (revisables por Javier)

| Id   | Decisión                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | La factura casada **textil sí pasa por el reparto** (`conCostesDeEntrada` en servidor, I1 en SQL) y por el casado de variantes: la regularización compara su coste de entrada por variante con el de la proforma. Lo que se salta es la entrada completa (4.8 de hoy), sustituida por la regularización. La memoria del escáner (4.9) se aprende también con la factura.                                  |
| A2   | Las unidades de la proforma son las de sus entradas `compra` (brutas). Una devolución a proveedor anotada a mano antes de la factura **no** cambia la comparación (espera su abono, como hoy).                                                                                                                                                                                                             |
| A3   | Todos los movimientos de la regularización (`compra`, `devolucion_proveedor`, `ajuste_coste`) llevan `compra_id` = **la factura** y `fecha` = fecha de la factura.                                                                                                                                                                                                                                       |
| A4   | `ajuste_coste`: `cantidad = 0`, `coste_unitario = 0`, importe con signo en la columna nueva `importe_ajuste`. Su valor en el libro es `importe_ajuste`. En la cuenta del almacén suma en la partida **Compras** (valor, 0 unidades) y no cuenta en «pérdidas».                                                                                                                                              |
| A5   | La parte no aplicable (coste de lo ya vendido, devoluciones que salen al coste medio y no al de la proforma, redondeos) se calcula al registrar y se guarda en la factura: `casado_resumen.stock.diferencia_sin_aplicar`. El control del almacén del par la usa para cuadrar al céntimo.                                                                                                               |
| A6   | Una factura casada **no admite borrado lógico** (ni la proforma casada). Deshacer un casado queda fuera de alcance (como deshacer una factura textil registrada).                                                                                                                                                                                                                                        |
| A7   | La proforma casada no admite cambiar `estado_pago`/`fecha_pago` (lo impide SQL): el pago vive en la factura.                                                                                                                                                                                                                                                                                              |
| A8   | `tipo_documento` es `NOT NULL DEFAULT 'factura'`. La duda de la IA no se guarda como nulo: queda en `lectura_ia.tipo_documento = ""` y en `revision_motivo`; la revisión obliga a elegir.                                                                                                                                                                                                                |
| A9   | `banco_documentos()` y `banco_documentos_por_conciliar()` se **recrean** (DROP + CREATE) con una columna final nueva `tipo_documento TEXT` (para la etiqueta «Proforma»). `banco_enlaces()` se reemplaza con la misma firma y `tipo_documento` en el JSON de documentos. La prueba C14 se adapta (sección 1.12).                                                                                                    |
| A10  | La lectura de la IA añade `referencia_proforma` (el n.º de proforma o pedido que cite una factura): ayuda a sugerir el casado. Vive solo en `lectura_ia` (sin columna).                                                                                                                                                                                                                                  |
| A11  | Una proforma textil solo se casa con una factura textil y una no textil con una no textil (pueden cambiar de categoría entre sí dentro de las no textil).                                                                                                                                                                                                                                                 |
| A12  | Sin las migraciones, todo lo de proformas se oculta y sale un aviso ámbar (`AVISO_MIGRACION_PROFORMAS`). El servidor **nunca** manda una proforma ni un `proforma_id` a una base sin la migración (la función vieja los ignoraría en silencio y duplicaría stock).                                                                                                                                            |

### 0.3 Reglas del equipo

- Nada de commit, push ni PR. Nada de aplicar migraciones a una base real.
- `src/routeTree.gen.ts` no se toca. **No se crean rutas** ni componentes nuevos en `src/components/ui/`.
- Cada equipo toca **solo** sus ficheros (sección 6). Nada de `prettier --write` fuera de ellos,
  nada de `git checkout`, `stash` ni `reset`.
- Ningún módulo se importa a la vez de forma estática y con `await import()`
  (`src/arquitectura/importaciones-mixtas.test.ts`): `@/integrations/supabase/client.server` y
  `./cola-compras.server` solo con `await import()` dentro del handler; todo `src/dominio/` y
  `src/lib/escaner-textil.ts`, solo estático.
- Escrituras del servidor con `adminComoUsuario(context.userId)` o con funciones SQL que reciben
  `_usuario_id` y fijan `app.usuario_id`. Lecturas con `context.supabase` (RLS).
- Todo en español. Formato de euros, números y fechas solo con `src/lib/format.ts` (en pantalla y
  PDF). Cálculos (repartos, valores, redondeos, diferencias, puntos) solo en `src/dominio/`.
- No se inventan datos: sin datos, `EstadoVacio`, `null` o «—»; nunca un número de ejemplo.
- La aplicación se despliega **antes** de que Javier aplique las migraciones: todo lo nuevo
  funciona sin ellas (`faltaLaColumna`, `faltaLaFuncion`, `faltaLaTabla` de `src/lib/rpc.ts`).
- Al terminar, cada equipo deja su parte compilando y sus pruebas en verde. La verificación
  conjunta (`npm run verify` y `supabase/pruebas/probar-migraciones.sh`) la hace el orquestador.

### 0.4 Invariantes del conjunto

| Id  | Invariante                                                                                                                                                                                       | Quién                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| P1  | Una proforma registrada nunca suma en IVA, 303/111, Gerencia (compras, gastos, amortizaciones, comparación de consumibles), archivo ni pie de la lista.                                          | Dominio (`importesDeCompra`, `entraEnArchivo`, `totalesCompras`) |
| P2  | Una proforma se casa con **una** factura y una factura con **una** proforma.                                                                                                                     | SQL (índice único + validaciones)                       |
| P3  | El género de un par proforma+factura entra en el libro **una vez**: la proforma lo mete y la factura solo regulariza la diferencia.                                                             | SQL (función de registro; camino viejo bloqueado)       |
| P4  | `proforma_id` y `casado_resumen` solo los escribe la función de registro (SECURITY DEFINER); nunca `authenticated`/`anon`.                                                                        | SQL (trigger)                                           |
| P5  | Tras casar: los enlaces bancarios de la proforma pasan a la factura (UPDATE auditado), con `importe = -liquido` de la factura y `diferencia` recalculada; si ≠ 0, el grupo queda `revisar`.     | SQL                                                     |
| P6  | Una proforma casada no es conciliable, no está pendiente de pago y no sale como anticipo ni en el aviso.                                                                                         | SQL (`banco_documentos`, `compras_proformas_pendientes`) + Dominio |
| P7  | En el par casado: Σ valor de las entradas `compra` de los dos + Σ `importe_ajuste` de la factura + `valor_devoluciones` de la regularización = base de la factura − `diferencia_sin_aplicar`, al céntimo. | SQL calcula; Dominio comprueba (control del almacén)     |
| P8  | Un `ajuste_coste` nunca deja un coste medio negativo y solo existe con existencias (> 0) en la variante.                                                                                       | SQL (función + trigger)                                 |
| P9  | Las partidas de una línea del papel (`linea_papel` igual) suman lo que la línea del papel; si el papel no da el reparto, no se parte.                                                             | IA (instrucciones) + revisión humana                    |
| P10 | El valor de un movimiento es `round(cantidad × coste_unitario, 2)`, salvo `ajuste_coste`, que vale `importe_ajuste` (I9 ampliado).                                                              | Dominio (`valorMovimiento`) y SQL (regularización)      |

---

## 1. SQL

Ficheros (solo `supabase/**`):

- `supabase/migrations/20261029100000_proformas_motivo.sql` — **solo**
  `ALTER TYPE public.stock_motivo ADD VALUE IF NOT EXISTS 'ajuste_coste';` con su cabecera de
  comentario (qué, por qué va sola: un valor de enum nuevo no se puede usar en la transacción que
  lo añade).
- `supabase/migrations/20261029100100_proformas_compras.sql` — todo lo demás, **idempotente y
  autoritativo**: cada CHECK, índice, trigger y función que toca se borra (`IF EXISTS`) y se crea
  de nuevo, para que volver a aplicarlo tras las pruebas que reaplican migraciones viejas (C3,
  C5, C14, C18) deje siempre la versión de este fichero. **Sin `VIEW`s y sin `BEGIN ATOMIC`**
  (que no bloqueen las reversiones de migraciones anteriores que hacen las pruebas).
  **Sin `BEGIN;`/`COMMIT;` propios** (como 20261028100200): C19 lo aplica dentro de su
  transacción y un `COMMIT` del fichero la cerraría antes del `ROLLBACK`. Su primera sentencia
  es una guarda:
  ```sql
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'stock_motivo' AND e.enumlabel = 'ajuste_coste') THEN
      RAISE EXCEPTION 'Aplica antes 20261029100000_proformas_motivo.sql, en una ejecución aparte.';
    END IF;
  END $$;
  ```
  (Si las dos se pegan juntas en el editor SQL de Supabase, van en una sola transacción y el
  CHECK que nombra `ajuste_coste` falla con «unsafe use of new value»: la cabecera de los dos
  ficheros lo dice — **se aplican en dos ejecuciones separadas, primero 100000**.)
- `supabase/reversiones/20261029100100_proformas_compras.sql` y
  `supabase/reversiones/20261029100000_proformas_motivo.sql`.
- `supabase/pruebas/C19_proformas.sql`, registrada en `probar-migraciones.sh`.
- Adaptación de `supabase/pruebas/C14_conciliacion_pendientes.sql` (1.12).

Cabecera del fichero grande como las demás: QUÉ RESUELVE, QUÉ CAMBIA (lista numerada), SIN ESTA
MIGRACIÓN, REVERSIBLE. Termina con `NOTIFY pgrst, 'reload schema';`.

### 1.1 Columnas, CHECKs e índices

**`public.textil_compras`**

| Columna          | Tipo                                                         | Notas                                                                                     |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `tipo_documento` | `TEXT NOT NULL DEFAULT 'factura'`                            | Las filas existentes quedan `factura`.                                                    |
| `proforma_id`    | `UUID REFERENCES public.textil_compras(id) ON DELETE RESTRICT` | En la **factura**: su proforma.                                                         |
| `casado_resumen` | `JSONB`                                                      | En la factura casada: lo que hizo el casado (forma `ResumenCasado`, sección 5.2). Nulo en el resto. |

CHECKs (con `DROP CONSTRAINT IF EXISTS` + `ADD`):

- `compra_tipo_documento`: `tipo_documento IN ('factura', 'proforma')`
- `compra_proforma_solo_factura`: `proforma_id IS NULL OR tipo_documento = 'factura'`
- `compra_proforma_no_ella_misma`: `proforma_id IS NULL OR proforma_id <> id`
- `compra_casado_con_proforma`: `(casado_resumen IS NULL) = (proforma_id IS NULL)`

Índices:

- `textil_compras_proforma_casada_unica`: `CREATE UNIQUE INDEX … ON public.textil_compras (proforma_id) WHERE proforma_id IS NOT NULL;` (P2; sin condición de `borrada_en`: una casada no se borra, A6).
- `textil_compras_proformas_abiertas`: `… (empresa_id, fecha) WHERE tipo_documento = 'proforma' AND estado = 'registrada' AND borrada_en IS NULL;`
- `textil_compras_factura_unica` (mismo nombre, **DROP INDEX IF EXISTS + CREATE**): `UNIQUE (empresa_id, tipo_documento, proveedor_clave, numero_clave) WHERE estado = 'registrada' AND borrada_en IS NULL AND proveedor_clave <> '' AND numero_clave <> ''`. Así una proforma y su factura con el mismo número no chocan.

`COMMENT ON COLUMN` para las tres columnas.

**`public.textil_compra_lineas`**

- `linea_papel INT` (nula = la línea es tal cual el papel). CHECK `compra_linea_papel`:
  `linea_papel IS NULL OR linea_papel > 0`. Comentario: «Número (1…n) de la línea del papel de
  la que sale esta, cuando la IA partió una línea con varias tallas.»

**`public.textil_stock_movimientos`**

- `importe_ajuste NUMERIC(14,2)`. Comentario: «Solo en `ajuste_coste`: lo que sube (+) o baja
  (−) el valor del stock que queda de la variante. Es el valor del movimiento.»
- Se **recrean** (DROP IF EXISTS + ADD) tres CHECKs con el mismo nombre:
  - `stock_movimiento_no_cero`: `cantidad <> 0 OR motivo = 'ajuste_coste'`
  - `stock_movimiento_signo`:
    ```sql
    (motivo IN ('compra', 'devolucion_cliente', 'inicial') AND cantidad > 0)
    OR (motivo IN ('venta', 'devolucion_proveedor', 'merma') AND cantidad < 0)
    OR motivo = 'ajuste_inventario'
    OR (motivo = 'ajuste_coste' AND cantidad = 0)
    ```
  - `stock_compra_id_motivo`: `compra_id IS NULL OR motivo IN ('compra', 'devolucion_proveedor', 'ajuste_coste')`
- Nuevo CHECK `stock_ajuste_coste_completo`:
  ```sql
  (motivo = 'ajuste_coste' AND importe_ajuste IS NOT NULL AND importe_ajuste <> 0
                           AND compra_id IS NOT NULL)
  OR (motivo <> 'ajuste_coste' AND importe_ajuste IS NULL)
  ```
- `stock_linea_solo_compra` y `stock_compra_con_factura` **no cambian** (el `ajuste_coste` no
  lleva `compra_linea_id`).

No hay tablas nuevas: RLS, políticas por operación y triggers de auditoría ya existen en las tres
tablas. Las columnas nuevas no son sensibles (`auditoria_enmascarar()` no cambia).

### 1.2 `compra_registrada_cabecera()` (CREATE OR REPLACE, copia de 20261028100200 con dos cambios)

1. La lista de columnas inmutables de una registrada pasa a:
   `ARRAY['empresa_id','proveedor','nif_proveedor','numero','fecha','base','iva','irpf','total','categoria','lectura_ia','cuota_iva','cuota_irpf','liquido','tipo_documento','proforma_id','casado_resumen']`.
2. En el bloque de borrado lógico, **antes** de la comprobación de textil:
   ```sql
   IF (v_viejo ->> 'proforma_id') IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.textil_compras f WHERE f.proforma_id = OLD.id) THEN
     RAISE EXCEPTION 'La compra % está casada con una proforma y no se borra.', v_numero   -- E-PRO-11
       USING ERRCODE = 'restrict_violation';
   END IF;
   ```
Los triggers `textil_compras_registrada_inmutable` y `textil_compras_registrada_no_se_borra` se
dejan como están (mismo nombre, misma función).

### 1.3 Trigger nuevo `compra_proforma_solo_por_registro()` (P4, A7)

`LANGUAGE plpgsql SET search_path = public`, **sin** SECURITY DEFINER (mira `current_user`, como
`compra_registrada_cabecera`). Trigger `textil_compras_proforma_solo_por_registro`
`BEFORE INSERT OR UPDATE ON public.textil_compras FOR EACH ROW`.

Compara con `to_jsonb(NEW)` / `to_jsonb(OLD)` (`v_n -> 'estado_pago'`, …), **nunca con
`NEW.columna`**, como `compra_registrada_cabecera`: C2 y C3 revierten migraciones que quitan
`estado_pago`, `fecha_pago`… con este trigger puesto, y `NEW.estado_pago` daría «record "new"
has no field» en cualquier UPDATE posterior. Una clave que falta cuenta como igual.

```text
si current_user NOT IN ('authenticated','anon') → RETURN NEW
INSERT: si v_n->'proforma_id' o v_n->'casado_resumen' no son null/ausentes → E-PRO-12
UPDATE: si v_o->'proforma_id' / v_o->'casado_resumen' IS DISTINCT FROM los de v_n → E-PRO-12
UPDATE: si v_o->'estado_pago' / v_o->'fecha_pago' IS DISTINCT FROM los de v_n
        y v_o->>'tipo_documento' = 'proforma'
        y existe factura f con f.proforma_id = OLD.id → E-PRO-13 (con f.numero)
RETURN NEW
```

### 1.4 `stock_aplicar_movimiento()` (CREATE OR REPLACE, copia de 20261028100200 + rama nueva)

Justo después del `SELECT … FOR UPDATE` de la variante y de fijar `NEW.fecha` (paso 1), una
rama que termina la función:

```sql
IF NEW.motivo = 'ajuste_coste' THEN
  IF NEW.cantidad <> 0 OR NEW.importe_ajuste IS NULL OR NEW.importe_ajuste = 0 THEN
    RAISE … E-AJC-1 USING ERRCODE = '22023';
  END IF;
  IF v_saldo <= 0 THEN
    RAISE … E-AJC-2 USING ERRCODE = 'restrict_violation';
  END IF;
  v_nuevo_coste := (v_saldo * v_coste + NEW.importe_ajuste) / v_saldo;
  IF v_nuevo_coste < 0 THEN
    RAISE … E-AJC-3 USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.coste_unitario := 0;
  PERFORM set_config('app.stock_via_movimiento', '1', true);
  UPDATE public.textil_stock
     SET coste_unitario = round(v_nuevo_coste, 4), updated_at = now()
   WHERE id = NEW.stock_id;                 -- la cantidad no cambia
  PERFORM set_config('app.stock_via_movimiento', '', true);
  RETURN NEW;
END IF;
```

El resto de la función, idéntico. Trigger `textil_stock_mov_aplicar` sin cambios.

`stock_compra_solo_por_registro()` (CREATE OR REPLACE): además del caso `compra` (mismo mensaje
exacto que hoy), si `NEW.motivo = 'ajuste_coste' AND current_user IN ('authenticated','anon')` →
E-AJC-4.

### 1.5 Funciones auxiliares nuevas

```sql
-- La variante donde acabó una variante fusionada (sigue fusionada_en; como mucho 20 saltos).
public.textil_stock_destino(_stock_id UUID) RETURNS UUID
  LANGUAGE plpgsql STABLE SET search_path = public
  -- Devuelve _stock_id si no está fusionada; NULL si _stock_id es NULL.

-- Lo que metió una proforma en el libro, por variante de destino (unidades, valor y coste: solo
-- motivo 'compra'), y las unidades devueltas a mano al proveedor enlazadas a ella
-- (devolucion_proveedor con compra_id = la proforma), solo para AVISAR (A2: no cambian la
-- comparación). Una variante con devoluciones y sin 'compra' no sale (unidades 0 no existe).
-- `posteriores`: las unidades que entraron en esa variante de OTRO documento ('compra' o
-- 'inicial', cantidad > 0) DESPUÉS de la última entrada 'compra' de la proforma (id mayor).
-- Lo que queda en el almacén se cuenta como lo más nuevo: de la proforma solo sigue ahí
-- saldo − posteriores (c3 de 1.7). No cuentan las devoluciones de cliente (lo que vuelve es
-- género que ya estaba, a menudo de la propia proforma) ni los ajustes de inventario (la fusión
-- de variantes se anota así). Se crea con DROP + CREATE (cambió el tipo de retorno).
public.proforma_entradas(_proforma_id UUID)
RETURNS TABLE (stock_id UUID, unidades NUMERIC, valor NUMERIC, coste_unitario NUMERIC,
               devueltas NUMERIC, posteriores NUMERIC)
  LANGUAGE sql STABLE SET search_path = public   -- SECURITY INVOKER (RLS de quien llama)
  AS $$
    WITH e AS (
      SELECT public.textil_stock_destino(m.stock_id) AS stock_id,
             sum(m.cantidad) FILTER (WHERE m.motivo = 'compra') AS unidades,
             sum(round(m.cantidad * m.coste_unitario, 2)) FILTER (WHERE m.motivo = 'compra') AS valor,
             round(sum(round(m.cantidad * m.coste_unitario, 2)) FILTER (WHERE m.motivo = 'compra')
                   / NULLIF(sum(m.cantidad) FILTER (WHERE m.motivo = 'compra'), 0), 8) AS coste_unitario,
             COALESCE(-sum(m.cantidad) FILTER (WHERE m.motivo = 'devolucion_proveedor'), 0) AS devueltas,
             max(m.id) FILTER (WHERE m.motivo = 'compra') AS ultima,
             min(m.empresa_id::TEXT)::UUID AS empresa_id
        FROM public.textil_stock_movimientos m
       WHERE m.compra_id = _proforma_id AND m.motivo IN ('compra', 'devolucion_proveedor')
       GROUP BY 1
      HAVING sum(m.cantidad) FILTER (WHERE m.motivo = 'compra') > 0
    )
    SELECT e.stock_id, e.unidades, e.valor, e.coste_unitario, e.devueltas,
           COALESCE((SELECT sum(o.cantidad) FROM public.textil_stock_movimientos o
                      WHERE o.empresa_id = e.empresa_id AND o.id > e.ultima
                        AND o.motivo IN ('compra', 'inicial') AND o.cantidad > 0
                        AND o.compra_id IS DISTINCT FROM _proforma_id
                        AND public.textil_stock_destino(o.stock_id) = e.stock_id), 0)
      FROM e
  $$;
-- (Solo literales 'compra', 'inicial' y 'devolucion_proveedor': ninguna función LANGUAGE sql de
--  este fichero nombra 'ajuste_coste', que se valida al crearla.)

-- Proformas registradas, sin borrar y sin factura (para el aviso y los anticipos). Sin periodo.
public.compras_proformas_pendientes()
RETURNS TABLE (id UUID, empresa_id UUID, proveedor TEXT, nif_proveedor TEXT, proveedor_id UUID,
               numero TEXT, fecha DATE, categoria TEXT, base NUMERIC, total NUMERIC,
               liquido NUMERIC, estado_pago TEXT, fecha_pago DATE, fichero_ruta TEXT)
  LANGUAGE sql STABLE SET search_path = public   -- SECURITY INVOKER
  -- WHERE c.tipo_documento = 'proforma' AND c.estado = 'registrada' AND c.borrada_en IS NULL
  --   AND c.id NOT IN (SELECT f.proforma_id FROM public.textil_compras f
  --                     WHERE f.proforma_id IS NOT NULL)
  -- ORDER BY c.fecha, c.id

-- Versión: si existe, las dos migraciones de proformas están puestas.
public.proformas_version() RETURNS INT LANGUAGE sql STABLE AS $$ SELECT 1 $$;
```

Permisos de las cuatro: `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role;`
`proformas_version()` va **la última** del fichero (antes del NOTIFY).

### 1.6 `textil_compra_guardar_y_registrar(_compra JSONB, _usuario_id UUID)` — versión nueva

**Misma firma** (CREATE OR REPLACE, mismos REVOKE/GRANT: solo `service_role`). Copia de
20261028100200 con estos cambios. **Numeración**: los pasos de abajo (0–8) son los de este
contrato; en el código de 20261028100200 son «0. Autor y acceso», «1. Cabecera», «2. Proveedor»,
«3. Líneas», «4. Solo textil» (4.1–4.9), «5. Registrar», «6. Resultado». Equivalencias: 1 de aquí
= final del 0 del código; 2 = 1; 3 = 2; 4 = 3; 5 = 4; 6 (pago) es nuevo, entre 4 y 5; 7 = 5;
8 = 6. Los comentarios del SQL nuevo siguen la numeración del código. Claves nuevas del JSON
`_compra`:

| Clave            | Valor                                    | Por defecto |
| ---------------- | ---------------------------------------- | ----------- |
| `tipo_documento` | `"factura"` \| `"proforma"`               | `"factura"` |
| `proforma_id`    | UUID de la proforma \| `null`             | `null`      |
| `lineas[].linea_papel` | entero > 0 \| `null`               | `null`      |

Variables nuevas: `v_tipo TEXT`, `v_proforma_id UUID`, `v_pro RECORD`, `v_liquido NUMERIC`,
`v_stock_res JSONB`, `v_pago JSONB`, `v_casado JSONB`, más las de la regularización.

**Algoritmo, paso a paso** (lo que no se nombra queda igual que hoy):

0. Autor: igual (`app.usuario_id`).
   - `v_tipo := COALESCE(NULLIF(btrim(_compra->>'tipo_documento'),''),'factura')`; si no es
     `factura`/`proforma` → **E-PRO-9**.
   - `v_proforma_id := NULLIF(btrim(_compra->>'proforma_id'),'')::UUID`.
   - Si `v_proforma_id IS NOT NULL AND v_tipo = 'proforma'` → **E-PRO-8**.
   - Si `v_proforma_id IS NOT NULL AND v_proforma_id = v_id` → **E-PRO-3**.
   - **Bloqueo en orden**: si hay `v_proforma_id`, antes del `SELECT … INTO v_existente`:
     `PERFORM 1 FROM public.textil_compras WHERE id IN (v_id, v_proforma_id) ORDER BY id FOR UPDATE;`
     (con `v_id` nulo bloquea solo la proforma). Después, el `SELECT … FOR UPDATE` de
     `v_existente` de siempre.
1. Empresa y acceso: igual.
   - Si hay `v_proforma_id`: `SELECT * INTO v_pro FROM textil_compras WHERE id = v_proforma_id;`
     - no existe → **E-PRO-1**; `v_pro.empresa_id <> v_empresa` → **E-PRO-2**;
     - `v_pro.tipo_documento <> 'proforma'` → **E-PRO-3**;
     - `v_pro.estado <> 'registrada' OR v_pro.borrada_en IS NOT NULL` → **E-PRO-4**;
     - existe `f` con `f.proforma_id = v_pro.id` → **E-PRO-5** (con `f.numero`);
     - `(v_pro.categoria = 'textil') <> (v_categoria = 'textil')` → **E-PRO-7**.
2. Cabecera: igual, y `tipo_documento = v_tipo` en el INSERT y en el UPDATE. **No** se toca
   `proforma_id` aquí.
3. Proveedor: igual. Al terminar, si `v_tipo = 'proforma'` (cualquier categoría): si existe una
   factura `f` de la empresa, registrada, sin borrar y **sin** `proforma_id`, del mismo proveedor
   (`f.proveedor_id = v_prov_id`, o la misma `proveedor_clave` no vacía) y con la misma
   `numero_clave` no vacía → **E-PRO-15** (su factura ya está registrada: el casado solo se hace
   al registrar la factura, así que registrar la proforma metería el género dos veces). La
   pantalla avisa además, sin bloquear, de la factura con el mismo importe a ≤ 90 días
   (`duplicadosDe`, 2.3) y pide confirmarlo.
   Si hay `v_proforma_id`:
   - si `v_pro.proveedor_id` y `v_prov_id` no son nulos y son distintos → **E-PRO-6**;
   - si alguno es nulo: comparar `proveedor_clave` de las dos filas (la de la factura se lee
     de la tabla tras el paso 2); si las dos son ≠ '' y distintas → **E-PRO-6**.
4. Líneas: igual, con `linea_papel = NULLIF(e.l->>'linea_papel','')::INT` en el INSERT (para
   cualquier categoría).
5. Solo textil (`v_textil`): 4.1–4.7 igual. Después:
   - **sin** `v_proforma_id`: 4.8 de hoy (una entrada `compra` por artículo), sea factura o proforma.
   - **con** `v_proforma_id`: **4.8-R Regularización** (1.7) en lugar de 4.8.
   - 4.9 memoria: igual en los dos casos.
6. **Pago** (solo con `v_proforma_id`, cualquier categoría): 1.8. Devuelve `v_pago`.
7. Registrar (paso 5 de hoy): el UPDATE pone además, si hay `v_proforma_id`:
   `proforma_id = v_proforma_id, estado_pago = (v_hereda ? 'pagada' : 'pendiente'),
   fecha_pago = (v_hereda ? v_pro.fecha_pago : NULL), casado_resumen = v_casado` (`v_hereda`, 1.8 e) con
   `v_casado := jsonb_build_object('proforma_id', v_proforma_id, 'stock', v_stock_res, 'pago', v_pago)`
   (`v_stock_res` es NULL si no es textil).
   - En el `EXCEPTION WHEN unique_violation`:
     - `textil_compras_factura_unica` → si `v_tipo = 'proforma'`: «Esta proforma (mismo
       proveedor y número) ya está registrada. Si es un duplicado, bórrala.»; si no, el mensaje de
       hoy, **sin cambiar ni una letra** (lo traduce también `compras.functions.ts`).
     - `textil_compras_proforma_casada_unica` → **E-PRO-5** (carrera: otra la casó a la vez).
8. Resultado: el JSON de hoy más
   `'tipo_documento', v_tipo, 'proforma_id', v_proforma_id, 'casado', v_casado` (`v_casado` NULL
   sin proforma). `movidas` cuenta todos los movimientos anotados (también los de la
   regularización).

### 1.7 4.8-R Regularización (factura textil casada)

Todo dentro de la misma transacción, con la proforma ya bloqueada.

```text
a. Proforma por variante:   P(v), valorP(v), cP(v)   ← SELECT * FROM proforma_entradas(v_pro.id)
   valor_proforma := Σ valorP(v)
b. Factura por variante:    F(v) = Σ unidades_stock, valorF(v) = Σ coste_total_entrada,
                            cF(v) = round(valorF(v) / F(v), 8),
                            linea(v) = id de la primera línea (menor orden) de esa variante
   de textil_compra_lineas WHERE compra_id = v_id AND tipo = 'articulo' GROUP BY stock_id
c. FULL OUTER JOIN por stock_id, ORDER BY stock_id (orden fijo de bloqueo de variantes).
   Para cada variante v (P y F valen 0 si faltan):
   c0. SELECT cantidad, activa, nombre, color, talla FROM textil_stock WHERE id = v FOR UPDATE
       → saldo0 (el saldo ANTES de regularizar: lo que queda de la proforma no puede incluir lo
        que entra ahora en c1). Si la variante está retirada (activa = false, que
        textil_stock_retirar solo permite con 0 unidades) y P > F → **E-REG-1**: la salida de c2
        la dejaría en negativo y fuera del almacén, sin forma de corregirla.
   c1. entran := greatest(F − P, 0)
       si entran > 0: INSERT 'compra' (empresa, v, cantidad entran, coste_unitario cF(v),
          compra_id v_id, compra_linea_id linea(v), fecha v_fecha,
          nota 'Regularización: factura <n.º> sobre proforma <n.º> · entran <n>')
          RETURNING round(cantidad * coste_unitario, 2) → suma en valor_entradas
   c2. salen := greatest(P − F, 0)
       si salen > 0: INSERT 'devolucion_proveedor' (cantidad −salen, coste_unitario 0,
          compra_id v_id, fecha v_fecha, nota '… · salen <n>')
          RETURNING round(cantidad * coste_unitario, 2) → suma en valor_devoluciones (≤ 0)
          (el trigger pone el coste medio vigente; el saldo puede quedar negativo)
   c3. m := least(P, F); d := cF(v) − cP(v)  (0 si P = 0 o F = 0)
       teorico := round(m × d, 2)
       si teorico ≠ 0:
         SELECT cantidad, coste_unitario INTO saldo, cm FROM textil_stock WHERE id = v FOR UPDATE
         -- saldo y cm: los de después de c1/c2 (para el tope y para el trigger)
         u := least(m, greatest(saldo0 − posteriores(v) − salen, 0))
            -- posteriores(v): de proforma_entradas() (1.5); lo que entró de otros documentos
            -- después de la proforma es lo que queda, y no se revaloriza con su diferencia.
            -- unidades de la proforma que siguen en el almacén. NO se usa `saldo`: incluye las
            -- `entran` de c1, que ya entraron al coste de la factura (contarlas revalorizaría
            -- dos veces). Ej.: P=10 a 5 €, F=12 a 6 €, vendidas 8 → saldo0=2, entran 2,
            -- u = 2 y ajuste +2 € (coste medio 6), no u = 4 y +4 € (coste medio 6,50).
         importe := round(u × d, 2)
         si saldo > 0 y saldo × cm + importe < 0: importe := −floor(saldo × cm × 100) / 100
         si saldo > 0 y importe ≠ 0: INSERT 'ajuste_coste' (cantidad 0, coste_unitario 0,
            importe_ajuste importe, compra_id v_id, fecha v_fecha,
            nota 'Ajuste de coste: factura <n.º> sobre proforma <n.º> · <u> uds')
            → suma en importe_ajustes
         si no: importe := 0, u := 0
       si no: u := 0, importe := 0
       sin_aplicar(v) := teorico − importe
   c4. Fila JSON (FilaRegularizacion, 5.2) con: stock_id, unidades_proforma P,
       unidades_factura F, coste_unitario_proforma cP (null si P = 0),
       coste_unitario_factura cF (null si F = 0), entran, salen,
       unidades_ajustadas u, importe_ajuste importe, importe_sin_aplicar sin_aplicar(v).
d. diferencia_sin_aplicar := round(v_base − (valor_proforma + valor_entradas
                                              + valor_devoluciones + importe_ajustes), 2)
e. v_stock_res := RegularizacionStock (5.2): variantes, entran Σ, salen Σ, valor_proforma,
   valor_entradas, valor_devoluciones, importe_ajustes, diferencia_sin_aplicar,
   movimientos (cuántos INSERT de c1–c3).
```

Notas: la variante de la proforma ya viene resuelta a su destino (fusiones). Las líneas de la
factura ya están casadas con variantes activas (4.6). Una variante solo en la factura entra
entera (P = 0); solo en la proforma sale entera (F = 0). Ningún UPDATE ni DELETE de movimientos.

### 1.8 Paso del pago (factura casada, cualquier categoría)

```text
a. v_liquido := (SELECT liquido FROM textil_compras WHERE id = v_id)   -- generada, tras el paso 2
b. Bloqueo: PERFORM 1 FROM banco_conciliaciones
             WHERE grupo IN (SELECT grupo FROM banco_conciliaciones WHERE compra_id = v_pro.id)
             ORDER BY id FOR UPDATE;
c. UPDATE banco_conciliaciones SET compra_id = v_id, importe = -v_liquido
    WHERE compra_id = v_pro.id;                       → enlaces_movidos (ROW_COUNT)
   (UPDATE en su sitio: conserva grupo, estado, motivo, conciliado_por y marco_pagada;
    lo audita banco_conciliaciones_auditoria con app.usuario_id ya fijado.)
d. Para cada grupo tocado:
     dif := round( Σ importe de los movimientos DISTINTOS del grupo
                 − Σ importe de los documentos DISTINTOS del grupo
                   (uno por COALESCE(factura_id, compra_id, textil_factura_id)), 2)
     UPDATE banco_conciliaciones SET diferencia = dif
            , estado = CASE WHEN dif <> 0 THEN 'revisar' ELSE estado END
      WHERE grupo = g;
     cuenta grupos y grupos_revisar (los que quedaron en 'revisar' por dif ≠ 0)
e. liquido_pro := round(COALESCE(v_pro.liquido, v_pro.total, 0), 2)
   v_hereda := v_pro.estado_pago = 'pagada'
               AND (enlaces_movidos > 0 OR round(v_liquido, 2) <= liquido_pro)
   v_pago := PagoTraspasado (5.2): enlaces_movidos, grupos, grupos_revisar,
             estado_pago = (v_hereda ? 'pagada' : 'pendiente'),
             fecha_pago = (v_hereda ? v_pro.fecha_pago : NULL),
             proforma_pagada = (v_pro.estado_pago = 'pagada'), liquido_proforma = liquido_pro,
             diferencia = round(v_liquido − liquido_pro, 2)
```

Reglas del pago heredado:

- Pago enlazado en el banco (`enlaces_movidos > 0`): la factura hereda «pagada»; si el líquido
  difiere, el grupo queda en `revisar` con su diferencia (d).
- Proforma pagada a mano (sin enlace) y factura por **igual o menos**: la factura queda cubierta y
  hereda «pagada» con la fecha de la proforma; lo pagado de más queda en
  `casado_resumen.pago.diferencia` (negativa).
- Proforma pagada a mano y factura por **más**: la factura queda **pendiente** (nada diría que
  falta la diferencia). En Tesorería › Pagos pendientes solo cuenta como deuda
  `líquido − liquido_proforma` (`pagadoConProforma`, 2.6); lo ya pagado no se cuenta otra vez.
- Proforma pendiente: la factura queda pendiente por su líquido.

La copia de `estado_pago`/`fecha_pago` se hace en el UPDATE del paso 7 de 1.6. La proforma **no se toca** (conserva su pago como
historia; deja de contar porque está casada).

Orden de bloqueo: aquí `textil_compras` (proforma, ya bloqueada en el paso 0) → filas de
`banco_conciliaciones`. `banco_desenlazar_como` va al revés (filas del grupo → compra). Un cruce
exacto de los dos a la vez acaba en un `deadlock detected` que Postgres resuelve abortando uno
(sin dejar nada a medias); la persona lo repite. Se acepta; no se añade más bloqueo.

### 1.9 `textil_compra_registrar(_compra_id UUID)` (camino viejo)

CREATE OR REPLACE, copia exacta de 20261028100200 (conserva el texto «portes, descuentos u otros
cargos», que mira C18) con una guarda tras «ya estaba registrada»:

```sql
IF v_compra.proforma_id IS NOT NULL OR v_compra.tipo_documento = 'proforma' THEN
  RAISE EXCEPTION 'Las proformas y las facturas casadas con una proforma se registran desde la revisión de Compras.'
    USING ERRCODE = 'restrict_violation';                                   -- E-PRO-10
END IF;
```

### 1.10 Conciliación

- **`banco_documentos()`**: `DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();`
  `DROP FUNCTION IF EXISTS public.banco_documentos();` y se crean de nuevo (copia de
  20261025100000) con una **última columna** `tipo_documento TEXT`:
  - rama `compra`: `c.tipo_documento`; ramas `factura` y `textil`: `NULL::TEXT`;
  - `conciliable` de la rama `compra`:
    `c.estado = 'registrada' AND c.borrada_en IS NULL AND c.id NOT IN (SELECT f.proforma_id FROM public.textil_compras f WHERE f.proforma_id IS NOT NULL)` (NOT IN, como el resto: tabla hash, sin JIT).
- **`banco_documentos_por_conciliar()`**: igual que hoy más `d.tipo_documento` como última columna.
- **`banco_enlaces()`**: CREATE OR REPLACE (misma firma); en el `jsonb_build_object` de cada
  documento, `'tipo_documento', d.tipo_documento`.
- Permisos y COMMENT de las tres como en 20261025100000 (REVOKE PUBLIC, anon; GRANT authenticated, service_role).
- **`banco_enlazar_como(…)`**: CREATE OR REPLACE, copia de 20261017100000; en la rama
  `d.tipo = 'compra'`, tras «ya está conciliada»:
  ```sql
  -- v_num TEXT, nueva en el DECLARE
  SELECT f.numero INTO v_num FROM public.textil_compras f WHERE f.proforma_id = d.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Esa proforma ya tiene factura (n.º %): concilia el pago con la factura.',
      COALESCE(v_num, '(sin número)');                                      -- E-PRO-14
  END IF;
  ```
  Mismos REVOKE que hoy. `banco_aplicar_efectos`, `banco_confirmar` y `banco_desenlazar_como`
  **no cambian**.

### 1.11 Códigos de error SQL (mensajes exactos; los repite la pantalla tal cual)

| Código   | SQLSTATE             | Mensaje                                                                                                                         |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| E-PRO-1  | `P0002`              | La proforma elegida no existe.                                                                                                  |
| E-PRO-2  | `42501`              | La proforma es de otra empresa.                                                                                                 |
| E-PRO-3  | `22023`              | El documento elegido no es una proforma.                                                                                        |
| E-PRO-4  | `restrict_violation` | La proforma % todavía no está registrada o está borrada: regístrala antes de casarla.                                           |
| E-PRO-5  | `unique_violation`   | La proforma % ya tiene factura (n.º %).                                                                                         |
| E-PRO-6  | `22023`              | La proforma % es de otro proveedor (%): solo se casa con una factura del mismo proveedor.                                       |
| E-PRO-7  | `22023`              | Una proforma textil solo se casa con una factura textil, y una de otra categoría con una factura que no sea textil.             |
| E-PRO-8  | `22023`              | Una proforma no se casa con otra proforma: lo que se casa con la proforma es su factura.                                        |
| E-PRO-9  | `22023`              | Tipo de documento desconocido: %. Tiene que ser factura o proforma.                                                             |
| E-PRO-10 | `restrict_violation` | Las proformas y las facturas casadas con una proforma se registran desde la revisión de Compras.                                |
| E-PRO-11 | `restrict_violation` | La compra % está casada con una proforma y no se borra.                                                                         |
| E-PRO-12 | `restrict_violation` | La proforma y su factura solo se casan al registrar la factura, desde su revisión.                                              |
| E-PRO-13 | `restrict_violation` | Esta proforma ya tiene factura (n.º %): el pago se marca en la factura.                                                         |
| E-PRO-14 | (sin código, como el resto de `banco_enlazar_como`) | Esa proforma ya tiene factura (n.º %): concilia el pago con la factura.                          |
| E-PRO-15 | `unique_violation`   | Esta proforma parece de la factura %, ya registrada: no la registres (la factura ya cuenta y, si es textil, su género ya entró). |
| E-REG-1  | `restrict_violation` | La variante % está retirada y la factura trae menos unidades que la proforma: reactívala en Stock (o fusiónala con la buena) antes de casar. |
| E-AJC-1  | `22023`              | Un ajuste de coste no mueve unidades: lleva cantidad 0 y un importe distinto de 0.                                              |
| E-AJC-2  | `restrict_violation` | No hay existencias de esta variante a las que llevar el ajuste de coste.                                                        |
| E-AJC-3  | `restrict_violation` | El ajuste de coste dejaría el coste medio de la variante en negativo.                                                           |
| E-AJC-4  | `restrict_violation` | Los ajustes de coste solo los anota el registro de la factura casada con su proforma (Compras).                                 |

Los `%` de número usan `COALESCE(numero, '(sin número)')`; el de proveedor, el nombre del
proveedor de la proforma.

### 1.12 Pruebas

**Registro en `probar-migraciones.sh`**, después de C18:
`seccion "Proformas: casar factura, regularizar el stock y pasar el pago" C19_proformas.sql`

**Adaptar `C14_conciliacion_pendientes.sql`**: justo antes del `\ir ../migrations/20261025100000_conciliacion_pendientes.sql`
de la línea 18, añadir
```sql
DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos();
```
(con la columna nueva, el CREATE OR REPLACE viejo fallaría por cambiar el tipo de retorno). Nada
más en C14. Si otra prueba falla por las firmas o los CHECKs nuevos, se adapta lo mínimo y se
dice en el informe.

**`C19_proformas.sql`**, con la estructura de C18:
1. Fuera de transacción: `\ir ../migrations/20261029100000_proformas_motivo.sql` (no-op si ya está).
2. `BEGIN;` `\ir ../migrations/20261029100100_proformas_compras.sql` **dos veces** (idempotente; además
   repone lo que pisaron C3, C5, C14 y C18). Permisos como C18; ayudas `pg_temp.ok`, `pg_temp.id`,
   `pg_temp.variante`, una función `pg_temp.registrar(_json JSONB)` que llama a
   `textil_compra_guardar_y_registrar(_json, adm)`, y `pg_temp.huella()` del libro (como C18).
3. Casos (cada uno una línea `BIEN`/`MAL`; ver lista completa en 7.2).
4. `ROLLBACK;`
5. Fuera de transacción: reversión de 20261029100100, comprobación (columnas y funciones fuera,
   CHECKs con su definición de 20261028), y se vuelve a aplicar; `proformas_version() = 1`.

**Reversiones**:
- `20261029100100_proformas_compras.sql`: `BEGIN … COMMIT`. Se niega (RAISE) si hay alguna
  compra con `tipo_documento = 'proforma'` o `proforma_id` no nulo, o algún movimiento
  `ajuste_coste`. Repone **tal cual**: `compra_registrada_cabecera`, `stock_aplicar_movimiento`,
  `stock_compra_solo_por_registro`, `textil_compra_guardar_y_registrar`, `textil_compra_registrar`
  (de 20261028100200), `banco_enlazar_como` (de 20261017100000), `banco_documentos`,
  `banco_documentos_por_conciliar` (DROP + CREATE) y `banco_enlaces` (de 20261025100000), con sus
  permisos; los tres CHECKs recreados con su definición anterior; `textil_compras_factura_unica`
  con su definición de 20261015100000. Quita: trigger y función `compra_proforma_solo_por_registro`,
  `textil_stock_destino`, `proforma_entradas`, `compras_proformas_pendientes`, `proformas_version`,
  los índices y CHECKs nuevos, y las columnas `tipo_documento`, `proforma_id`, `casado_resumen`,
  `linea_papel`, `importe_ajuste`. `NOTIFY pgrst`.
- `20261029100000_proformas_motivo.sql`: solo comentario + `SELECT 1;` (PostgreSQL no quita un
  valor de un enum; sin la otra migración nadie lo usa).

---

## 2. DOMINIO (`src/dominio/**` y sus `.test.ts`)

Todo puro, sin red ni base. Firmas exactas: quien las usa (SERVIDOR, PANTALLAS) se escribe
contra ellas sin verlas.

### 2.1 `tipos-textil.ts` (tipos compartidos; ver sección 5)

- `MOTIVOS_STOCK`: añadir `"ajuste_coste"` **al final**.
- Nuevos: `TIPOS_DOCUMENTO_COMPRA`, `TipoDocumentoCompra`, `ETIQUETAS_TIPO_DOCUMENTO`,
  `FilaRegularizacion`, `RegularizacionStock`, `PagoTraspasado`, `ResumenCasado` (5.2).
- `LineaRegistro`: `linea_papel?: number | null` (**opcional**: los cuatro equipos compilan a la
  vez y hay constructores de `LineaRegistro` en servidor y pruebas que aún no la ponen).
- `RegistroCompra`: `tipo_documento?: TipoDocumentoCompra; proforma_id?: string | null;`
- `ResultadoRegistro`: `tipo_documento: TipoDocumentoCompra; proforma_id: string | null; casado: ResumenCasado | null;`
- `CodigoErrorEscaner` no cambia.

### 2.2 `proformas.ts` (nuevo) + `proformas.test.ts`

```ts
import type { TipoDocumentoCompra, RegularizacionStock, FilaRegularizacion } from "./tipos-textil";

type Numerico = number | string | null | undefined;

/** Lo mínimo de una compra para saber qué documento es y con quién está casada. */
export type CompraConDocumento = {
  id: string;
  tipo_documento?: string | null;   // sin la migración, undefined = factura
  proforma_id?: string | null;
  estado?: string | null;
  borrada_en?: string | null;
};

/** Una proforma (o cualquier compra) con lo que se enseña y se suma. */
export type ProformaFila = CompraConDocumento & {
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  numero: string | null;
  fecha: string | null;               // yyyy-MM-dd
  categoria?: string | null;
  base: Numerico;
  total: Numerico;
  liquido?: Numerico;
  estado_pago?: string | null;
  fecha_pago?: string | null;
  fichero_ruta?: string | null;
  lineas?: readonly { tipo?: string | null; stock_id?: string | null; unidades_stock?: Numerico }[];
};

export const esProforma: (c: { tipo_documento?: string | null }) => boolean;   // === "proforma"

/** id de proforma → su factura casada (las facturas con proforma_id de la lista). */
export function facturasPorProforma<T extends CompraConDocumento>(compras: readonly T[]): Map<string, T>;

export type ProformaPendiente<T extends ProformaFila = ProformaFila> = {
  proforma: T;
  /** Días desde su fecha (diasDesde de pendientes.ts); null sin fecha. */
  dias: number | null;
  pagada: boolean;                    // estado_pago === "pagada"
  importe: number;                    // redondear(liquido ?? total)
};

/**
 * Proformas registradas, sin borrar y sin factura casada en `compras` (las facturas de la
 * misma lista que apuntan a ellas). Desde el día 1, sin umbral. La más antigua primero
 * (fecha asc, id). Vale también con lo que devuelve compras_proformas_pendientes().
 */
export function proformasSinFactura<T extends ProformaFila>(compras: readonly T[], hoy: Date): ProformaPendiente<T>[];

export type ResumenProformas = {
  proformas: number;
  importe: number;          // Σ importe
  pagadas: number;
  importePagado: number;    // Σ importe de las pagadas (anticipos)
  masAntigua: string | null;      // fecha
  diasMasAntigua: number | null;
};
export function resumenProformas(pendientes: readonly ProformaPendiente[]): ResumenProformas;

/** El documento que se revisa, para sugerirle proformas. */
export type DocumentoParaCasar = {
  id?: string | null;
  proveedor: string | null;
  nif_proveedor: string | null;
  proveedor_id?: string | null;
  fecha: string | null;
  base: number;
  total: number;
  liquido?: number | null;
  categoria?: string | null;
  referencia_proforma?: string | null;
  /** Unidades por stock_id de sus artículos ya casados (textil); null si no se sabe. */
  unidades?: ReadonlyMap<string, number> | null;
};

export const PUNTOS_PROFORMA = { referencia: 50, total: 30, base: 20, unidades: 20, fecha: 10 } as const;

export type SugerenciaProforma<T extends ProformaFila = ProformaFila> = {
  proforma: T;
  puntos: number;
  /** Por qué, en castellano y en orden: «Cita su número», «Mismo total», … */
  motivos: string[];
};

/**
 * Proformas que pueden ser de este documento. NUNCA casa: propone.
 * Filtra: proforma registrada, sin borrar, sin factura (ni en `casadas` ni en la lista),
 * id ≠ documento, mismo proveedor (proveedor_id si los dos lo tienen; si no,
 * claveProveedor(nif, nombre) igual y no vacía), y (categoria === "textil") igual en los dos
 * cuando los dos la tienen.
 * Puntos: claveNumero(referencia_proforma) === claveNumero(numero) → referencia;
 * |total − total| ≤ TOLERANCIA (factura-compra.ts) → total (compara liquido si los dos lo tienen);
 * |base − base| ≤ TOLERANCIA → base; mapas de unidades por stock_id iguales (de las líneas
 * artículo de la proforma) → unidades; fecha proforma ≤ fecha documento → fecha.
 * Orden: puntos desc, fecha desc, id.
 */
export function sugerirProformas<T extends ProformaFila>(
  documento: DocumentoParaCasar,
  proformas: readonly T[],
  casadas: ReadonlySet<string>,
): SugerenciaProforma<T>[];

/** Una fila de proforma_entradas() (SQL 1.5). `devueltas`: uds devueltas a mano al proveedor
 *  enlazadas a la proforma; NO entran en la regularización (A2), solo se avisa. */
export type EntradaProforma = {
  stock_id: string; unidades: number; valor: number; coste_unitario: number; devueltas: number;
  posteriores?: number;  // unidades de otros documentos entradas después (1.5)
};

/** Un artículo de la factura con su coste de entrada ya repartido (reparto-compra.ts). */
export type ArticuloFactura = {
  indice: number;                 // posición en las líneas
  stock_id: string | null;        // null si es variante nueva o sin casar
  unidades: number;               // unidades_stock
  coste_total: number;            // coste_total_entrada
  grupo_nueva?: string | null;    // sin stock_id: las de la misma clave van juntas (grupoDeNueva)
};

/** La variante que reutilizará la base (1.6 paso 4.6) para una «variante nueva»: la activa y no
 *  repetida del mismo producto (el elegido, o el de la misma marca+referencia, o marca+nombre sin
 *  referencia), color (claveTexto) y talla (claveTalla). null si no hay una sola. La pantalla la
 *  pasa como stock_id a regularizacionPrevista; si es null, pasa grupo_nueva = grupoDeNueva(nv). */
export function varianteDeNueva(nueva, productos, variantes): string | null;
export function grupoDeNueva(nueva: NuevaVariante): string;

export type StockActual = { cantidad: number; coste_unitario: number };

/**
 * La regularización que hará la base (SQL 1.7), calculada antes para enseñarla.
 * Mismas reglas, mismos redondeos: cP = valor/unidades (8 dec.), cF = Σcoste/Σunidades (8 dec.),
 * entran/salen, m = min(P, F), teorico = round(m×d, 2),
 * u = min(m, max(saldo0 − posteriores − salen, 0)) con
 * saldo0 = cantidad actual (ANTES de entran: lo que entra ya va al coste de la factura),
 * importe = round(u×d, 2), tope de coste ≥ 0 con −floor(saldo × cm × 100)/100, donde
 * saldo = saldo0 + entran − salen y cm = coste medio tras la entrada, ponderado y a 4 decimales
 * como el trigger (si saldo0 ≤ 0, cm = cF), diferencia_sin_aplicar con el valor
 * de las devoluciones al coste medio de hoy.
 * Un artículo sin stock_id cuenta como variante propia con clave `nueva:<indice>` (stock 0);
 * los que comparten `grupo_nueva` van juntos con el índice del primero. Filas ordenadas por stock_id. `movimientos` = cuántos movimientos anotará.
 * Es una previsión: la base manda (el coste medio puede moverse entre medias).
 */
export function regularizacionPrevista(datos: {
  proforma: readonly EntradaProforma[];
  factura: readonly ArticuloFactura[];
  stock: ReadonlyMap<string, StockActual>;
  base_factura: number;
}): RegularizacionStock;

export type EstadoFilaRegularizacion =
  | "igual"          // mismas unidades y mismo coste (|d| < 0,00005 €/ud o importe teórico 0)
  | "coste"          // mismas unidades, otro coste
  | "mas"            // la factura trae más (y quizá otro coste)
  | "menos"          // la factura trae menos
  | "solo_factura"
  | "solo_proforma";
export function estadoFilaRegularizacion(f: FilaRegularizacion): EstadoFilaRegularizacion;

/** Lo que pasará con el pago al casar (línea informativa de la revisión). */
export function pagoPrevisto(
  proforma: Pick<ProformaFila, "estado_pago" | "fecha_pago" | "liquido" | "total">,
  liquidoFactura: number,
): { pagada: boolean; fecha: string | null; diferencia: number; revisarSiEnlazada: boolean;
     pendienteSiAMano: boolean };
// diferencia = redondear(liquidoFactura − (liquido ?? total) de la proforma);
// revisarSiEnlazada = diferencia ≠ 0. La pantalla no sabe si el pago está enlazado en el banco
// (la base pone el grupo en `revisar` solo si hay enlace, esté la proforma pagada o no; una
// pagada a mano sin enlace no deja nada por revisar): el texto es condicional (4.9).
// pendienteSiAMano = pagada && diferencia > 0: pagada a mano y la factura por más queda
// pendiente por la diferencia (1.8 e); por igual o menos, queda cubierta.

/** Proformas con unidades ya devueltas a mano (A2): variantes con devueltas > 0. */
export function devueltasAntesDeFactura(
  entradas: readonly EntradaProforma[],
): { stock_id: string; devueltas: number }[];

/** Grupos de líneas partidas: las consecutivas con el mismo linea_papel (no nulo) van juntas. */
export function gruposPorLineaPapel(
  lineas: readonly { linea_papel?: number | null }[],
): { linea_papel: number | null; indices: number[] }[];

export type FiltroDocumento = "todos" | "facturas" | "proformas_pendientes" | "proformas_facturadas";
export const FILTROS_DOCUMENTO: readonly { valor: FiltroDocumento; etiqueta: string }[];
// "Facturas y proformas", "Solo facturas", "Proformas sin factura", "Proformas facturadas"
export function pasaFiltroDocumento(c: CompraConDocumento, filtro: FiltroDocumento, casadas: ReadonlySet<string>): boolean;

/** Compras textil que movieron stock para enlazar una devolución a proveedor: proformas
 *  (con el n.º de su factura si la tienen) y facturas no casadas; nunca la factura casada. */
export function comprasParaDevolucion<T extends ProformaFila>(
  compras: readonly T[],
): { compra: T; facturadaEn: string | null }[];
```

### 2.3 `cola-compras.ts`

- `CompraComparable`: añadir `tipo_documento?: string | null; proforma_id?: string | null;`
- `duplicadosDe`: el nivel `archivo` no cambia. Los niveles `factura` y `probable` se saltan si
  `(c.tipo_documento ?? "factura") !== (o.tipo_documento ?? "factura")`, o si
  `o.proforma_id === c.id` o `c.proforma_id === o.id` (el par no es un duplicado).
  **Excepción** (`facturaDeProforma: true` en el `Duplicado`): si `c` es una proforma y `o` una
  factura registrada, sin borrar, sin `proforma_id` y del mismo proveedor, es su factura ya
  registrada: mismo número → nivel `factura` (bloquea, como E-PRO-15); mismo importe y fechas a
  ≤ `DIAS_FACTURA_DE_PROFORMA` (90) días → `probable` (hay que confirmarlo). `avisoDuplicado`:
  «Esta proforma parece de la factura …, ya registrada: no la registres …» / «Esta proforma puede
  ser de la factura …».
- `avisoDuplicado`: si `d.de.tipo_documento === "proforma"`, dice «proforma» donde dice «factura».
- `esquemaLectura` (zod), en la cabecera:
  ```ts
  tipo_documento: z.preprocess((v) => (v === "" ? null : v),
                  z.enum(TIPOS_DOCUMENTO_COMPRA).nullable()).optional().catch(null)
                  .transform((v) => v ?? null),
  referencia_proforma: textoOpcional,
  ```
  y en cada línea `linea_papel: textoOpcional` e `importe_linea_papel: textoOpcional`.
- `ESQUEMA_LECTURA_JSON`: en `required` y `properties` de la cabecera,
  `tipo_documento: { type: "string", enum: [...TIPOS_DOCUMENTO_COMPRA, ""] }` y
  `referencia_proforma: tOn`; en las líneas, `linea_papel: tOn` e `importe_linea_papel: tOn`
  (el importe de la línea del papel, repetido en cada partida; `""` si no se parte: sin él no hay
  con qué comprobar que las tallas suman la línea). **Cero uniones** y **cero opcionales nuevos**
  (todo en `required`; la prueba de `MAXIMO_UNIONES_API` y la de ≤ 24 opcionales siguen pasando).
  `{ type: "string", enum: [..., ""] }` no es unión; **no** usar `["string","null"]` ni `anyOf`.
- Pruebas existentes que **hay que adaptar** (no borrar): «el JSON Schema de las líneas pide las
  ocho claves del escáner» (su lista pasa a incluir `linea_papel` e `importe_linea_papel`) y
  «el JSON Schema pide los mismos campos que el esquema» (el objeto `lecturaBuena` gana
  `tipo_documento` y `referencia_proforma`, y sus líneas `linea_papel` e `importe_linea_papel`).
- Nuevas:
  ```ts
  /** Lo que dijo la IA; null si no lo dijo o dudó (""). */
  export function tipoDocumentoLeido(lecturaIa: unknown): TipoDocumentoCompra | null;
  export function referenciaProformaDe(lecturaIa: unknown): string | null;
  ```
- `motivosRevision(d)`: dos claves **opcionales** más (las llamadas viejas compilan):
  `tipoDocumento?: TipoDocumentoCompra | null;` y
  `proformas?: readonly SugerenciaProforma[];`. Reglas, después de los duplicados:
  - `tipoDocumento === null` → «La IA no sabe si es factura o proforma: elígelo.»
  - `tipoDocumento === "proforma"` → «Es una proforma: mete el género en el stock y no cuenta en el IVA ni en Gerencia.»
  - si `tipoDocumento !== "proforma"`, por cada una de las 3 primeras sugerencias:
    «Puede ser la factura de la proforma {numero ?? "(sin número)"} del {fecha} ({proveedor}): cásala al revisarla.»
  - `tipoDocumento === undefined` no añade nada.

### 2.4 `factura-compra.ts`

- `LineaLeida`: `linea_papel?: number | null; importe_linea_papel?: number | null`.
- `CompraLeida`: `tipo_documento?: TipoDocumentoCompra | null; referencia_proforma?: string | null;` (opcionales).
- `normalizarCompra`: `linea_papel` = entero > 0 de `aNumero(x.linea_papel)`, si no `null`;
  `importe_linea_papel` = `aNumero(...)` (con su signo) o `null` si vacío o si `linea_papel` es
  `null`; `tipo_documento` = `"factura"|"proforma"` si lo es, si no `null`; `referencia_proforma` =
  texto o `null`.
- `revisarCompra`: **una regla nueva** (P9, decisión 9: «las partidas suman exactamente el
  importe de la línea del papel»). Por cada grupo de `gruposPorLineaPapel(lineas)` con
  `linea_papel` no nulo: si alguna partida trae `importe_linea_papel` y
  `|Σ importe − importe_linea_papel| ≥ 0,005` → aviso de cabecera (`linea: null`)
  `Línea ${n} del papel: las tallas suman ${suma} y la línea dice ${importe_linea_papel}.`
  (números tal cual, como los demás avisos de `revisarCompra`). Si las partidas del grupo traen
  `importe_linea_papel` distintos entre sí → `Línea ${n} del papel: la IA da dos importes
  distintos para la misma línea.` Sin `importe_linea_papel`, nada. **Sin importar
  `proformas.ts`** (que ya importa `TOLERANCIA` de `factura-compra.ts`: sería un ciclo): el
  agrupado (consecutivas con el mismo `linea_papel` no nulo) se hace aquí, en una función
  privada de 5 líneas con la misma regla que `gruposPorLineaPapel`.

### 2.5 `compras.ts`, `fiscal.ts`, `sumatorios-facturas.ts`, `archivo.ts`

- `fiscal.ts` `CompraResumen`: `tipo_documento?: string | null;`
- `compras.ts` `importesDeCompra`: `if (c.borrada_en || c.tipo_documento === "proforma") return null;`
  (P1: con eso salen de IVA, 303/111, Gerencia, comparación y Textil; la factura casada cuenta por su fecha).
- `sumatorios-facturas.ts` `totalesCompras`: el tipo de entrada gana `tipo_documento?: string | null`;
  cuentan las que no son borrador **ni proforma**; `TotalesCompras` gana `proformas: number`
  (cuántas proformas no borrador se apartaron). `totalesArchivo`, `totalesCola`: sin cambios.
- `archivo.ts`: `FilaCompra` gana `tipo_documento?: string | null`; `DocArchivo` gana
  `proforma?: boolean`; `deCompra` pone `proforma: c.tipo_documento === "proforma"`;
  `entraEnArchivo` devuelve `false` si `doc.proforma`.

### 2.6 `pagos-proveedores.ts`

- `CompraPendiente`: `tipo_documento?: string | null; casada?: boolean;` (sin `fecha_pago`:
  `usePagosProveedores` solo lee las pendientes).
- `pagosPendientesProveedores`: además se salta `c.casada === true`. `PagosProveedores` gana
  `proformas: number` (cuántas de las contadas son proforma).
- `CompraPendiente.casado_resumen?: unknown` (lo lee `usePagosProveedores` con la migración). En
  una factura casada pendiente con `casado_resumen.pago.proforma_pagada`, el importe es
  `líquido − liquido_proforma` (`pagadoConProforma`); si no queda nada, no cuenta (1.8 e).
- Nueva (entrada = lo que da `useProformasPendientes`, que es `ProformaFila[]`, **no**
  `CompraPendiente[]`: `ProformaFila.total` admite null y `estado` es opcional, y con
  `CompraPendiente` no compilaría):
  ```ts
  import type { ProformaFila } from "./proformas";
  export type AnticiposProveedores = {
    total: number; proformas: number; porProveedor: DeudaProveedor[]; masAntigua: string | null; // por fecha_pago
  };
  /** Proformas (tipo_documento "proforma"), registradas (estado "registrada" o ausente), sin
   *  borrar, sin `proforma_id`-casada en la lista y con estado_pago "pagada": dinero ya salido
   *  sin factura. Importe = redondear(liquido ?? total ?? 0). Agrupa como pagosPendientes. */
  export function anticiposProveedores(compras: readonly ProformaFila[], hoy: Date): AnticiposProveedores;
  ```
  (`proformas.ts` no importa de `pagos-proveedores.ts`: sin ciclo.)

### 2.7 `controles-almacen.ts` (tratar el par)

- `CompraControl`: `tipo_documento?: string | null; proforma_id?: string | null; casado_resumen?: ResumenCasado | null;`
- `EntradaControl`: `Pick<MovimientoAlmacen, "motivo" | "cantidad" | "coste_unitario" | "compra_id" | "importe_ajuste">`.
- `FilaControlCompra`: añadir `tipo: "compra" | "par" | "proforma_sin_factura"; proforma: CompraControl | null; sinAplicar: number;`
- `ControlCompras`: añadir `proformasSinFactura: number`.
- `controlComprasEntradas(compras, entradas)` (misma firma). `compras` trae las del rango **más**
  el otro miembro de cada par (lo añade el servidor). Reglas:
  - Una factura con `proforma_id` cuya proforma está en la lista → **una fila** `tipo: "par"`
    anclada en la factura (`compra` = factura, `proforma` = la proforma). `entradas` =
    Σ `valorMovimiento` de las `compra` con `compra_id` ∈ {proforma, factura} + Σ de las
    `ajuste_coste` de la factura + `casado_resumen.stock.valor_devoluciones`; `base` = base de
    la factura; `sinAplicar` = `casado_resumen.stock.diferencia_sin_aplicar`;
    `diferencia = redondear(entradas − (base − sinAplicar))` → `cuadra`/`descuadre`. La proforma
    casada no tiene fila propia. Sin `casado_resumen` (no debería pasar) → `sinAplicar = 0`.
  - Proforma sin factura → fila `tipo: "proforma_sin_factura"` con la regla de siempre (sus
    entradas contra su base); cuenta en `proformasSinFactura`.
  - Lo demás, `tipo: "compra"`, como hoy (`sin_enlace` solo para las de antes del enlace).
  - Las entradas que no son `compra` ni `ajuste_coste` se ignoran (como hoy).
- `ResumenControles`: `proformasSinFactura: number` (lo pone `resumenControles` desde `c`; **no**
  cuenta para `todoEnCero`: es una espera normal).

### 2.8 `cuenta-almacen.ts`

- `MovimientoAlmacen`: `importe_ajuste?: number | string | null; regularizacion?: boolean`
  (`regularizacion`: lo pone el servidor, 3.6, en las `devolucion_proveedor` cuyo `compra_id` es
  una factura casada con proforma = las «salen» de la regularización).
- `valorMovimiento(m: Pick<MovimientoAlmacen, "cantidad" | "coste_unitario"> & { motivo?: string; importe_ajuste?: number | string | null }): number`
  → si `m.motivo === "ajuste_coste"`: `redondear(Number(importe_ajuste) || 0, 2)`; si no, lo de hoy.
- `cuentaAlmacen`: `ajuste_coste` suma en `compras` (unidades 0, su valor) y **no** en `perdidas`.
  Una `devolucion_proveedor` con `regularizacion === true` suma **en `compras`, con su signo**
  (unidades y valor negativos: corrige una entrada que la factura no trajo) y **no** en
  `devolucionesProveedor` ni en `perdidas`. Sin esto, una factura con menos unidades que su
  proforma saldría como pérdida en Resultados (`costeAlmacenPeriodo`), y no lo es: esas unidades
  nunca se pagaron. La identidad sigue exacta (la partida cambia de sitio, no de valor).
- `InformeAlmacen`: `proformasSinFactura?: ResumenProformas | null` (opcional).

### 2.9 `gerencia.ts`

- `Aviso`: añadir
  `| { tipo: "proforma_sin_factura"; nivel: "medio"; proformas: number; importe: number; masAntigua: string | null; dias: number | null }`
- `avisosGerencia(d)`: `d.proformas?: ResumenProformas | null`. Si `proformas > 0` → el aviso
  (desde el día 1; no depende del periodo). Va el último.

### 2.10 `definiciones.ts`

Textos (Javier los lee en la ⓘ; frases cortas, sin jerga):
- `g_compras_textil.calculo`: «… las facturas de compra registradas con fecha en el periodo. Las proformas no cuentan: cuenta su factura, por la fecha de la factura.»
- `g_almacen_cuenta`: en «calculo», «… las entradas por compra al de la factura (o al de la proforma, si el género llegó con ella), con portes y descuentos repartidos; los ajustes de coste de una factura que no coincide con su proforma, en Compras, con su importe; y las unidades de la proforma que la factura no trae, restando en Compras (no son una pérdida)…»; en «fuente», «(en las compras, la del documento con el que entró)».
- `g_almacen_controles`: «1) La base de cada factura textil registrada menos el valor de sus entradas… Una factura casada con su proforma se comprueba junto con ella: lo que no se pudo llevar al stock (lo ya vendido) se descuenta. Las proformas todavía sin factura se cuentan aparte: no son un descuadre.»
- `g_pagos_proveedores`: añadir «Una proforma casada con su factura no cuenta dos veces: cuenta la factura.»
- Nuevas: `g_anticipos_proveedores` (qué: «Lo pagado a proveedores por proformas que aún no tienen factura.»; cálculo: «Suma del líquido de las proformas registradas, pagadas y sin factura casada.»; fuente: «Compras (proformas), de cualquier fecha. No depende del periodo.») y `g_proformas_sin_factura` (qué: «Proformas registradas que todavía no tienen su factura.»; cálculo: «Todas desde el día en que se registran, con los días que llevan.»; fuente: «Compras, de cualquier fecha.»).

### 2.11 Pruebas de dominio (mínimas; cada una un `it` con nombre en castellano)

`proformas.test.ts`:
1. `proformasSinFactura`: excluye facturas, borradores, borradas y la casada (por la factura de la lista); ordena por antigüedad; `dias` desde la fecha; sin umbral (una de hoy sale con 0).
2. `resumenProformas`: suma importe (liquido ?? total) y pagadas.
3. `sugerirProformas`: otro proveedor no sale; mismo proveedor por `proveedor_id` aunque el NIF falte; casada no sale; textil con no textil no sale; puntos por referencia, total, base, unidades y fecha; orden.
4. `regularizacionPrevista`: (a) igual → sin movimientos y `diferencia_sin_aplicar` 0; (b) factura +2 uds → `entran 2` al cF; (c) factura −3 → `salen 3`; (d) solo factura y solo proforma; (e) mismo número y +0,50 €/ud con stock completo → ajuste `m×d`, sin aplicar 0; (f) con la mitad vendida → ajuste sobre lo que queda y el resto en `importe_sin_aplicar`; (g) bajada que dejaría coste negativo → tope; (h) variante nueva (`stock_id` null) entra entera; (i) P7 en (b)–(f): `valor_proforma + valor_entradas + valor_devoluciones + importe_ajustes + diferencia_sin_aplicar = base`; (j) más unidades **y** otro coste con parte vendida (P=10 a 5, F=12 a 6, saldo 2) → `unidades_ajustadas = 2`, `importe_ajuste = 2` (no 4).
4b. `devueltasAntesDeFactura`: solo las variantes con `devueltas > 0`.
5. `estadoFilaRegularizacion` en los seis estados.
6. `pagoPrevisto`: pagada con mismo líquido (`revisarSiEnlazada` false), distinto (true), pendiente con líquido distinto (true: el enlace, si lo hay, también queda por revisar).
7. `gruposPorLineaPapel`: consecutivas juntas, nulas sueltas.
8. `pasaFiltroDocumento` y `comprasParaDevolucion`.

`cola-compras.test.ts`: esquema JSON con `tipo_documento`/`referencia_proforma`/`linea_papel` en `required`, cero uniones; zod acepta `""`/`"factura"`/`"proforma"` y un valor raro da `null`; `tipoDocumentoLeido`/`referenciaProformaDe`; `duplicadosDe` no marca el par proforma↔factura con mismo número ni con misma fecha e importe, y sí dos proformas con el mismo número; `motivosRevision` con los tres motivos nuevos.
`factura-compra.test.ts`: `normalizarCompra` con `linea_papel` («3» → 3, «» → null, «0» → null), `importe_linea_papel` y `tipo_documento`; `revisarCompra`: «S:2 M:3 L:1» partida que suma la línea → sin aviso; que no la suma por 0,01 → aviso; importes de línea distintos en el mismo grupo → aviso.
`compras.test.ts`: `importesDeCompra`/`comprasQueCuentan` sin proformas. `fiscal.test.ts` (si suma vía `comprasQueCuentan`): una proforma no suma IVA.
`sumatorios-facturas.test.ts`: `totalesCompras` sin proformas y con `proformas`.
`archivo.test.ts`: la proforma no entra.
`pagos-proveedores.test.ts`: casada excluida; `anticiposProveedores`.
`controles-almacen.test.ts`: par que cuadra (con `sinAplicar`), par con descuadre, proforma sin factura (no rompe `todoEnCero`); las pruebas viejas se adaptan solo en los campos nuevos.
`cuenta-almacen.test.ts`: `valorMovimiento` de `ajuste_coste`; `cuentaAlmacen` lo pone en compras y no en pérdidas; una `devolucion_proveedor` con `regularizacion` va a compras (negativa) y no a pérdidas, y una sin la marca sigue como hoy; identidad exacta.
`gerencia.test.ts`: aviso `proforma_sin_factura`.

---

## 3. SERVIDOR (`src/lib/**`)

### 3.1 `escaner-textil.ts`

```ts
export const MIGRACION_PROFORMAS = "20261029100100";
export const AVISO_MIGRACION_PROFORMAS =
  "Falta aplicar las migraciones 20261029100000 y 20261029100100 (proformas): hasta entonces no se pueden registrar proformas ni casar facturas con ellas.";
/** true si existe proformas_version(). */
export async function proformasAplicado(cliente: unknown): Promise<boolean>;
```
- `lineaDesdeFila`: lee `linea_papel` (número o null).
- `lineaEnvioSimple` y el tipo `LineaEnvio`: incluyen `linea_papel` (de la `LineaLeida`, o null).

### 3.2 `lector-facturas.server.ts`

`INSTRUCCIONES`:
- Primera frase: «Eres un lector de documentos de compra (facturas y proformas) de …».
- Nueva viñeta tras `numero`: «- tipo_documento: "proforma" si el papel dice Proforma, Factura proforma, Pro-forma, Presupuesto/Pedido con pago por adelantado u Order confirmation; "factura" si es una factura (ordinaria o simplificada); si no está claro, "" y dilo en dudas.»
- `numero`: «número del documento (el de la proforma, si es una proforma).»
- Nueva: «- referencia_proforma: si es una factura que cita una proforma o un pedido anterior, ese número; si no, "".»
- Sustituir la viñeta «Cada línea del papel es una línea…» por:
  «- Si una línea del papel trae varias tallas (por ejemplo «S:2 M:3 L:1» o una tabla de tallas en la misma línea), pártela en una línea por prenda, color y talla, con su cantidad, su precio unitario (el de esa talla si el papel lo distingue; si no, el de la línea) y su importe. Las partidas de una línea tienen que sumar EXACTAMENTE el importe de esa línea del papel: si el redondeo no cuadra, ajusta el céntimo en la última partida. En cada partida, linea_papel es el número (1, 2, 3…) de la línea del papel de la que sale. Si el papel no dice cuántas unidades van de cada talla, NO la partas: déjala como está, con linea_papel "", y dilo en dudas. No juntes líneas distintas del papel.»
  «- linea_papel: "" en las líneas que no se parten.»
  «- importe_linea_papel: en cada partida, el importe de la línea del papel de la que sale, tal
  cual está escrito (el mismo en todas las partidas de esa línea); "" en las líneas que no se
  parten.»
- Viñeta `lineas:` de la cabecera: «cada línea del papel (o cada talla, si una línea trae varias
  y se parte) con su tipo, …».
- En «Reglas», la de copiar importes tal cual gana una excepción: «…No los conviertas ni los
  recalcules, salvo el importe de cada partida cuando partes una línea por tallas (cantidad ×
  precio de esa talla, con el céntimo ajustado en la última); importe_linea_papel sí va tal cual.»
  Sin esto, las dos reglas se contradicen y el modelo no parte o recalcula todo.
- Mensaje de usuario: «Lee este documento de compra (factura o proforma).»

### 3.3 `cola-compras.server.ts`

- `CAMPOS_DUPLICADO`: con migración `…, tipo_documento, proforma_id`; si la consulta da
  `faltaLaColumna`, se repite sin ellas.
- `procesarFactura`:
  - `tipo = r.lectura.tipo_documento` (TipoDocumentoCompra | null).
  - `yo` (CompraComparable) lleva `tipo_documento: tipo ?? "factura"`.
  - **Proformas candidatas** (solo si `tipo !== "proforma"`): resolver el proveedor del
    catálogo como `leerMemoriaEscaner` (`escaner-textil.functions.ts`: por `nif_clave`, si no
    por `nombre_clave`); leer `textil_compras` con
    `tipo_documento = 'proforma'`, `estado = 'registrada'`, `borrada_en is null` y
    `proveedor_clave = clave` **o** `proveedor_id = <resuelto>` (`.or(...)`), con el select
    `id, proveedor, nif_proveedor, proveedor_id, numero, fecha, categoria, base, total, liquido,
    estado, borrada_en, tipo_documento, estado_pago, fecha_pago` (lo que pide `ProformaFila`;
    sin `lineas`: en la cola la factura aún no tiene variantes y no se puntúan unidades); quitar las casadas
    (`select proforma_id … in(ids)`); `sugerirProformas(documento, filas, casadas)`. Sin la
    migración (`faltaLaColumna`) → ninguna.
  - `motivosRevision({ …, tipoDocumento: tipo, proformas })`.
  - Si `tipo === "proforma"` y `!(await proformasAplicado(supabase))`: motivo extra
    «Es una proforma, pero falta aplicar la migración de proformas: no la registres hasta entonces.»
  - UPDATE de la cabecera: además `tipo_documento: tipo ?? "factura"`; si da `faltaLaColumna`,
    se repite sin él.
  - Líneas: un nivel más en la cadena de respaldo: `conProformas` (`conEscaner` + `linea_papel`)
    → `conEscaner` → `deSiempre`. Si cae de `conProformas` a `conEscaner`, sin motivo extra.

### 3.4 `compras.functions.ts`

- `registroSchema` (zod en la primera línea del `inputValidator`, como hoy) añade:
  ```ts
  tipo_documento: z.enum(TIPOS_DOCUMENTO_COMPRA).optional(),
  proforma_id: z.string().uuid().nullable().optional(),
  ```
  y `lineaRegistroSchema`: `linea_papel: z.number().int().positive().nullable().optional()`.
- `EntradaRegistroCompra` = `z.input<typeof registroSchema>` (sigue igual de nombre).
- `SalidaRegistroCompra = ResultadoRegistro & { atomica: boolean }` (ahora con `tipo_documento`,
  `proforma_id`, `casado`).
- `guardarYRegistrarCompra` handler:
  1. `const conProforma = (cab.tipo_documento ?? "factura") === "proforma" || !!cab.proforma_id;`
  2. Si `conProforma` y `!(await proformasAplicado(context.supabase))` → `throw new Error(AVISO_MIGRACION_PROFORMAS)`. **Nunca** `caminoViejo()` con `conProforma` (tampoco en `faltaLaFuncion`: se lanza el aviso).
  3. Reparto: en textil, `conCostesDeEntrada` **también** para la factura casada y la proforma
     (A1). Si el reparto falla y `conProforma` → se lanza `mensajeErrorEscaner` (no camino viejo).
  4. `_compra` lleva `tipo_documento: cab.tipo_documento ?? "factura"`, `proforma_id: cab.proforma_id ?? null` y `linea_papel` en cada línea (null si no viene).
  5. Salida: lo de hoy más `tipo_documento: resultado.tipo_documento ?? "factura"`,
     `proforma_id: resultado.proforma_id ?? null`, `casado: resultado.casado ?? null`. En el
     camino viejo: `tipo_documento: "factura"`, `proforma_id: null`, `casado: null`.
- `listCompras`: devuelve además `proformas: boolean` (`proformasAplicado`). `select("*, lineas:…")` no cambia (trae las columnas nuevas solas).
- Nueva server function:
  ```ts
  export const entradasDeProforma = createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .inputValidator((d: unknown) => z.object({ proforma_id: z.string().uuid() }).parse(d))
    .handler(async ({ data, context }): Promise<EntradaProforma[]> => …);
  // RPC proforma_entradas con context.supabase; números con Number() (devueltas incluida);
  // faltaLaFuncion → [].
  ```
- `pagarCompra` y `borrarCompra`: sin lógica nueva; los errores E-PRO-11/13 de la base suben tal
  cual (`throw new Error(error.message)`).
- El texto de duplicado de la línea ~188 no cambia.

### 3.5 `conciliacion.functions.ts`

- `FilaDocumento` gana `tipo_documento?: string | null`.
- `CLASE` no cambia; `documentoDe`: `clase: d.tipo === "compra" && d.tipo_documento === "proforma" ? "Proforma" : CLASE[d.tipo]`.
- `leerPendientes`: el `select` de `banco_documentos_por_conciliar` añade `tipo_documento`; si da
  `faltaLaColumna`, se repite sin él.
- `leerDeTablas` (respaldo, **las mismas reglas que SQL**): `COLUMNAS_COMPRA` +
  `, tipo_documento` (respaldo sin ella con `faltaLaColumna`); leer aparte los
  `proforma_id` no nulos de `textil_compras` y apartar de `documentos` las compras cuyo id esté
  entre ellos (proforma casada no conciliable).
- `banco_enlaces()` ya trae `tipo_documento` en el JSON: `documentoDe` lo usa igual.

### 3.6 `gerencia.ts` (ganchos)

- `CAMPOS_COMPRA_POR_MIGRACION`: nueva primera entrada `${…recibida}, tipo_documento`,
  **delante** de las tres de hoy (que se quedan igual). Si sustituyera a la primera, sin la
  migración la cadena caería a la entrada sin `cuota_iva`/`liquido` y el IVA de todas las
  compras se calcularía con los importes viejos. Lo mismo en `CAMPOS_COMPRA_CONTROL_POR_MIGRACION`.
- `useControlesAlmacen`: `CAMPOS_COMPRA_CONTROL_POR_MIGRACION` con primera entrada
  `${CAMPOS_COMPRA_CONTROL}, categoria, borrada_en, tipo_documento, proforma_id, casado_resumen`.
  Tras leer las del rango: leer por id las proformas de las facturas casadas que falten y las
  facturas que apuntan a las proformas del rango (`.in("proforma_id", ids)`, en trozos de 100);
  juntarlas sin repetir. Las entradas se leen para los ids de **todas** (las del rango y las
  añadidas). Entradas: `.in("motivo", ["compra", "ajuste_coste"])` con `importe_ajuste` en el
  select; respaldo: solo `.eq("motivo", "compra")`, sin `importe_ajuste`. **Qué consulta usar se
  decide con `proformasAplicado(supabase)`, no por el error**: sin la migración 100000, el valor
  `'ajuste_coste'` en el filtro da `22P02` (valor de enum no válido), que `faltaLaColumna` no
  reconoce, y la pantalla de controles se rompería.
- `useMovimientosAlmacen`: primera lectura con `importe_ajuste`; si `faltaLaColumna`, la de hoy.
  Además lee los ids de las facturas casadas (`textil_compras` `select("id")`
  `.not("proforma_id", "is", null)`, paginado; con `faltaLaColumna`, ninguno) y marca
  `regularizacion: true` en cada movimiento `devolucion_proveedor` cuyo `compra_id` esté entre
  ellos (2.8). `DatosMovimientosAlmacen` no cambia de forma; las pantallas no cambian.
- `usePagosProveedores`: select con `, tipo_documento` (respaldo a lo de hoy). Leer aparte los
  `proforma_id` no nulos (todas las fechas, paginado; con `faltaLaColumna`, ninguno) y marcar
  `casada: true` en las filas cuyo id esté entre ellos. (`proforma_id` y `fecha_pago` no hacen
  falta en las filas: solo se leen las pendientes.)
- Nuevo:
  ```ts
  /** Proformas registradas, sin borrar y sin factura (compras_proformas_pendientes()). Sin periodo.
   *  null sin la migración. queryKey: ["proformas-pendientes"]. */
  export function useProformasPendientes(): UseQueryResult<ProformaFila[] | null>;
  ```
  Cada fila con `tipo_documento: "proforma"`, `estado: "registrada"`. Sirve a Gerencia (aviso),
  Tesorería (anticipos con `anticiposProveedores`), Textil y el resumen diario.
- `resumenControlesAlmacen`: sin cambios de firma.

### 3.7 Otros

- `archivo.functions.ts`: el `select` de compras añade `tipo_documento` (respaldo sin él); el
  filtro lo hace `entraEnArchivo`.
- `textil.functions.ts` `listMovimientosStock`: select con `, importe_ajuste` (respaldo sin él).
- `pdf-informe-socios.ts`: en la página del almacén, si `almacen.proformasSinFactura?.proformas`
  > 0, una línea «Proformas sin factura: N (X €), la más antigua del dd/mm/aaaa» con `format.ts`;
  en controles, el texto de compras dice que las facturas casadas se comprueban con su proforma.

---

## 4. PANTALLAS (`src/components/**`, `src/routes/**` salvo `routeTree.gen.ts`)

Sin romper la vista de ordenador: tablas con `movil="tarjetas"`, diálogos con las clases de hoy.
Todo número con `eur`, `fechaCorta`, `numero`, `eurUnitario` de `src/lib/format.ts`.

1. **Banner sin migración** (`PaginaCompras.tsx`): si `listCompras` devuelve `proformas: false`,
   tarjeta ámbar con `AVISO_MIGRACION_PROFORMAS` (como `AVISO_MIGRACION_ESCANER`) y se ocultan
   selector de tipo, filtro Documento, tarjeta de proformas y casado.
2. **Badge «Proforma»** junto al número en la tabla (`Badge variant="outline" className="ml-1 border-amber-500 text-amber-700"`) y en `ColaRevision.tsx` (celda Factura). Debajo, en `block text-xs text-muted-foreground`: en la proforma casada «Facturada en n.º X»; en la factura casada «De la proforma n.º Y» (con `facturasPorProforma`).
3. **Filtro Documento**: `useFiltrosUrl({… documento: "todos"})`, `SelectFiltro etiqueta="Documento"` con `FILTROS_DOCUMENTO`; en `filtrados`, `pasaFiltroDocumento`.
4. **Pie**: `totalesCompras` ya sin proformas; rótulo «Total · N facturas · sin M borradores · sin P proformas» (cada «sin» solo si > 0).
5. **Tarjeta `ProformasPendientes.tsx`** (nueva, en `src/components/compras/`), entre `ColaRevision` y `BarraFiltros`, en las dos pantallas, **siempre desde el día 1** y con la lista entera (sin `filtrados` ni periodo): `proformasSinFactura(compras, hoy)` + `resumenProformas`. `Card className="border-amber-500/50"`, `AlertTriangle h-4 w-4 text-amber-600`, título «Proformas sin factura (N)», ayuda «El género ya está en el stock. No cuentan en el IVA ni en Gerencia hasta que llegue su factura y la cases.», `Table movil="tarjetas"` (Proveedor con n.º debajo, Fecha, Días, Total, Pago con `StatusBadge`, acciones «Ver fichero»), `TableFooter` «Total · N proformas» + suma. Sin pendientes: `return null`. En la general, sin las de la cola.
6. **Selector factura/proforma en la revisión** (`RevisarCompraTextil.tsx` y la revisión general de `PaginaCompras.tsx`): `Revision` gana `tipo_documento: TipoDocumentoCompra | null` (de `tipoDocumentoLeido(lectura_ia)` o de la fila en `desdeFila`; en `nueva`, de `compra.tipo_documento ?? null`) y `proforma_id: string | null`. `ToggleGroup` «Factura | Proforma» junto a los campos de cabecera. Si es `null`, pendiente «Elige si es factura o proforma.». Si es proforma: título «Revisar la proforma antes de dar de alta el género» (textil) / «Revisar la proforma» (general) y descripción «No cuenta en el IVA ni en Gerencia; su factura se casa con ella cuando llegue.»; no hay casado. Al registrar se manda `tipo_documento` y `proforma_id`.
7. **Duplicados**: los dos `duplicadosDe` pasan `tipo_documento` (el elegido) y `proforma_id`.
8. **Tarjeta de sugerencia** (nuevo `src/components/compras/CasarProforma.tsx`, usado en las dos revisiones cuando el tipo es factura): `sugerirProformas(documento, paraDuplicados, casadas)`. Estilo `TarjetaQueMirar`: «¿Es la factura de una de estas proformas?», la mejor como `Button variant="outline"` con «n.º · fecha · total · N puntos» y sus motivos; «Elegir otra…» (`Select` con el resto); «No es de ninguna». Elegir pone `proforma_id`; nunca se elige sola. **Si hay alguna sugerencia, registrar exige una respuesta**: mientras no se elija una proforma ni se pulse «No es de ninguna», `pendientes` lleva «Di si esta factura es de una de las proformas sugeridas.» (estado local `sinProforma: boolean` en `Revision`). Motivo: registrar una factura textil sin casar cuando su proforma ya metió el género duplica el stock, y el casado no se puede hacer después (solo al registrar).
9. **Comparación talla a talla** (en `CasarProforma.tsx`, con proforma elegida y textil): `entradasDeProforma({proforma_id})` + `regularizacionPrevista({ proforma, factura: artículos con stock_id de la elección y coste del reparto, stock: catálogo, base_factura })`. Tabla `movil="tarjetas"`: Variante (nombre · color · talla del catálogo), Uds. proforma, Uds. factura, Coste proforma, Coste factura (`eurUnitario`), Qué pasa (badge por `estadoFilaRegularizacion`: «Igual» `bg-emerald-600 hover:bg-emerald-600`; «Otro coste»/«Más»/«Menos» `variant="outline" border-amber-500 text-amber-700`; «Solo en factura»/«Solo en proforma» `variant="destructive"`), Entran, Salen, Ajuste de coste. Pie con Σ y una línea «Sin aplicar (ya vendido o redondeo): X €» si ≠ 0. Si `devueltasAntesDeFactura(entradas)` no está vacía, aviso ámbar encima de la tabla: «La proforma ya tiene N uds devueltas a mano al proveedor ({variantes}). La comparación no las descuenta: si la factura ya no las cobra, la regularización las sacará otra vez del stock.» (A2; decide la persona antes de registrar). Debajo, línea de pago con `pagoPrevisto`: «El pago de la proforma (fecha, importe) pasa a esta factura» con `StatusBadge`; si `revisarSiEnlazada`, «El líquido es distinto (diferencia X €): si el pago está enlazado en el banco, ese enlace quedará por revisar.». En no textil, solo la línea de pago.
10. **Botón**: con proforma elegida, en textil «Registrar factura (regulariza el stock)» (icono `FileText`); en no textil «Registrar factura casada con la proforma». En textil siguen exigiéndose variante en cada línea y reparto que cuadre (A1). Tras registrar, `toast` con el resumen (`casado.stock.entran/salen/importe_ajustes`, enlaces movidos, grupos por revisar). `onSuccess` invalida además `["proformas-pendientes"]`, `["almacen-movimientos"]`, `["almacen-controles"]`, `["gerencia-pagos-proveedores"]`.
11. **Líneas partidas agrupadas**: en la tabla de líneas de la revisión, `gruposPorLineaPapel`; cada grupo con > 1 línea lleva una fila de cabecera fina «Línea N del papel · M tallas · Σ importe» (`text-xs text-muted-foreground`), sin cambiar las columnas.
12. **Pago en modo textil para proformas**: el botón Pagada/Pendiente sale también en `modo="textil"` cuando `tipo_documento === "proforma"` y no está casada. En la proforma casada no sale (se enseña «Pagada con su factura n.º X» o nada). En la factura casada se enseña su estado como cualquier factura.
13. **Gerencia**: `Resumen.tsx` usa `useProformasPendientes()` → `resumenProformas(proformasSinFactura(filas, d.hoy))` y lo pasa a `avisosGerencia` (sin periodo; dependencias del `useMemo` al día). `destinos.ts`: `textoAviso` → «N proforma(s) sin factura (X €); la más antigua, del dd/mm/aaaa (D días).»; `destinoAviso` → `{ to: "/panel/textil/compras", search: { documento: "proformas_pendientes" } }`.
14. **Tesorería** (`Tesoreria.tsx`): bloque «Anticipos a proveedores» tras `PagosProveedores`, con `Explicacion` `g_anticipos_proveedores`: total, nº y tabla por proveedor (`anticiposProveedores`); vacío → `EstadoVacio` o nada (como el resto del fichero). «No depende del periodo».
15. **Gerencia › Textil** (`Textil.tsx`): junto a «compras subidas sin registrar», «N proformas sin factura (X €)» si > 0; en el control de compras, el texto de las filas `par` («Factura n.º X con su proforma n.º Y · sin aplicar Z €») y el contador de proformas sin factura.
16. **Resumen diario** (`ResumenDiario.tsx`): `InformeAlmacen.proformasSinFactura` desde `useProformasPendientes`.
17. **Stock** (`routes/panel/textil/stock.tsx`): `MOTIVO_TEXTO.ajuste_coste = "Ajuste de coste"`; en el historial, para `ajuste_coste` la cantidad se pinta «—» y en la columna de coste `eurConSigno(importe_ajuste)`; el selector de devolución a proveedor usa `comprasParaDevolucion` y pinta «· facturada en n.º X». `MOTIVOS_OTRO` **no** ofrece `ajuste_coste`.

---

## 5. Interfaces compartidas

### 5.1 Base de datos (nombres exactos, snake_case)

| Tabla / función                       | Campo                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `textil_compras`                      | `tipo_documento` (`'factura'\|'proforma'`), `proforma_id` (uuid\|null), `casado_resumen` (jsonb\|null)    |
| `textil_compra_lineas`                | `linea_papel` (int\|null)                                                                                 |
| `textil_stock_movimientos`            | `importe_ajuste` (numeric(14,2)\|null), motivo `ajuste_coste`                                             |
| `proforma_entradas(_proforma_id)`     | `stock_id, unidades, valor, coste_unitario, devueltas`                                                    |
| `compras_proformas_pendientes()`      | `id, empresa_id, proveedor, nif_proveedor, proveedor_id, numero, fecha, categoria, base, total, liquido, estado_pago, fecha_pago, fichero_ruta` |
| `proformas_version()`                 | `1`                                                                                                        |
| `banco_documentos[_por_conciliar]()`  | + `tipo_documento` (última columna)                                                                       |
| `banco_enlaces().documentos[]`        | + `tipo_documento`                                                                                         |
| `textil_compra_guardar_y_registrar`   | entrada: `tipo_documento`, `proforma_id`, `lineas[].linea_papel`; salida: + `tipo_documento`, `proforma_id`, `casado` |
| Lectura IA (`lectura_ia`)             | `tipo_documento` (`"factura"\|"proforma"\|""`), `referencia_proforma` (texto\|`""`), `lineas[].linea_papel` (texto\|`""`), `lineas[].importe_linea_papel` (texto\|`""`) |

### 5.2 Tipos TypeScript (exportados desde `src/dominio/tipos-textil.ts`)

```ts
export const TIPOS_DOCUMENTO_COMPRA = ["factura", "proforma"] as const;
export type TipoDocumentoCompra = (typeof TIPOS_DOCUMENTO_COMPRA)[number];
export const ETIQUETAS_TIPO_DOCUMENTO: Record<TipoDocumentoCompra, string> = {
  factura: "Factura",
  proforma: "Proforma",
};

/** Una variante en la regularización (SQL 1.7 c4 y regularizacionPrevista). */
export type FilaRegularizacion = {
  stock_id: string;                 // o "nueva:<indice>" solo en la previsión
  unidades_proforma: number;
  unidades_factura: number;
  coste_unitario_proforma: number | null;
  coste_unitario_factura: number | null;
  entran: number;
  salen: number;
  unidades_ajustadas: number;
  importe_ajuste: number;
  importe_sin_aplicar: number;
};

export type RegularizacionStock = {
  variantes: FilaRegularizacion[];
  entran: number;
  salen: number;
  valor_proforma: number;
  valor_entradas: number;
  valor_devoluciones: number;       // ≤ 0
  importe_ajustes: number;
  diferencia_sin_aplicar: number;
  movimientos: number;
};

export type PagoTraspasado = {
  enlaces_movidos: number;
  grupos: number;
  grupos_revisar: number;
  estado_pago: "pendiente" | "pagada";
  fecha_pago: string | null;
  proforma_pagada: boolean;       // la proforma estaba pagada al casar
  liquido_proforma: number;       // lo que se pagó (o se debía) por la proforma
  diferencia: number;             // líquido de la factura − liquido_proforma
};

/** textil_compras.casado_resumen de la factura casada, y `casado` del resultado del registro. */
export type ResumenCasado = {
  proforma_id: string;
  stock: RegularizacionStock | null;   // null si no es textil
  pago: PagoTraspasado;
};
```

Los números del JSON de la base llegan como `number` (jsonb); el servidor no los convierte.

Otros tipos que cruzan capas, ya definidos arriba: `ProformaFila`, `ProformaPendiente`,
`ResumenProformas`, `SugerenciaProforma`, `DocumentoParaCasar`, `EntradaProforma`,
`ArticuloFactura`, `StockActual`, `FiltroDocumento` (`proformas.ts`); `AnticiposProveedores`
(`pagos-proveedores.ts`); `Aviso` ampliado (`gerencia.ts`); `InformeAlmacen` ampliado
(`cuenta-almacen.ts`); `ControlCompras`/`FilaControlCompra`/`ResumenControles` ampliados
(`controles-almacen.ts`); `SalidaRegistroCompra`, `entradasDeProforma`, `listCompras().proformas`
(`compras.functions.ts`); `useProformasPendientes` (`gerencia.ts`); `AVISO_MIGRACION_PROFORMAS`,
`proformasAplicado`, `LineaEnvio.linea_papel` (`escaner-textil.ts`).

### 5.3 Quién importa qué

- PANTALLAS importa de `@/dominio/proformas`, `@/dominio/tipos-textil`, `@/dominio/cola-compras`,
  `@/dominio/pagos-proveedores`, `@/lib/compras.functions`, `@/lib/gerencia`,
  `@/lib/escaner-textil`. Nunca de `*.server`.
- SERVIDOR importa de `@/dominio/*` (estático).
- DOMINIO no importa nada de `src/lib`, `src/routes` ni `src/components`.

---

## 6. Ficheros por equipo (disjuntos)

| Equipo    | Ficheros                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQL       | `supabase/migrations/20261029100000_proformas_motivo.sql` (nuevo), `supabase/migrations/20261029100100_proformas_compras.sql` (nuevo), `supabase/reversiones/20261029100000_proformas_motivo.sql` (nuevo), `supabase/reversiones/20261029100100_proformas_compras.sql` (nuevo), `supabase/pruebas/C19_proformas.sql` (nuevo), `supabase/pruebas/probar-migraciones.sh`, `supabase/pruebas/C14_conciliacion_pendientes.sql` (y otra prueba existente solo si falla por esto). |
| DOMINIO   | `src/dominio/proformas.ts` (+ `.test.ts`, nuevos), `tipos-textil.ts`, `cola-compras.ts`, `factura-compra.ts`, `compras.ts`, `fiscal.ts`, `sumatorios-facturas.ts`, `archivo.ts`, `pagos-proveedores.ts`, `controles-almacen.ts`, `cuenta-almacen.ts`, `gerencia.ts`, `definiciones.ts` y sus `.test.ts`.                                                                                                                     |
| SERVIDOR  | `src/lib/escaner-textil.ts`, `lector-facturas.server.ts`, `cola-compras.server.ts`, `compras.functions.ts`, `conciliacion.functions.ts`, `gerencia.ts`, `archivo.functions.ts`, `textil.functions.ts`, `pdf-informe-socios.ts` (y sus `.test.ts` en `src/lib` si existen).                                                                                                                 |
| PANTALLAS | `src/components/compras/PaginaCompras.tsx`, `RevisarCompraTextil.tsx`, `ColaRevision.tsx`, `ProformasPendientes.tsx` (nuevo), `CasarProforma.tsx` (nuevo), `src/components/gerencia/Resumen.tsx`, `destinos.ts`, `Tesoreria.tsx`, `Textil.tsx`, `resumen-diario/ResumenDiario.tsx`, `src/routes/panel/textil/stock.tsx` (y `src/routes/panel/gerencia.tsx` solo si hace falta pasar datos).          |

`docs/proformas/contrato.md` solo lo cambia el arquitecto.

---

## 7. Comprobación final

### 7.1 Lista del orquestador

- [ ] `npm run verify` en verde (lint, tipos, pruebas, compilación).
- [ ] `supabase/pruebas/probar-migraciones.sh` «TODO EN VERDE», con C19 y C14 adaptada.
- [ ] `git diff --stat`: ningún fichero fuera de la sección 6; `src/routeTree.gen.ts` intacto; sin `bun.lock` tocado.
- [ ] `grep -rn "supabaseAdmin" src/lib/*.functions.ts`: solo `await import()` dentro de handlers.
- [ ] Prueba de uniones del esquema de la IA ≤ 16 (hoy 0).
- [ ] Sin migración: `listCompras().proformas === false`, banner ámbar, nada de proformas visible, registrar una factura normal funciona igual que hoy.
- [ ] Mensajes de la base sin cambiar los de hoy (C18 y 60/90 en verde).
- [ ] `grep -nE '^(BEGIN|COMMIT)' supabase/migrations/20261029100100_proformas_compras.sql` vacío; la guarda del enum es su primera sentencia; las cabeceras de los dos ficheros dicen que se aplican en dos ejecuciones separadas.
- [ ] `grep -n 'linea_papel\|importe_linea_papel' src/dominio/cola-compras.ts`: en `required` de las líneas; `uniones` sigue en 0.

### 7.2 Casos SQL de C19 (cada uno una línea BIEN/MAL)

1. Las dos migraciones se aplican dos veces; `proformas_version() = 1`; `ajuste_coste` está en el enum.
2. Las compras de antes quedan `tipo_documento = 'factura'`; `tipo_documento = 'otro'` falla (CHECK).
3. Registrar una **proforma textil** (2 variantes, con porte) mete el stock: entradas `compra` con `compra_id` = proforma; I1; `tipo_documento = 'proforma'`.
4. Una proforma y una factura del mismo proveedor y **mismo número** se registran las dos (índice con tipo); dos proformas con el mismo número no (mensaje de proforma duplicada).
5. `compras_proformas_pendientes()` devuelve la proforma; `banco_documentos()` la da conciliable y con `tipo_documento = 'proforma'`.
6. `authenticated` no puede poner `proforma_id` ni `casado_resumen` (INSERT y UPDATE) → E-PRO-12.
7. Conciliar la proforma con un cargo (`banco_enlazar_como`, conciliada) → proforma `pagada`.
8. Factura **igual** que la proforma, casada → `pg_temp.huella()` del libro sin cambios, 0 movimientos, `proforma_id` puesto, `casado_resumen.stock.movimientos = 0`, `diferencia_sin_aplicar = 0`.
9. El pago pasa: la fila de `banco_conciliaciones` apunta a la factura (`compra_id`), `importe = -liquido` de la factura, mismo `grupo` y `marco_pagada`; la factura `pagada` con la `fecha_pago` de la proforma; hay fila de auditoría del UPDATE con autor.
10. Tras casar: `compras_proformas_pendientes()` ya no la da; `banco_documentos()` la da no conciliable; `banco_enlazar_como` con la proforma → E-PRO-14.
11. Casar la misma proforma con otra factura → E-PRO-5.
12. Factura con **más unidades** (+2 en una talla): entrada `compra` de 2 con `compra_id` = factura, `compra_linea_id` de su línea, coste = cF; P7 al céntimo.
13. Factura con **menos unidades** (−1): `devolucion_proveedor` de −1 al coste medio, `compra_id` = factura.
14. Variante **solo en la factura** entra entera; **solo en la proforma** sale entera.
15. **Precio distinto** con todo el stock: `ajuste_coste` (cantidad 0, `importe_ajuste = round(m×d,2)`), coste medio de la variante sube; `importe_sin_aplicar = 0`.
16. **Precio distinto con parte vendida** (venta antes de casar): ajuste sobre lo que queda; `importe_sin_aplicar` = el resto; la venta conserva su coste.
17. **Bajada** que dejaría el coste negativo: tope, coste ≥ 0.
18. Un `ajuste_coste` desde `authenticated` → E-AJC-4; con cantidad ≠ 0 → E-AJC-1 (o CHECK); sin existencias → E-AJC-2.
19. Líquido distinto y proforma conciliada → grupo `revisar` con `diferencia` = movimiento − (−liquido factura).
20. Proforma **pagada a mano** (sin banco) → la factura nace pagada con esa fecha; `pago.enlaces_movidos = 0`. 20c: factura por más → pendiente con `pago.diferencia` > 0. 20d: factura por menos → pagada, `pago.diferencia` < 0.
21. `authenticated` cambia `estado_pago` de la proforma casada → E-PRO-13.
22. Otro proveedor → E-PRO-6; proforma de otra empresa → E-PRO-2; no registrada → E-PRO-4; un documento que no es proforma → E-PRO-3; proforma con `proforma_id` → E-PRO-8; textil con no textil → E-PRO-7; inexistente → E-PRO-1; tipo raro → E-PRO-9.
23. **No textil**: proforma y factura de `material` casadas → sin movimientos, `casado_resumen.stock = null`, pago traspasado.
24. Borrado lógico de una factura no textil casada → E-PRO-11; de la proforma no textil casada → E-PRO-11.
25. `textil_compra_registrar` con una proforma en borrador → E-PRO-10.
26. Atomicidad: un error en la regularización (p. ej. variante desactivada en la factura) no deja nada (ni stock, ni enlaces movidos, ni `proforma_id`).
27. Inmutables: cambiar `tipo_documento`, `proforma_id` o `casado_resumen` en una registrada falla (como superusuario, por `compra_registrada_cabecera`).
28. `linea_papel` se guarda; `linea_papel = 0` falla (CHECK).
29. `proforma_entradas()` resuelve una variante fusionada a su destino; una devolución a proveedor enlazada a la proforma sale en `devueltas` y no cambia `unidades`.
29b. **Más unidades y otro coste con parte vendida** (P=10 a 5 €, F=12 a 6 €, 8 vendidas antes de casar): `entran 2`, `unidades_ajustadas = 2`, `importe_ajuste = 2,00`, coste medio final 6,0000 (no 6,50).
16c. **Devolución de cliente de la propia proforma** (P=10 a 5 €, vendidas 5, vuelven 2, F=10 a 6 €): `posteriores = 0`, se ajustan las 7 que quedan (+7,00) y el coste queda en 6,0000.
32. Variante de la proforma **retirada** (vendida a 0 y desactivada) y la factura sin ella → E-REG-1, sin tocar nada.
33. Proforma con el mismo proveedor y número que una factura ya registrada sin casar → E-PRO-15; de otro proveedor, o con el número de una factura ya casada, se registra.
29c. `pg_get_functiondef('public.compra_proforma_solo_por_registro()'::regprocedure)` no contiene `NEW.estado_pago` ni `OLD.estado_pago` (compara con `to_jsonb`).
30. `stock_descuadres()` vacío al final; `auditoria_verificar()` sin eslabones rotos.
31. (Fuera de la transacción) reversión: quita columnas y funciones, repone los tres CHECKs y el índice de antes; reaplicar deja `proformas_version() = 1`. Con una proforma registrada, la reversión se niega.

### 7.3 Qué probar a mano (para la entrega a Javier)

1. Subir una proforma textil con una línea «S:2 M:3 L:1» → la cola la marca proforma; en la revisión salen tres líneas agrupadas bajo «Línea 1 del papel»; registrar → stock entra; sale en «Proformas sin factura» y en el aviso de Gerencia.
2. Conciliar su cargo en el banco → en Tesorería sale como anticipo.
3. Subir la factura (una talla con una unidad más y precio distinto) → la revisión propone la proforma; elegirla → tabla talla a talla con «Más» y «Otro coste»; registrar → stock regularizado, el pago pasa a la factura, la proforma desaparece de pendientes, anticipos y conciliables.
4. Gerencia › Fiscal y el ZIP del archivo: solo la factura.
5. Sin las migraciones: banner ámbar y todo lo demás igual.

### 7.4 Fuera de alcance (anotado, no se hace)

- 1:N y N:1 entre proformas y facturas; anular una proforma que nunca se factura (reembolso);
  deshacer un casado.
- `banco_confirmar` sobre un grupo que quedó en `revisar` tras casar llama a
  `banco_aplicar_efectos`, que pone `marco_pagada = false` porque la factura ya estaba pagada:
  deshacer después ese enlace no devolverá la factura a pendiente. Revisar aparte.
- `pagarCompra` sigue sin mirar los enlaces del banco (riesgo ya anotado en el mapa).
- Abonos de proveedor para las devoluciones de la regularización (como las manuales hoy).
- **Para Javier (A2)**: si se devolvieron prendas a mano antes de llegar la factura y la factura
  ya no las cobra, la regularización las saca otra vez (stock por debajo del real). Hoy solo se
  avisa en la comparación (4.9). Alternativa: comparar con las unidades netas de devoluciones;
  falla al revés si el proveedor cobra todo y luego abona aparte. Lo decide él.
- La reversión de 20261029100100 quita `linea_papel` (se pierde la agrupación por línea del
  papel de las compras ya registradas; los importes y unidades no cambian).

---

## 8. Revisión del crítico (20-10-2026)

Contrastado con el código real (`20261028100200_escaner_textil_reglas.sql`,
`20261017100000_conciliacion_motor.sql`, `20261025100000_conciliacion_pendientes.sql`,
`probar-migraciones.sh`, C2/C3/C14/C18, `src/dominio/*`, `src/lib/gerencia.ts`,
`compras.functions.ts`, `lector-facturas.server.ts`) y con `decisiones.md`. Cambios hechos en
este fichero y su motivo:

| #   | Dónde                 | Cambio                                                                                                                                                       | Motivo                                                                                                                                                                                                                                                                                    |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 1 (ficheros)          | 100100 sin `BEGIN`/`COMMIT` propios; guarda inicial que exige `ajuste_coste` en el enum; aplicar las dos en ejecuciones separadas.                            | C19 aplica 100100 dentro de su `BEGIN … ROLLBACK`: un `COMMIT` del fichero la cerraría. En el editor SQL de Supabase, pegar las dos juntas es una sola transacción y el CHECK con `'ajuste_coste'` falla («unsafe use of new value»); la guarda da un mensaje claro.                         |
| R2  | 1.3                   | `compra_proforma_solo_por_registro` compara con `to_jsonb(NEW/OLD)`, no con `NEW.estado_pago`.                                                               | C2 revierte 20261014100000 (quita `estado_pago`, `fecha_pago`) con este trigger puesto; `NEW.estado_pago` rompería cualquier UPDATE de `authenticated` («record has no field»). Mismo patrón que `compra_registrada_cabecera`. Caso 29c en C19.                                           |
| R3  | 1.7 c0/c3 y 2.2       | `u = min(m, max(saldo0 − salen, 0))` con `saldo0` leído ANTES de `entran`; el tope sigue con el saldo y coste medio actuales.                                 | Con el `saldo` de después de c1, las unidades que entran (ya al coste de la factura) se revalorizaban otra vez: P=10 a 5, F=12 a 6, 8 vendidas → ajuste +4 € y coste 6,50 en vez de +2 € y 6,00. Sobrevaloraba el stock. Casos 4(j) y 29b.                                                   |
| R4  | 1.5, 2.2, 4.9, 5.1    | `proforma_entradas` devuelve además `devueltas` (devoluciones a mano enlazadas a la proforma); `EntradaProforma.devueltas`; `devueltasAntesDeFactura`; aviso. | A2 compara unidades brutas: si la factura ya descuenta lo devuelto, la regularización lo saca dos veces (riesgo de stock duplicado a la baja). No se cambia la regla (decisión revisable de Javier, 7.4) pero la persona lo ve antes de registrar.                                         |
| R5  | 2.8, 2.10, 3.6        | Las «salen» de la regularización (`devolucion_proveedor` con `compra_id` = factura casada) van a Compras, no a pérdidas; el gancho las marca `regularizacion`. | `cuentaAlmacen` cuenta toda `devolucion_proveedor` en `perdidas`, que va a Resultados (`costeAlmacenPeriodo`). Una factura con menos unidades que su proforma saldría como pérdida, y esas unidades nunca se pagaron. Simétrico con `ajuste_coste` (A4). Sin tocar pantallas.             |
| R6  | 2.3, 2.4, 3.2, 5.1    | Campo nuevo de la IA `importe_linea_papel` (string, en `required`); `revisarCompra` avisa si las tallas partidas no suman la línea del papel.                  | Decisión 9 exige que las partidas sumen exactamente la línea, pero al partir se pierde el importe original y nadie podía comprobarlo (P9 quedaba solo en «instrucciones»). Cero uniones y cero opcionales nuevos.                                                                       |
| R7  | 3.2                   | El prompt gana la excepción a «copia los importes tal cual» para las partidas, y la viñeta `lineas:` habla de tallas.                                          | Las instrucciones de hoy dicen «no los recalcules» y «no separes una línea en varias»; con la viñeta nueva el modelo recibía órdenes contradictorias.                                                                                                                                      |
| R8  | 2.3                   | Se nombran las dos pruebas existentes de `cola-compras.test.ts` que hay que adaptar.                                                                          | «pide las ocho claves del escáner» y «pide los mismos campos que el esquema» comparan listas exactas: fallarían al añadir claves y el implementador podría borrarlas.                                                                                                                       |
| R9  | 2.6                   | `anticiposProveedores` recibe `ProformaFila[]` (lo que da `useProformasPendientes`), no `CompraPendiente[]`; `CompraPendiente` no gana `fecha_pago`.           | Tipos incompatibles entre capas (`total` nulo, `estado` opcional): Tesorería no compilaba. `usePagosProveedores` solo lee pendientes: `fecha_pago` y `proforma_id` en sus filas sobraban.                                                                                              |
| R10 | 2.2, 4.9              | `pagoPrevisto.revisar` pasa a `revisarSiEnlazada` (= diferencia ≠ 0) con texto condicional.                                                                  | La base pone el grupo en `revisar` si hay enlace bancario y el líquido difiere, esté la proforma pagada o no; una pagada a mano sin enlace no deja nada. La pantalla no sabe si hay enlace: el «pagada && ≠ 0» de antes decía cosas falsas en los dos sentidos.                             |
| R11 | 3.6                   | Controles del almacén: la consulta con `ajuste_coste` se elige con `proformasAplicado`, no por el error; entradas de todas las compras (rango + par).            | Sin la migración 100000, `'ajuste_coste'` en el filtro da `22P02`, que `faltaLaColumna` no reconoce: la pestaña de controles se rompería antes de aplicar las migraciones (regla 0.3).                                                                                                  |
| R12 | 3.6                   | `CAMPOS_COMPRA_POR_MIGRACION`: la entrada nueva va **delante**, las de hoy se quedan.                                                                         | Si sustituía a la primera, sin la migración la cadena caía a la entrada sin `cuota_iva`/`liquido` y el IVA de Gerencia cambiaba.                                                                                                                                                         |
| R13 | 3.3                   | Columnas exactas del select de proformas candidatas en la cola.                                                                                              | Hueco: `sugerirProformas` necesita `ProformaFila` (base, categoría, `proveedor_id`…); el contrato no decía qué leer.                                                                                                                                                                       |
| R14 | 4.8                   | Con sugerencias, registrar exige elegir una proforma o «No es de ninguna».                                                                                    | Registrar una factura textil sin casar, con su proforma ya en el stock, duplica el género, y el casado no se puede hacer después (solo al registrar). Sigue sin casar sola (decisión 5).                                                                                                  |
| R15 | 2.1                   | `LineaRegistro.linea_papel` opcional.                                                                                                                        | Los equipos compilan en paralelo y hay constructores de `LineaRegistro` (servidor, pruebas) que no la ponen.                                                                                                                                                                              |
| R16 | 1.6                   | Tabla de equivalencia entre la numeración de pasos del contrato y la del código.                                                                              | El contrato numeraba 0–8 y el código 0–6 («paso 2» significaba cosas distintas en 1.8a y en el SQL): un implementador tenía que adivinar.                                                                                                                                                  |
| R17 | 1.10                  | `v_num TEXT` en el DECLARE de `banco_enlazar_como`.                                                                                                          | El fragmento usaba una variable que la función no declara: no compilaría.                                                                                                                                                                                                                 |
| R18 | 1.8                   | Nota del orden de bloqueo frente a `banco_desenlazar_como`.                                                                                                   | Bloquean en orden inverso (compra→enlaces / enlaces→compra): un cruce da `deadlock detected`, sin datos a medias. Se acepta y se documenta.                                                                                                                                              |
| R19 | 7.1, 7.2, 7.4         | Casos 29b/29c y comprobaciones del orquestador; dos puntos fuera de alcance (A2 para Javier, `linea_papel` en la reversión).                                   | Cubrir R1–R4 con pruebas.                                                                                                                                                                                                                                                                 |

Comprobado y **sin cambios** (el contrato ya estaba bien):

- `stock_compra_con_factura` (`compra` ⇒ `compra_linea_id`): las «entran» llevan la línea de la
  factura y la FK compuesta `(compra_linea_id, compra_id)` la admite. `stock_linea_solo_compra`:
  ni `devolucion_proveedor` ni `ajuste_coste` llevan línea. `stock_compra_id_motivo` y
  `stock_movimiento_signo`/`no_cero` se recrean con `ajuste_coste` y cantidad 0 permitida solo ahí.
  Ninguna prueba existente mira su definición (grep en `supabase/pruebas`).
- Triggers que podrían bloquear la propia función: `compra_registrada_cabecera` solo actúa si
  OLD ya está registrada (la factura pasa de borrador a registrada en el paso 7); los de
  `stock_*` miran `current_user` (dentro de SECURITY DEFINER es el dueño); el `UPDATE` de la caché
  en la rama `ajuste_coste` pone `app.stock_via_movimiento`. `textil_stock_mov_aplicar` corre
  antes que `…_compra_solo_registro` (orden alfabético): si E-AJC-4 salta, la sentencia entera se
  deshace, caché incluida.
- Enum en la misma transacción: solo afecta a CHECKs y a funciones `LANGUAGE sql` que nombren
  `'ajuste_coste'` (ninguna; `proforma_entradas` no lo nombra). En `probar-migraciones.sh` cada
  fichero va con `psql -f` y autocommit; C19 aplica 100000 fuera de su transacción.
- C14: el `DROP FUNCTION` previo a reaplicar 20261025100000 es necesario y suficiente (el
  `CREATE OR REPLACE` con otro tipo de retorno fallaría); su reversión ya hace `DROP`.
  C2/C3/C18 revierten columnas: los índices y CHECKs nuevos que dependen de ellas caen solos y
  C19 los repone.
- IVA/pagos: proforma fuera por `importesDeCompra` (todas las lecturas de Gerencia pasan por
  `comprasQueCuentan`), archivo por `entraEnArchivo`, pie por `totalesCompras`; pagos pendientes
  sin la proforma casada (`casada`), anticipos sin casadas (`compras_proformas_pendientes`); el
  pago se mueve (UPDATE de `compra_id`), no se copia: no hay dos enlaces para el mismo cargo.
  Ningún código suma `fecha_pago` (grep), así que la factura heredando el pago no cuenta doble.
- Concurrencia del casado: proforma bloqueada en el paso 0; la segunda factura espera, y su
  comprobación E-PRO-5 (sentencia nueva en READ COMMITTED) ve la primera; el índice único es la
  red. `banco_enlazar_como` bloquea la compra y luego mira E-PRO-14: no se puede conciliar una
  proforma recién casada.
- Esquema de la IA: `{type: "string", enum: [..., ""]}` y `tOn` no son uniones; todo en
  `required`. Sigue en 0 uniones y sin opcionales nuevos.
- P7 cuadra por construcción (`diferencia_sin_aplicar` es el residuo) y el control del par usa
  los mismos sumandos que la base.

---

## Desvíos dominio (implementador de DOMINIO, 20-10-2026)

Ninguna firma de la sección 2 cambia. Lo que el contrato no fijaba o fijaba de forma ambigua, y
cómo ha quedado:

| #   | Dónde | Qué se ha hecho | Motivo |
| --- | ----- | --------------- | ------ |
| D1  | `regularizacionPrevista` | El coste medio tras la entrada se redondea a 4 decimales también cuando `saldo0 ≤ 0` (`cm = round(cF, 4)`, no `cF` a 8). | Es lo que guarda el trigger (`coste_unitario = round(v_nuevo_coste, 4)`) y lo que lee `SELECT … cm` en c3 para el tope. Con `cF` a 8 decimales el tope podía diferir un céntimo de la base. |
| D2  | `regularizacionPrevista` | Las devoluciones (`salen`) se valoran a `round(−salen × cm, 2)` con `cm` = coste de la variante en `stock` (entran y salen son excluyentes en una variante, así que es el de hoy). Entradas `EntradaProforma` repetidas para el mismo `stock_id` se suman y `cP` se recalcula como `round(Σvalor/Σunidades, 8)` (no se usa el `coste_unitario` de la fila). | Mismo resultado que `proforma_entradas()` (que ya agrupa) y robusto si la capa de servidor no agrupa. |
| D3  | `sugerirProformas` | Textos de `motivos`: «Cita su número», «Mismo total», «Misma base», «Mismas unidades por talla», «Anterior a la factura». Una proforma cuenta como registrada con `estado` `"registrada"` **o ausente** (lo que da `compras_proformas_pendientes()`). En el mapa de unidades de la proforma, una línea sin `tipo` cuenta como artículo; sin líneas con variante no hay punto de unidades. «Mismo total» compara `liquido` solo si los dos lo tienen (no nulo ni vacío). | El contrato solo daba dos ejemplos de texto y no decía qué hacer sin `estado`. |
| D4  | `proformasSinFactura`, `comprasParaDevolucion`, `anticiposProveedores` | Mismo criterio de «registrada»: `estado` `"registrada"` o ausente, y sin `borrada_en`. Sin fecha, la proforma va al final (`dias = null`). | Coherencia entre las tres y con `compras_proformas_pendientes()`. |
| D5  | `comprasParaDevolucion` | Solo textil o sin categoría (como `controlComprasEntradas`). Si la factura casada no tiene número, `facturadaEn = "(sin número)"` (no `null`, que significaría «sin factura»). | Distinguir «sin factura» de «factura sin número». |
| D6  | `pasaFiltroDocumento` | No mira `estado` ni `borrada_en`: solo el tipo y `casadas`. | Los demás filtros de la lista (estado, borradas) siguen siendo los suyos; combinarlos aquí los duplicaría. |
| D7  | `anticiposProveedores` | `hoy` no se usa (`void hoy`): el resultado no depende de la fecha. En `porProveedor`, `facturas` cuenta proformas y `masAntigua` es por `fecha_pago`, como el total. | La firma la fija el contrato; `DeudaProveedor` no tiene campo `proformas`. |
| D8  | `controlComprasEntradas` | Un par cuyas dos compras no tienen ninguna entrada `compra` ni `ajuste_coste` sale `sin_enlace` (como una compra de antes del enlace). Una factura con `proforma_id` cuya proforma **no** está en la lista sale como `tipo: "compra"` (regla de hoy, y descuadrará): el servidor debe añadir el otro miembro (3.6). Una proforma casada cuya factura no está en la lista sale como `proforma_sin_factura`. | Casos que el contrato no cubría. |
| D9  | `revisarCompra` | Si las partidas de un grupo traen `importe_linea_papel` distintos (diferencia ≥ 0,005), sale solo el aviso de «dos importes distintos» y no se comprueba la suma de ese grupo. Las partidas sin `importe_linea_papel` dentro de un grupo que sí lo trae se ignoran para comparar importes, pero su `importe` sí suma. | Con dos importes de referencia no hay con qué comparar la suma. |
| D10 | `normalizarCompra` | Todas las líneas llevan ahora `linea_papel` e `importe_linea_papel` (`null` si no aplican). Se ha adaptado solo ese campo en la prueba «lee tipo, referencia, marca, modelo, color, talla, EAN y pack» (compara con `toEqual`). | La línea gana dos claves; la prueba vieja comparaba el objeto exacto. |
| D11 | Pruebas viejas adaptadas solo en los campos nuevos | `sumatorios-facturas.test.ts` (`proformas: 0`), `controles-almacen.test.ts` («lista vacía» y «todo en cero»: `proformasSinFactura: 0`), y las dos de `cola-compras.test.ts` que nombra R8. | Comparan objetos exactos. |
| D12 | `cuentaAlmacen` | Una `devolucion_proveedor` con `regularizacion === true` va a `compras` y no entra en el `switch` (ni en `devolucionesProveedor` ni en `perdidas`). La documentación de `CuentaAlmacen.compras` lo dice. | Es lo pedido en 2.8; se anota porque cambia lo que suma `compras`. |

Errores de tipos fuera de `src/dominio` que vienen de esta parte (los arreglan sus equipos):
`src/lib/compras.functions.ts` (`ResultadoRegistro` gana `tipo_documento`, `proforma_id`,
`casado`) y `src/components/gerencia/destinos.ts` (`textoAviso` no cubre el aviso
`proforma_sin_factura`).

---

## Desvíos SQL (implementador SQL, 20-10-2026)

Banco: `PG_DIR=/tmp/pg-sql PG_PUERTO=55492 bash supabase/pruebas/probar-migraciones.sh` → «TODO
EN VERDE» con C19 (todos los casos de 7.2, más 5c, 6c, 9c, 18d y 18e) y C14 adaptada.

| #   | Dónde                         | Desvío                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 1.12, reversión de 100100     | La comprobación (proformas, facturas casadas o `ajuste_coste`) se hace **al principio** (antes de quitar las columnas) y el `RAISE` va **al final**, en el mismo `DO` que repone los tres CHECK y `textil_compras_factura_unica`, justo antes del `COMMIT`. Motivo: con el `RAISE` al principio, cada sentencia siguiente del fichero da «current transaction is aborted» (decenas de líneas ERROR en el banco); y con filas `ajuste_coste`, reponer el CHECK viejo fallaría antes con un error críptico. Igual de atómico: si se niega, no queda nada. |
| S2  | 7.1 (`grep -nE '^(BEGIN\|COMMIT)'`) | El grep no sale vacío: encuentra los `BEGIN` de los cuerpos plpgsql (en columna 0, como en todas las migraciones, p. ej. 20261028100200). El fichero no tiene `BEGIN;`/`COMMIT;` de transacción. La comprobación correcta es `grep -nE '^(BEGIN\|COMMIT);'`, que sí sale vacía.                                                                                                                                                                                                       |
| S3  | 1.6 paso 6 (pago)             | En los comentarios del SQL el paso del pago se llama «4b» (entre el 4 y el 5 del código), como pide la regla de numeración de 1.6.                                                                                                                                                                                                                                                                                                                                                                    |
| S4  | 1.11 E-PRO-6                  | El nombre del proveedor del mensaje es `proveedores.nombre` del `proveedor_id` de la proforma y, si no tiene, `textil_compras.proveedor` de la proforma (o «(sin nombre)»).                                                                                                                                                                                                                                                                                                                       |
| S5  | 5.2 `FilaRegularizacion`      | `coste_unitario_proforma`/`coste_unitario_factura` llegan con 8 decimales (`round(…, 8)`, p. ej. `5.50000000`) y las unidades como en la base: siguen siendo `number` en JSON; el servidor no necesita convertir nada.                                                                                                                                                                                                                                                                         |

---

## Desvíos servidor (implementador de SERVIDOR, 20-10-2026)

Ninguna firma de la sección 3 cambia. Lo que el contrato no fijaba, o fijaba de forma ambigua, y
cómo ha quedado:

| #   | Dónde | Qué se ha hecho | Motivo |
| --- | ----- | --------------- | ------ |
| S1  | `cola-compras.server.ts` `proveedorDelCatalogo` | Resolución del proveedor del catálogo simplificada respecto a `leerMemoriaEscaner`: por `nif_clave` si hay NIF; si no, por `nombre_clave`; solo si sale **una** fila. Sin filtro de empresa (lee con el cliente de quien sube, RLS). Sin la tabla o sus columnas → ninguno. | `leerMemoriaEscaner` es una server function con su propia validación; copiar sus cinco ramas para un dato que solo suma un `.or()` no compensaba. Un nombre ambiguo se queda en `proveedor_clave`. |
| S2  | `cola-compras.server.ts` candidatas | `DocumentoParaCasar` sin `liquido` (el borrador aún no tiene el líquido calculado: compara `total`) y `unidades: null`. Las candidatas excluyen el propio id (`.neq("id", id)`). Las casadas se leen con `select("proforma_id").in("proforma_id", ids)`. | Lo que hay en la cola. |
| S3  | `cola-compras.server.ts` | El motivo «Es una proforma, pero falta aplicar…» se exporta como `MOTIVO_PROFORMA_SIN_MIGRACION` (como `MOTIVO_SIN_COLUMNAS_ESCANER`). La búsqueda de duplicados tiene respaldo sin `tipo_documento, proforma_id` (`CAMPOS_DUPLICADO_SIEMPRE`). | Mismo patrón que lo existente. |
| S4  | `compras.functions.ts` `guardarYRegistrarCompra` | La comprobación `proformasAplicado` va al principio del handler (antes de leer la empresa y de validar EAN). Además `caminoViejo()` lanza `AVISO_MIGRACION_PROFORMAS` si `conProforma` (red de seguridad para cualquier ruta que llegue a él, incluido `faltaLaFuncion`). Si el reparto falla con `conProforma`, se lanza `mensajeErrorEscaner` sin consultar `escanerAplicado`. `_compra` lleva siempre `tipo_documento` (`"factura"` por defecto) y `proforma_id` (null): la función de 20261028100200 ignora claves que no conoce y el valor por defecto es el mismo. | A12: nunca camino viejo con proforma. |
| S5  | `compras.functions.ts` `guardarCompra` / `compraSchema` | **Sin cambios**: el borrador guardado desde la pantalla general no lleva `tipo_documento` (solo lo pone la cola, al leer, y el registro). | El contrato no lo pedía; `tipo_documento` se manda al registrar. Si la pantalla quiere guardar el tipo elegido antes de registrar, habría que ampliarlo (avisar al arquitecto). |
| S6  | `entradasDeProforma` | `stock_id` con `String()`, números con `Number(x ?? 0)`. | Las columnas `numeric` llegan como texto. |
| S7  | `conciliacion.functions.ts` | `leerPendientes`: si alguna de las tres clases da `faltaLaColumna` con `tipo_documento`, se repiten las tres sin él. `leerDeTablas`: compras con `COLUMNAS_COMPRA_PROFORMAS` (respaldo `COLUMNAS_COMPRA`) y las proformas casadas leídas aparte (`select proforma_id … not is null`, paginado; con `faltaLaColumna`, ninguna). `COLUMNAS_COMPRA` no cambia: `enlacesDeTablas` (historial sin 20261025100000) la usa en un embebido sin respaldo, y sin esa migración no puede haber la de proformas. | No romper el historial antiguo. |
| S8  | `gerencia.ts` `useMovimientosAlmacen` | Cadena de tres niveles: con `importe_ajuste` → con las del escáner → la de siempre. Los ids de facturas casadas se leen con un ayudante privado `facturasCasadas()`. | Respaldo por columna. |
| S9  | `gerencia.ts` `useControlesAlmacen` | El otro miembro del par solo se busca si se leyó la primera entrada de columnas (con `proforma_id`) **y** `proformasAplicado`. Proformas que faltan, por id con `leerPorIds` (trozos de 150, el estándar del proyecto); facturas de las proformas del rango, `.eq("estado","registrada").in("proforma_id", …)` en trozos de 100. Los añadidos no se filtran por rango (es lo pedido) pero sí por textil, como los demás. | Huecos del contrato. |
| S10 | `gerencia.ts` `usePagosProveedores` | Tres niveles: `… proveedor_id, tipo_documento` → `… proveedor_id` → lo de siempre. Las proformas casadas se leen con `proformasCasadas()` (`id, proforma_id`, paginado). | Respaldo por columna. |
| S11 | `gerencia.ts` `useProformasPendientes` | `filasDeFuncion("compras_proformas_pendientes")` paginada con `leerTodas`, orden `fecha, id`; `faltaLaFuncion` → `null`. | Mismo patrón que `banco_documentos_por_conciliar`. |
| S12 | `pdf-informe-socios.ts` | La línea «Proformas sin factura: N (X €), la más antigua del dd/mm/aaaa» va bajo las tres tarjetas del almacén, en naranja; sin `masAntigua`, sin esa coletilla. Lo de las facturas casadas se añade al párrafo informativo de debajo de los controles (no a la etiqueta de la fila). | Sitio y forma no fijados. |
| S13 | `escaner-textil.ts` | `lineaDesdeFila`: `linea_papel` entero > 0, si no `null`. `LineaEnvio` no cambia de definición (hereda `linea_papel?` de `LineaRegistro`). | — |
| S14 | `lector-facturas.server.ts` | Además de lo pedido, «Devuelve los datos de la factura» pasa a «del documento». | Coherencia con la primera frase. |
| S15 | `textil.functions.ts` `listMovimientosStock` | Antes lanzaba el objeto error (`throw error`); se mantiene igual. | Fuera de alcance. |

Pendiente de otros equipos al terminar SERVIDOR: `src/components/gerencia/destinos.ts`
(`textoAviso` no cubre `proforma_sin_factura`, TS2366), de PANTALLAS. `npm run typecheck` solo
falla por eso; `eslint src/lib`, `prettier --check src/lib` y `vitest run` (72 ficheros, 1282
pruebas) en verde.

---

## Desvíos pantallas (implementador de PANTALLAS, 20-10-2026)

`npm run typecheck`, `npm run test` (72 ficheros, 1282 pruebas) y `npm run build:dev` en verde
con las tres partes juntas; `eslint` sin errores (5 avisos nuevos `react-refresh/only-export-components`
por exportar ayudantes desde `RevisarCompraTextil.tsx` y `CasarProforma.tsx`, como los 7 que ya había).

| #   | Dónde | Qué se ha hecho | Motivo |
| --- | ----- | --------------- | ------ |
| V1  | 4.6, `desdeFila` | `tipo_documento` = `tipoDocumentoLeido(lectura_ia)` solo si la lectura **trae la clave** `tipo_documento`; si no (lecturas de antes de la migración, compras a mano), el de la fila. | La fila de la cola siempre dice `factura` (DEFAULT y `tipo ?? "factura"` del servidor) aunque la IA dudara; y una lectura vieja sin la clave obligaría a elegir en todas las facturas pendientes. |
| V2  | 4.6, `nueva` | «A mano» empieza con `tipo_documento = null` (`COMPRA_VACIA` no lo trae): con la migración hay que elegir factura o proforma también a mano. | Lo pide el contrato (`compra.tipo_documento ?? null`); se anota porque añade un clic a toda compra a mano. |
| V3  | 4.6–4.8 | `tipo_documento` y `proforma_id` solo se mandan a `guardarYRegistrarCompra` con `listCompras().proformas === true` (y `proforma_id` solo si es factura). Sin la migración no se ve el selector, ni la sugerencia, ni hay pendientes nuevos. | A12: la base vieja los ignoraría. |
| V4  | 4.8 | Si la proforma elegida deja de estar entre las sugerencias (se cambia el proveedor, la categoría o el tipo), la tarjeta lo dice con «Quitar» y `pendientes` lleva «La proforma elegida ya no encaja con este documento: elige otra.». «No es de ninguna» se puede volver a pulsar para deshacerlo. | Hueco: sin esto se mandaba un `proforma_id` que la base rechazaría (E-PRO-6/7). |
| V5  | 4.8 | `DocumentoParaCasar.unidades` (textil) se arma en la pantalla sumando `unidadesDeLinea` por `stock_id` de los artículos ya casados; en la revisión general, `unidades: null` y `proveedor_id: null`. `categoria` = la elegida (vacía → null). | El contrato no decía de dónde salía el mapa. |
| V6  | 4.9 | La tabla talla a talla solo sale con el reparto cuadrado (`articulos` = null → «La comparación talla a talla sale cuando el reparto cuadre con la base.»). Variante `nueva:<i>` → «Variante nueva (línea i+1)». Pie: Σ uds. proforma, Σ uds. factura, entran, salen, Σ ajuste (`eurConSigno`), más una línea con los movimientos previstos («Es una previsión: manda lo que calcule la base»). | Sin reparto no hay coste de entrada que comparar. |
| V7  | 4.9, pago | Texto: «[StatusBadge] El pago de la proforma (pagada el dd/mm/aaaa \| pendiente de pago, X €) pasa a esta factura.»; si `revisarSiEnlazada`, la frase condicional del contrato en ámbar. | Concreción del texto. |
| V8  | 4.10 | Toast tras registrar casada: `textoCasado(casado)` («Factura casada con su proforma: entran N uds, salen M uds, ajuste de coste ±X €, K enlaces del banco pasan a la factura, G conciliaciones por revisar, la factura queda pagada/pendiente.»); sin `casado`, el de siempre. En la revisión general, una proforma no textil se registra con «Registrar proforma». `pagar` también invalida `["proformas-pendientes"]`. | Concreción. |
| V9  | 4.2 y 4.12 | En la proforma casada, en la columna Estado: «Pagada con su factura n.º X» solo si esa factura está pagada (si no, nada); el «Pagada el …» de siempre sale también para proformas en `modo="textil"`. Botón de basura oculto en factura casada y proforma casada (A6: la base lo rechaza, E-PRO-11). | A6/A7 en pantalla. |
| V10 | 4.5 | En la tarjeta, columna Pago con `StatusBadge` y, si está pagada, «El dd/mm/aaaa» debajo; «Ver fichero» solo si tiene `fichero_ruta`. `hoy` = `new Date()`. | Concreción. |
| V11 | 4.11 | Ayudantes compartidos en `RevisarCompraTextil.tsx`: `conTipoDocumento`, `sugerenciasDeProforma`, `pendientesDeProforma`, `cabecerasLineaPapel` y el componente `FilaLineaPapel` (Σ con `sumarImportes`); en `CasarProforma.tsx`, `SelectorTipoDocumento` (ToggleGroup) y `textoCasado`. Las filas de cabecera ocupan todas las columnas (`colSpan`) dentro de un `Fragment`. | No crear ficheros fuera de la sección 6; las dos revisiones usan lo mismo. |
| V12 | 4.14 | Tesorería: sin la migración (`null`) o mientras lee, el bloque no se pinta; con datos y 0 proformas pagadas, la tarjeta con «No hay anticipos: ninguna proforma pagada espera su factura.». Enlace «Ver proformas» a Textil › Compras con `documento=proformas_pendientes`. | «Vacío → EstadoVacio o nada»: se sigue el estilo del bloque de pagos. |
| V13 | 4.15 | Textil (Gerencia): la línea de proformas lleva «no cuentan en las compras hasta que llegue su factura» y enlace «Ver»; en controles, una frase con el contador de `resumen.proformasSinFactura` («se comprueban contra sus propias entradas… No es un descuadre.») y, en la tabla de descuadres, `proforma_sin_factura` se titula «Proforma n.º X». | Concreción. |
| V14 | 4.17 | En el selector de devolución a proveedor se añade «proforma» delante del número cuando lo es (además de «· facturada en n.º X»). | Distinguir una proforma de una factura con el mismo número (índice con tipo). |
| V15 | 4.13 | `destinos.ts`: constante nueva `DESTINO_PROFORMAS_PENDIENTES`; el texto pone «día»/«días» en singular/plural. | Concreción. |

Anotado, sin arreglar (fuera de alcance de pantallas):
- La revisión general sin escáner (`RevisarCompra` con categoría textil) no enseña la comparación talla a talla (solo la línea del pago): con las migraciones de proformas el escáner ya está, así que esa rama no debería darse.
- `ConfirmarBorrado` no tiene textos propios para proformas (dice «factura»).
