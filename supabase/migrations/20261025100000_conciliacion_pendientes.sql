-- ============================================================================
-- CONCILIACIÓN: LEER SOLO LO QUE TODAVÍA SE PUEDE CONCILIAR
-- ============================================================================
--
-- EL PROBLEMA
--   La pantalla de conciliación mira los 2000 movimientos más recientes y los
--   2000 documentos más recientes de cada clase. Pero esa ventana se llenaba
--   con lo que el motor nunca va a proponer:
--     - Facturas de tienda en 'pagada'. Todos los tickets nacen 'pagada'
--       (20261004100100_tickets.sql), así que con unos 15 tickets al día, en
--       cuatro o cinco meses una factura B2B 'emitida' y sin cobrar quedaba
--       fuera de la ventana: llegaba la transferencia y el motor no la
--       proponía.
--     - Documentos ya enlazados y movimientos ya conciliados o marcados como
--       traspaso.
--   Y el aviso «solo se miran los 2000 más recientes» salía siempre, aunque
--   no quedara nada pendiente fuera.
--
--   Además, para pintar «Conciliados» y «Por revisar» la pantalla recibía
--   todos los enlaces de la historia, y los de movimientos fuera de la
--   ventana salían como «Movimiento antiguo · Documento», sin importe ni
--   referencia.
--
-- QUÉ HACE
--   Cinco funciones de solo lectura que devuelven filas, para leerlas como
--   una tabla (con filtros, orden y páginas):
--
--   banco_documentos()
--     Todos los documentos que se concilian con el banco, con la misma forma:
--     facturas recibidas (textil_compras, por su líquido), facturas de tienda
--     (por su total) y facturas de textil (por su total). `conciliable` dice
--     si el motor puede proponerlo, porque todavía hay algo que cobrar o
--     pagar por el banco:
--       - La recibida: registrada y no borrada.
--       - La de tienda: en 'emitida' o 'vencida'. La 'pagada' ya está cobrada
--         por otra vía, y así nacen los tickets.
--       - La de textil: ni en borrador, ni anulada, ni 'pagada' (así nacen
--         los tickets de textil).
--     Y, en tienda y en textil, tampoco:
--       - La factura que canjea un ticket ya cobrado (en 'pagada' o enlazado
--         con el banco): el cobro es el del ticket, no otro.
--       - El ticket ya canjeado: lo que queda por cobrar es la factura que lo
--         sustituye, y contar los dos sería esperar el mismo cobro dos veces.
--       - La factura anulada entera y sus rectificativas, cuando suman cero y
--         ninguna ha pasado por el banco: no hay nada que cobrar ni que
--         devolver. Si la factura se cobró por el banco (está enlazada), su
--         anulación espera la devolución y sigue contando. Una rectificativa
--         parcial sigue contando siempre: puede haber un abono.
--
--   banco_documentos_por_conciliar()
--     Los conciliables que no están enlazados con ningún movimiento (ni
--     conciliados ni «por revisar»).
--
--   banco_movimientos_por_conciliar()
--     Los movimientos que no están conciliados con nada ni marcados como
--     traspaso entre cuentas propias.
--
--   banco_enlaces()
--     Un enlace por fila (las filas de banco_conciliaciones de un mismo
--     grupo, juntas): su estado, el motivo, la diferencia, la fecha de su
--     último movimiento y, en JSON, sus movimientos y sus documentos con todos
--     los datos para pintarlos. Así las pestañas se leen por páginas y
--     ninguna fila llega sin importe.
--     Primero agrupa lo barato (estado, motivo, diferencia y fecha, solo con
--     banco_conciliaciones y banco_movimientos), y los JSON se calculan
--     después, grupo a grupo y por clave primaria: un filtro por estado o una
--     página de 100 no recorren todas las facturas de la historia, y contar
--     no construye ningún JSON.
--
--   banco_conciliacion_cuantos()
--     En una sola llamada, cuántos enlaces hay por revisar, cuántos
--     conciliados y cuántos traspasos: los números de las pestañas.
--
--   La ventana de la pantalla se aplica sobre las dos «por conciliar», y el
--   aviso solo sale si queda algo pendiente fuera de ella.
--
-- POR QUÉ FUNCIONES Y NO VISTAS
--   Una vista depende de las columnas que lee, y las reversiones de
--   20261014100000 (líquido, borrada_en), 20261016100000 (cuenta_id) y
--   20261017100000 (grupo, traspaso_con…) no podrían quitarlas sin borrarla
--   antes. Una función en SQL no ata las columnas: esas reversiones siguen
--   funcionando igual.
--
-- SEGURIDAD
--   SECURITY INVOKER (la de siempre): leen con los permisos de quien llama,
--   así que la RLS de banco_movimientos, banco_conciliaciones, facturas,
--   textil_compras y textil_facturas se aplica igual que si se leyeran las
--   tablas. No abren nada que no estuviera ya abierto. No escriben nada.
--   Para anon, sin permiso de ejecución.
--
-- SIN ESTA MIGRACIÓN (con 20261017100000 aplicada)
--   La pantalla sigue con el motor (compras, traspasos y «Por revisar»), pero
--   lee la ventana de las tablas como antes: los 2000 más recientes de cada
--   cosa, cobrados o no. Y avisa de que falta esta migración para mirar solo
--   lo pendiente.
--
-- NO TOCA NINGUNA FILA. Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261025100000_conciliacion_pendientes.sql
--   (cinco DROP FUNCTION; no toca datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Todos los documentos, con la misma forma
-- ---------------------------------------------------------------------------
-- Cada rama lee una sola tabla y sin WHERE: así Postgres la junta con las
-- otras dos y, al buscar un documento por su id (banco_enlaces), va a la
-- clave primaria de cada tabla.
--
-- Las excepciones de `conciliable` son conjuntos pequeños (canjes,
-- anulaciones) que se leen una vez por consulta y se comprueban con un
-- NOT IN (una tabla hash), no una subconsulta por factura: con decenas de
-- miles de tickets, lo segundo dispara la estimación de coste y, con ella, la
-- compilación JIT de Postgres, que tarda más que la propia consulta. Los
-- «IS NOT NULL» explícitos son para lo mismo: que la estimación sepa que son
-- pocas filas.
CREATE OR REPLACE FUNCTION public.banco_documentos()
RETURNS TABLE (
  tipo TEXT,
  id UUID,
  empresa_id UUID,
  fecha DATE,
  importe NUMERIC,
  contraparte TEXT,
  nif TEXT,
  serie TEXT,
  ejercicio INTEGER,
  numero TEXT,
  conciliable BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT 'compra'::TEXT, c.id, c.empresa_id, c.fecha, c.liquido::NUMERIC,
         c.proveedor, c.nif_proveedor, NULL::TEXT, NULL::INTEGER, c.numero,
         c.estado = 'registrada' AND c.borrada_en IS NULL
    FROM public.textil_compras c
  UNION ALL
  SELECT 'factura'::TEXT, f.id, f.empresa_id, f.fecha, f.total::NUMERIC,
         f.cliente_nombre, f.cliente_nif, f.serie, f.ejercicio, f.numero::TEXT,
         f.estado IN ('emitida', 'vencida')
         -- La factura que canjea un ticket ya cobrado.
         AND f.id NOT IN (
           SELECT s.id
             FROM public.facturas s
             JOIN public.facturas k ON k.id = s.sustituye_a_id
            WHERE s.sustituye_a_id IS NOT NULL
              AND (k.estado = 'pagada'
                   OR EXISTS (SELECT 1 FROM public.banco_conciliaciones b WHERE b.factura_id = k.id)))
         -- El ticket ya canjeado.
         AND f.id NOT IN (
           SELECT s.sustituye_a_id FROM public.facturas s WHERE s.sustituye_a_id IS NOT NULL)
         -- La anulada entera, o la rectificativa que la anula: la original y
         -- sus rectificativas suman cero y ninguna ha pasado por el banco.
         AND COALESCE(f.rectifica_a_id, f.id) NOT IN (
           SELECT o.id
             FROM public.facturas o
             JOIN public.facturas r ON r.rectifica_a_id = o.id
            WHERE r.rectifica_a_id IS NOT NULL
              AND r.estado NOT IN ('borrador', 'anulada')
            GROUP BY o.id, o.total
           HAVING o.total + sum(r.total) = 0
              AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones b WHERE b.factura_id = o.id)
              AND NOT bool_or(EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                                       WHERE b.factura_id = r.id)))
    FROM public.facturas f
  UNION ALL
  SELECT 'textil'::TEXT, t.id, t.empresa_id, t.fecha, t.total::NUMERIC,
         t.cliente_nombre, t.cliente_nif, t.serie, NULL::INTEGER, t.numero,
         t.estado NOT IN ('borrador', 'anulada', 'pagada')
         AND t.id NOT IN (
           SELECT s.id
             FROM public.textil_facturas s
             JOIN public.textil_facturas k ON k.id = s.sustituye_a_id
            WHERE s.sustituye_a_id IS NOT NULL
              AND (k.estado = 'pagada'
                   OR EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                               WHERE b.textil_factura_id = k.id)))
         AND t.id NOT IN (
           SELECT s.sustituye_a_id FROM public.textil_facturas s WHERE s.sustituye_a_id IS NOT NULL)
         AND COALESCE(t.rectifica_a_id, t.id) NOT IN (
           SELECT o.id
             FROM public.textil_facturas o
             JOIN public.textil_facturas r ON r.rectifica_a_id = o.id
            WHERE r.rectifica_a_id IS NOT NULL
              AND r.estado NOT IN ('borrador', 'anulada')
            GROUP BY o.id, o.total
           HAVING o.total + sum(r.total) = 0
              AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                               WHERE b.textil_factura_id = o.id)
              AND NOT bool_or(EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                                       WHERE b.textil_factura_id = r.id)))
    FROM public.textil_facturas t
