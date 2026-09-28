-- ============================================================================
-- COBROS PENDIENTES · Lo que queda por cobrar, de las tiendas y del textil
-- ============================================================================
--
-- QUÉ RESUELVE
--   «Cobros pendientes» solo enseñaba facturas. Lo que queda por cobrar de un
--   pedido —un anticipo cobrado y el resto por cobrar, o nada cobrado aún—
--   no aparecía en ningún sitio que lo juntara.
--
-- QUÉ HACE
--   Una vista, pedidos_pendientes_cobro, con una fila por cada pedido vivo (no
--   cancelado) al que le falta algo por cobrar: de las tiendas y del textil,
--   con su total, lo cobrado, lo pendiente y la fecha del último cobro.
--
--   Solo vivos y con saldo: la pantalla recibe lo que tiene que enseñar y no
--   el histórico entero de pedidos para filtrarlo en el navegador.
--
-- SEGURIDAD
--   security_invoker: la vista consulta con los permisos de quien la lee, así
--   que la RLS de pedidos, textil_pedidos y cobros se aplica igual que si se
--   leyeran las tablas. No abre nada que no estuviera ya abierto.
--
-- REVERSIBLE
--   Sí. DROP VIEW public.pedidos_pendientes_cobro. No toca datos.
-- ============================================================================

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
GRANT SELECT ON public.pedidos_pendientes_cobro TO authenticated, service_role;
