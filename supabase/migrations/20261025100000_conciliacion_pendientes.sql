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
--   Cuatro funciones de solo lectura que devuelven filas, para leerlas como
--   una tabla (con filtros, orden y páginas):
--
--   banco_documentos()
--     Todos los documentos que se concilian con el banco, con la misma forma:
--     facturas recibidas (textil_compras, por su líquido), facturas de tienda
--     (por su total) y facturas de textil (por su total). `conciliable` dice
--     si el motor puede proponerlo: la recibida registrada y no borrada; la
--     de tienda en 'emitida' o 'vencida' (la 'pagada' ya está cobrada por
--     otra vía); la de textil que no está en borrador ni anulada. Son las
--     mismas reglas que aplicaba la pantalla en el navegador.
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
-- SIN ESTA MIGRACIÓN
--   La pantalla no puede leer la ventana: sigue con la conciliación de antes
--   (ingresos contra facturas emitidas, uno a uno) y dice qué migración falta.
--
-- NO TOCA NINGUNA FILA. Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261025100000_conciliacion_pendientes.sql
--   (cuatro DROP FUNCTION; no toca datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Todos los documentos, con la misma forma
-- ---------------------------------------------------------------------------
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
    FROM public.facturas f
  UNION ALL
  SELECT 'textil'::TEXT, t.id, t.empresa_id, t.fecha, t.total::NUMERIC,
         t.cliente_nombre, t.cliente_nif, t.serie, NULL::INTEGER, t.numero,
         t.estado NOT IN ('borrador', 'anulada')
    FROM public.textil_facturas t
$$;

COMMENT ON FUNCTION public.banco_documentos() IS
  'Documentos que se concilian con el banco, con la misma forma: compra (importe = líquido), '
  'factura (total) y textil (total). conciliable: si el motor puede proponerlo. Solo lectura, '
  'con la RLS de quien llama.';

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
  SELECT c.grupo,
         -- Un enlace no mezcla empresas (banco_enlazar lo impide).
         (array_agg(m.empresa_id))[1],
         -- Las filas de un grupo se crean y se confirman juntas: comparten
         -- estado. Si alguna siguiera en «revisar», el grupo entero lo está.
         CASE WHEN bool_or(c.estado = 'revisar') THEN 'revisar' ELSE 'conciliada' END,
         min(c.motivo),
         min(c.diferencia)::NUMERIC,
         max(m.fecha),
         jsonb_agg(DISTINCT jsonb_build_object(
           'id', m.id, 'fecha', m.fecha, 'concepto', m.concepto,
           'importe', m.importe, 'cuenta_id', m.cuenta_id)),
         COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
           'tipo', d.tipo, 'id', d.id, 'fecha', d.fecha, 'importe', d.importe,
           'contraparte', d.contraparte, 'nif', d.nif, 'serie', d.serie,
           'ejercicio', d.ejercicio, 'numero', d.numero))
           FILTER (WHERE d.id IS NOT NULL), '[]'::JSONB)
    FROM public.banco_conciliaciones c
    JOIN public.banco_movimientos m ON m.id = c.movimiento_id
    LEFT JOIN public.banco_documentos() d
           ON d.id = COALESCE(c.factura_id, c.compra_id, c.textil_factura_id)
   GROUP BY c.grupo
$$;

COMMENT ON FUNCTION public.banco_enlaces() IS
  'Un enlace de conciliación por fila (las filas de un mismo grupo, juntas), con la fecha de su '
  'último movimiento y, en JSON, sus movimientos y documentos con importe y referencia.';

-- ---------------------------------------------------------------------------
-- 4. Permisos
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.banco_documentos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_movimientos_por_conciliar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_enlaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_documentos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_movimientos_por_conciliar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_enlaces() TO authenticated, service_role;

-- Que la API vea las funciones nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