$$;

COMMENT ON FUNCTION public.banco_documentos() IS
  'Documentos que se concilian con el banco, con la misma forma: compra (importe = líquido), '
  'factura (total) y textil (total). conciliable: si el motor puede proponerlo (queda algo que '
  'cobrar o pagar por el banco: ni pagada, ni ticket canjeado o canje de un ticket cobrado, ni '
  'anulada entera sin pasar por el banco). Solo lectura, con la RLS de quien llama.';

-- ---------------------------------------------------------------------------
-- 2. Lo que todavía se puede conciliar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_documentos_por_conciliar()
RETURNS TABLE (
  tipo TEXT,
  id UUID,
  empresa_id UUID,
  fecha DATE,
  importe NUMERIC,
  contraparte TEXT,
  nif TEXT,
  serie TEXT,
  ejercicio INTEGER,
  numero TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT d.tipo, d.id, d.empresa_id, d.fecha, d.importe, d.contraparte, d.nif,
         d.serie, d.ejercicio, d.numero
    FROM public.banco_documentos() d
   WHERE d.conciliable
     -- Los id son UUID: no se repiten entre las tres tablas. Una comprobación
     -- por columna, para que cada una use su índice.
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.factura_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.compra_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.textil_factura_id = d.id)
$$;

COMMENT ON FUNCTION public.banco_documentos_por_conciliar() IS
  'Documentos que el motor puede proponer: conciliables y sin enlazar con ningún movimiento '
  '(ni conciliados ni por revisar).';

