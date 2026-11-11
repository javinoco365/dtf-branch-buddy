-- ============================================================================
-- DTF Y DTF UV EN LOS PRESUPUESTOS DE TIENDA
-- ============================================================================
--
-- QUÉ RESUELVE
--   Un presupuesto no sabía qué líneas eran de DTF UV (lo imprime una
--   subcontrata). Al confirmarlo, el pedido nacía con todos sus metros como
--   DTF, sin metros_uv ni bruta_uv / iva_uv: el coste de la subcontrata no
--   salía y los metros de UV se sumaban a los de la máquina.
--
-- QUÉ CAMBIA
--   presupuesto_items.linea: 'dtf' (por defecto: todo lo de antes) o 'uv'.
--   confirmar_presupuesto(): el pedido lleva en metros_total solo los metros
--   de DTF; en metros_uv los de UV; en bruta_uv e iva_uv la base y el IVA de
--   las líneas de UV; y cada línea del pedido, su línea. Lo demás, igual.
--
-- LO QUE NO TOCA
--   Ninguna fila (la columna nace con 'dtf'). Facturas, cobros, impuestos.
--
-- REQUISITOS
--   20261110100000_linea_dtf_uv y 20261111100000_importes_por_linea.
--
-- REVERSIBLE
--   Sí: volver a crear confirmar_presupuesto() de 20261002100000 y
--   ALTER TABLE public.presupuesto_items DROP COLUMN linea.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

ALTER TABLE public.presupuesto_items
  ADD COLUMN IF NOT EXISTS linea TEXT NOT NULL DEFAULT 'dtf';

DO $$ BEGIN
  ALTER TABLE public.presupuesto_items
    ADD CONSTRAINT presupuesto_item_linea_valida CHECK (linea IN ('dtf', 'uv'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.presupuesto_items.linea IS
  'dtf o uv (DTF UV, lo imprime la subcontrata). Pasa tal cual a la línea del pedido.';

CREATE OR REPLACE FUNCTION public.confirmar_presupuesto(_presupuesto_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_pres RECORD;
  v_tienda RECORD;
  v_prefijo TEXT;
  v_ejercicio INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_numero TEXT;
  v_metros NUMERIC;
  v_metros_uv NUMERIC;
  v_bruta_uv NUMERIC;
  v_iva_uv NUMERIC;
  v_pedido_id UUID;
BEGIN
  -- El bloqueo es lo que impide que dos confirmaciones a la vez creen dos
  -- pedidos del mismo presupuesto.
  SELECT * INTO v_pres
    FROM public.presupuestos
   WHERE id = _presupuesto_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El presupuesto no existe o no es de una tienda tuya';
  END IF;
  IF v_pres.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'El presupuesto % ya es un pedido', v_pres.numero;
  END IF;
  IF v_pres.estado = 'rechazado' THEN
    RAISE EXCEPTION 'El presupuesto % está rechazado: no se confirma', v_pres.numero;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.presupuesto_items WHERE presupuesto_id = _presupuesto_id) THEN
    RAISE EXCEPTION 'El presupuesto % no tiene líneas', v_pres.numero;
  END IF;

  SELECT t.prefijo, t.slug, t.nombre INTO v_tienda
    FROM public.tiendas t WHERE t.id = v_pres.tienda_id;
  -- El mismo prefijo que los presupuestos; si la tienda no tiene, se deduce
  -- como en la migración que lo creó.
  v_prefijo := COALESCE(
    v_tienda.prefijo,
    NULLIF(upper(left(regexp_replace(COALESCE(NULLIF(v_tienda.slug, ''), v_tienda.nombre), '[^A-Za-z0-9]', '', 'g'), 4)), ''),
    'TDA');

  v_numero := public.referencia_documento(
    'PED-' || v_prefijo,
    v_ejercicio,
    public.siguiente_numero(v_pres.empresa_id, 'pedido:' || v_pres.tienda_id::TEXT, v_ejercicio));

  -- Solo lo medido en metros suma metros, cada línea de producto aparte. La
  -- base y el IVA del DTF UV, de sus líneas (el DTF es el resto).
  SELECT COALESCE(sum(i.cantidad) FILTER (WHERE i.unidad = 'm' AND i.linea <> 'uv'), 0),
         COALESCE(sum(i.cantidad) FILTER (WHERE i.unidad = 'm' AND i.linea = 'uv'), 0),
         COALESCE(sum(i.subtotal) FILTER (WHERE i.linea = 'uv'), 0),
         COALESCE(sum(i.iva) FILTER (WHERE i.linea = 'uv'), 0)
    INTO v_metros, v_metros_uv, v_bruta_uv, v_iva_uv
    FROM public.presupuesto_items i WHERE i.presupuesto_id = _presupuesto_id;

  INSERT INTO public.pedidos
    (empresa_id, tienda_id, numero, estado, origen, cliente_id, cliente_nombre,
     cliente_email, cliente_telefono, envio, subtotal, iva, total, metros_total,
     metros_uv, bruta_uv, iva_uv, notas)
  VALUES
    (v_pres.empresa_id, v_pres.tienda_id, v_numero, 'pendiente', 'manual', v_pres.cliente_id,
     v_pres.cliente_nombre, v_pres.cliente_email, v_pres.cliente_telefono, v_pres.envio,
     v_pres.subtotal, v_pres.iva, v_pres.total, v_metros,
     v_metros_uv, round(v_bruta_uv, 2), round(v_iva_uv, 2),
     concat_ws(E'\n', 'Del presupuesto ' || v_pres.numero, NULLIF(TRIM(COALESCE(v_pres.notas, '')), '')))
  RETURNING id INTO v_pedido_id;

  -- Las líneas tal cual: los importes ya están congelados en el presupuesto
  -- y el pedido es lo que el cliente aceptó, céntimo a céntimo.
  INSERT INTO public.pedido_items
    (pedido_id, producto_id, descripcion, cantidad, unidad, precio_unitario, iva_rate,
     subtotal, iva, total, linea)
  SELECT v_pedido_id, i.producto_id, i.descripcion, i.cantidad, i.unidad, i.precio_unitario,
         i.iva_rate, i.subtotal, i.iva, i.total, i.linea
    FROM public.presupuesto_items i
   WHERE i.presupuesto_id = _presupuesto_id
   ORDER BY i.orden;

  UPDATE public.presupuestos
     SET pedido_id = v_pedido_id, estado = 'aceptado'
   WHERE id = _presupuesto_id;

  RETURN v_pedido_id;
END;
$$;
COMMENT ON FUNCTION public.confirmar_presupuesto(UUID) IS
  'Crea el pedido de un presupuesto de tienda en una transacción: cabecera, '
  'líneas congeladas (con su línea de producto, DTF o DTF UV) y enlace. Una '
  'sola vez por presupuesto.';

REVOKE ALL ON FUNCTION public.confirmar_presupuesto(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_presupuesto(UUID) TO authenticated, service_role;
