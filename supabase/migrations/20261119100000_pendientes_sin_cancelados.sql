-- ============================================================================
-- Pendientes de cobro sin pedidos cancelados
-- ============================================================================
-- Decisión de Javier (14-11-2026): ni los pedidos pendientes ni los cobros
-- pendientes cuentan los cancelados.
--
-- La vista pedidos_pendientes_cobro (20260930100000) descartaba los pedidos de
-- tienda solo por `cancelado_en IS NULL`. Un pedido con estado «cancelado» y
-- sin fecha de cancelación (filas de antes del trigger de estados, o
-- escrituras que no la pusieron) se colaba como deuda. Ahora se descarta
-- también por el estado, como ya se hacía con el textil.
--
-- Misma vista, mismas columnas y mismos permisos (security_invoker: respeta
-- la RLS de las tablas que lee). No toca datos.
-- Reversible: supabase/reversiones/20261119100000_pendientes_sin_cancelados.sql.

CREATE OR REPLACE VIEW public.pedidos_pendientes_cobro
WITH (security_invoker = true) AS
WITH cobrado_tienda AS (
  SELECT c.pedido_id, sum(c.importe) AS cobrado, max(c.fecha) AS ultimo_cobro
    FROM public.cobros c
   WHERE c.pedido_id IS NOT NULL
   GROUP BY c.pedido_id
),
cobrado_textil AS (
  SELECT c.textil_pedido_id, sum(c.importe) AS cobrado, max(c.fecha) AS ultimo_cobro
    FROM public.cobros c
   WHERE c.textil_pedido_id IS NOT NULL
   GROUP BY c.textil_pedido_id
)
SELECT 'tienda'::TEXT AS tipo,
       p.id,
       p.empresa_id,
       p.tienda_id,
       p.numero,
       (p.fecha_pedido AT TIME ZONE 'Europe/Madrid')::DATE AS fecha,
       p.cliente_id,
       p.cliente_nombre,
       COALESCE(p.origen, 'manual') AS origen,
       p.estado::TEXT AS estado,
       round(p.total, 2) AS total,
       COALESCE(ct.cobrado, 0) AS cobrado,
       round(p.total, 2) - COALESCE(ct.cobrado, 0) AS pendiente,
       ct.ultimo_cobro
  FROM public.pedidos p
  LEFT JOIN cobrado_tienda ct ON ct.pedido_id = p.id
 WHERE p.cancelado_en IS NULL
   AND p.estado <> 'cancelado'
   AND round(p.total, 2) - COALESCE(ct.cobrado, 0) > 0
UNION ALL
SELECT 'textil'::TEXT,
       t.id,
       t.empresa_id,
       NULL::UUID,
       t.numero,
       t.fecha,
       t.cliente_id,
       t.cliente_nombre,
       'textil'::TEXT,
       t.estado,
       round(t.total, 2),
       COALESCE(cx.cobrado, 0),
       round(t.total, 2) - COALESCE(cx.cobrado, 0),
       cx.ultimo_cobro
  FROM public.textil_pedidos t
  LEFT JOIN cobrado_textil cx ON cx.textil_pedido_id = t.id
 WHERE t.estado <> 'cancelado'
   AND round(t.total, 2) - COALESCE(cx.cobrado, 0) > 0;

COMMENT ON VIEW public.pedidos_pendientes_cobro IS
  'Pedidos vivos de tiendas y textil a los que les falta algo por cobrar. '
  'security_invoker: respeta la RLS de las tablas que lee.';

REVOKE ALL ON public.pedidos_pendientes_cobro FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.pedidos_pendientes_cobro FROM authenticated;
GRANT SELECT ON public.pedidos_pendientes_cobro TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