CREATE OR REPLACE FUNCTION public.banco_movimientos_por_conciliar()
RETURNS TABLE (
  id UUID,
  empresa_id UUID,
  fecha DATE,
  concepto TEXT,
  importe NUMERIC,
  cuenta_id UUID
)
LANGUAGE sql STABLE AS $$
  SELECT m.id, m.empresa_id, m.fecha, m.concepto, m.importe::NUMERIC, m.cuenta_id
    FROM public.banco_movimientos m
   WHERE m.traspaso_con IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.movimiento_id = m.id)
$$;

COMMENT ON FUNCTION public.banco_movimientos_por_conciliar() IS
  'Movimientos sin conciliar con nada y que no son un traspaso entre cuentas propias.';

-- ---------------------------------------------------------------------------
-- 3. Los enlaces, uno por fila, con lo que hace falta para pintarlos
-- ---------------------------------------------------------------------------
-- En dos pasos. `g` agrupa solo lo barato. Los JSON son subconsultas por
-- grupo que leen por clave primaria (el movimiento, y cada documento en su
-- tabla); quien filtra por estado o pide una página no los calcula para los
-- demás grupos, y quien solo cuenta no los calcula nunca.
CREATE OR REPLACE FUNCTION public.banco_enlaces()
RETURNS TABLE (
  grupo UUID,
  empresa_id UUID,
  estado TEXT,
  motivo TEXT,
  diferencia NUMERIC,
  fecha DATE,
  movimientos JSONB,
  documentos JSONB
)
LANGUAGE sql STABLE AS $$
  SELECT g.grupo, g.empresa_id, g.estado, g.motivo, g.diferencia, g.fecha,
         (SELECT jsonb_agg(jsonb_build_object(
                   'id', m.id, 'fecha', m.fecha, 'concepto', m.concepto,
                   'importe', m.importe, 'cuenta_id', m.cuenta_id)
                   ORDER BY m.fecha, m.id)
            FROM public.banco_movimientos m
           WHERE m.id IN (SELECT c.movimiento_id FROM public.banco_conciliaciones c
                           WHERE c.grupo = g.grupo)),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'tipo', d.tipo, 'id', d.id, 'fecha', d.fecha, 'importe', d.importe,
                   'contraparte', d.contraparte, 'nif', d.nif, 'serie', d.serie,
                   'ejercicio', d.ejercicio, 'numero', d.numero)
                   ORDER BY d.fecha, d.id), '[]'::JSONB)
            FROM public.banco_documentos() d
           -- El id del documento sale de su columna tal cual (VALUES) y no
           -- de un COALESCE: con RLS, Postgres solo usa la clave primaria
           -- de facturas si la comparación es «columna = columna».
           WHERE d.id IN (SELECT v.id
                            FROM public.banco_conciliaciones c
                           CROSS JOIN LATERAL (VALUES (c.factura_id), (c.compra_id),
                                                      (c.textil_factura_id)) AS v (id)
                           WHERE c.grupo = g.grupo))
    FROM (
      SELECT c.grupo,
             -- Un enlace no mezcla empresas (banco_enlazar lo impide).
             (array_agg(m.empresa_id))[1] AS empresa_id,
             -- Las filas de un grupo se crean y se confirman juntas: comparten
             -- estado. Si alguna siguiera en «revisar», el grupo entero lo está.
             CASE WHEN bool_or(c.estado = 'revisar') THEN 'revisar' ELSE 'conciliada' END AS estado,
             min(c.motivo) AS motivo,
             min(c.diferencia)::NUMERIC AS diferencia,
             max(m.fecha) AS fecha
        FROM public.banco_conciliaciones c
        JOIN public.banco_movimientos m ON m.id = c.movimiento_id
       GROUP BY c.grupo
    ) g
