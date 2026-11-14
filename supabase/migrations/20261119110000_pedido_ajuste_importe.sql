-- ============================================================================
-- Ajustar el importe real de un pedido (rebaja)
-- ============================================================================
-- Caso (Javier, 14-11-2026): un pedido de la web lleva 5,99 € de envío que el
-- cliente no pagó porque lo recogió en el local, y sale como «cobrado en
-- parte» para siempre. O el cliente pagó una cantidad acordada distinta del
-- total. Hace falta decir cuánto es en realidad la venta.
--
-- Cómo: una REBAJA, guardada en pedido_devoluciones como un reembolso que no
-- viene de WooCommerce (woo_refund_id NULL) y con su motivo. Así todo lo que
-- ya resta las devoluciones (ventas, cuenta de resultados, cobro web) resta
-- también la rebaja, sin tocar el total del pedido, que es el de la web y la
-- sincronización volvería a escribir. La rebaja va con la fecha del pedido:
-- corrige el precio de esa venta, no es un reembolso de hoy.
--
-- 1. pedido_ajustar_importe(): fija el importe real (con IVA) de un pedido.
--    Deja una sola rebaja por pedido (la actualiza si ya había: borrar es de
--    administrador), nunca por debajo de 0 ni por encima de lo que queda tras
--    los reembolsos de la web. Con el importe real igual a ese máximo, la
--    rebaja queda a 0 (quitada, con su rastro).
-- 2. pedidos_pendientes_cobro: lo pendiente es total − devoluciones (rebajas y
--    reembolsos) − cobrado. Mismas columnas y permisos; sigue sin cancelados.
--
-- Reversible: supabase/reversiones/20261119110000_pedido_ajuste_importe.sql
-- (las rebajas que se hayan guardado se quedan en pedido_devoluciones).

-- ---------------------------------------------------------------------------
-- 1. Fijar el importe real
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedido_ajustar_importe(
  _usuario_id UUID,
  _pedido_id UUID,
  _importe_real NUMERIC,
  _motivo TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_reembolsado NUMERIC;
  v_maximo NUMERIC;
  v_rebaja NUMERIC;
  v_rebaja_id UUID;
  v_motivo TEXT := NULLIF(btrim(COALESCE(_motivo, '')), '');
BEGIN
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  -- Desde el navegador, el autor es quien llama: no vale firmar con otro.
  IF auth.uid() IS NOT NULL AND _usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El autor del cambio tiene que ser quien lo hace'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.usuario_id', COALESCE(_usuario_id::TEXT, ''), true);

  SELECT * INTO v_pedido FROM public.pedidos WHERE id = _pedido_id FOR UPDATE;
  IF NOT FOUND OR NOT public.es_miembro_empresa(_usuario_id, v_pedido.empresa_id) THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_pedido.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El pedido está cancelado: no tiene importe que ajustar'
      USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Di por qué cambia el importe (por ejemplo, «recogió en el local»)'
      USING ERRCODE = '22023';
  END IF;

  -- Los reembolsos de la web no se tocan: la rebaja va sobre lo que queda.
  SELECT COALESCE(sum(d.importe), 0) INTO v_reembolsado
    FROM public.pedido_devoluciones d
   WHERE d.pedido_id = _pedido_id AND d.woo_refund_id IS NOT NULL;
  v_maximo := round(v_pedido.total - v_reembolsado, 2);

  IF _importe_real IS NULL OR _importe_real < 0 OR round(_importe_real, 2) > v_maximo THEN
    RAISE EXCEPTION 'El importe real tiene que estar entre 0 y % €',
      replace(v_maximo::TEXT, '.', ',') USING ERRCODE = '22023';
  END IF;
  v_rebaja := round(v_maximo - _importe_real, 2);

  -- Una sola rebaja por pedido: la anterior se actualiza, no se borra (borrar
  -- es de administrador, y así queda el rastro). Quitarla es dejarla a 0.
  SELECT d.id INTO v_rebaja_id
    FROM public.pedido_devoluciones d
   WHERE d.pedido_id = _pedido_id AND d.woo_refund_id IS NULL
   ORDER BY d.created_at, d.id
   LIMIT 1;
  IF v_rebaja_id IS NULL THEN
    IF v_rebaja > 0 THEN
      INSERT INTO public.pedido_devoluciones (pedido_id, tienda_id, importe, motivo, fecha)
      VALUES (_pedido_id, v_pedido.tienda_id, v_rebaja, 'Rebaja: ' || v_motivo,
              COALESCE(v_pedido.fecha_pedido, now()));
    END IF;
  ELSE
    UPDATE public.pedido_devoluciones
       SET importe = v_rebaja,
           motivo = CASE WHEN v_rebaja > 0 THEN 'Rebaja: ' ELSE 'Rebaja quitada: ' END || v_motivo,
           fecha = COALESCE(v_pedido.fecha_pedido, now()),
           updated_at = now()
     WHERE id = v_rebaja_id;
    -- Si por algún camino hubiera más de una, las demás quedan a 0.
    UPDATE public.pedido_devoluciones
       SET importe = 0, updated_at = now()
     WHERE pedido_id = _pedido_id AND woo_refund_id IS NULL AND id <> v_rebaja_id
       AND importe <> 0;
  END IF;
  RETURN v_rebaja;
END;
$$;

COMMENT ON FUNCTION public.pedido_ajustar_importe(UUID, UUID, NUMERIC, TEXT) IS
  'Fija el importe real (con IVA) de un pedido con una rebaja en pedido_devoluciones '
  '(woo_refund_id NULL, fecha del pedido). Una por pedido; con el importe máximo la quita.';

REVOKE EXECUTE ON FUNCTION public.pedido_ajustar_importe(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_ajustar_importe(UUID, UUID, NUMERIC, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Lo pendiente resta las devoluciones (rebajas y reembolsos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.pedidos_pendientes_cobro
WITH (security_invoker = true) AS
WITH cobrado_tienda AS (
  SELECT c.pedido_id, sum(c.importe) AS cobrado, max(c.fecha) AS ultimo_cobro
    FROM public.cobros c
   WHERE c.pedido_id IS NOT NULL
   GROUP BY c.pedido_id
),
devuelto_tienda AS (
  SELECT d.pedido_id, sum(d.importe) AS devuelto
    FROM public.pedido_devoluciones d
   GROUP BY d.pedido_id
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
       round(p.total - COALESCE(dt.devuelto, 0), 2) AS total,
       COALESCE(ct.cobrado, 0) AS cobrado,
       round(p.total - COALESCE(dt.devuelto, 0), 2) - COALESCE(ct.cobrado, 0) AS pendiente,
       ct.ultimo_cobro
  FROM public.pedidos p
  LEFT JOIN cobrado_tienda ct ON ct.pedido_id = p.id
  LEFT JOIN devuelto_tienda dt ON dt.pedido_id = p.id
 WHERE p.cancelado_en IS NULL
   AND p.estado <> 'cancelado'
   AND round(p.total - COALESCE(dt.devuelto, 0), 2) - COALESCE(ct.cobrado, 0) > 0
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
  'Pedidos vivos de tiendas y textil a los que les falta algo por cobrar. El total '
  'de los de tienda ya resta las devoluciones y rebajas. '
  'security_invoker: respeta la RLS de las tablas que lee.';

REVOKE ALL ON public.pedidos_pendientes_cobro FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.pedidos_pendientes_cobro FROM authenticated;
GRANT SELECT ON public.pedidos_pendientes_cobro TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