$$;

COMMENT ON FUNCTION public.banco_enlaces() IS
  'Un enlace de conciliación por fila (las filas de un mismo grupo, juntas), con la fecha de su '
  'último movimiento y, en JSON, sus movimientos y documentos con importe y referencia.';

-- ---------------------------------------------------------------------------
-- 4. Los números de las pestañas, en una llamada
-- ---------------------------------------------------------------------------
-- Cuenta sobre banco_enlaces() para que «por revisar» y «conciliado» sean
-- exactamente los de las pestañas. Sin pedir los JSON, no se construyen.
CREATE OR REPLACE FUNCTION public.banco_conciliacion_cuantos()
RETURNS TABLE (
  revisar BIGINT,
  conciliados BIGINT,
  traspasos BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT count(*) FILTER (WHERE e.estado = 'revisar'),
         count(*) FILTER (WHERE e.estado = 'conciliada'),
         -- Cada traspaso, una vez: desde el lado que sale.
         (SELECT count(*) FROM public.banco_movimientos m
           WHERE m.traspaso_con IS NOT NULL AND m.importe < 0)
    FROM public.banco_enlaces() e
$$;

COMMENT ON FUNCTION public.banco_conciliacion_cuantos() IS
  'Cuántos enlaces por revisar, cuántos conciliados y cuántos traspasos (desde el lado que '
  'sale) hay: los números de las pestañas de la conciliación, en una llamada.';

-- ---------------------------------------------------------------------------
-- 5. Permisos
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.banco_documentos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_movimientos_por_conciliar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_enlaces() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_conciliacion_cuantos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_documentos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_movimientos_por_conciliar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_enlaces() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_conciliacion_cuantos() TO authenticated, service_role;

-- Que la API vea las funciones nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
