-- ============================================================================
-- CONFIRMAR PRESUPUESTO · el presupuesto aceptado se convierte en pedido
-- ============================================================================
--
-- QUÉ RESUELVE
--   El flujo de trabajo es: presupuesto → el cliente lo acepta → «Confirmar»
--   crea el pedido, que luego admite cobros parciales. Hasta ahora un
--   presupuesto de tienda no llevaba a ningún sitio, y el del textil solo se
--   podía convertir en factura, que no es lo que se quiere: el textil no va
--   por factura.
--
-- QUÉ HACE
--   1. confirmar_presupuesto(): crea el pedido de tienda a partir del
--      presupuesto en UNA transacción: cabecera, líneas copiadas tal cual
--      (importes congelados, sin recalcular) y el enlace presupuesto → pedido.
--      Numera el pedido PED-<prefijo>-<año>-<nnnn> con su propio contador por
--      tienda. El presupuesto queda «aceptado».
--   2. textil_presupuestos.pedido_id: el enlace del presupuesto textil con el
--      pedido que sale de él. El pedido textil se crea desde la aplicación,
--      porque arrastra la lógica de stock y reservas de los pedidos textil.
--
-- REGLAS
--   - Un presupuesto se confirma una vez: con el presupuesto bloqueado
--     (FOR UPDATE), si ya tiene pedido, se rechaza. Dos clics a la vez no
--     crean dos pedidos.
--   - Un presupuesto rechazado no se confirma, ni uno sin líneas.
--   - SECURITY INVOKER: corre con los permisos de quien confirma, así que la
--     RLS decide si puede ver el presupuesto y crear pedidos en esa tienda.
--   - Si el pedido se borra, el presupuesto vuelve a quedar sin pedido (ON
--     DELETE SET NULL) y se puede confirmar otra vez.
--
-- REVERSIBLE
--   Sí. DROP FUNCTION confirmar_presupuesto y DROP COLUMN
--   textil_presupuestos.pedido_id. Los pedidos creados se quedan.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Presupuesto de tienda → pedido
-- ---------------------------------------------------------------------------
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

  -- Solo lo medido en metros suma metros impresos.
  SELECT COALESCE(sum(i.cantidad) FILTER (WHERE i.unidad = 'm'), 0) INTO v_metros
    FROM public.presupuesto_items i WHERE i.presupuesto_id = _presupuesto_id;

  INSERT INTO public.pedidos
    (empresa_id, tienda_id, numero, estado, origen, cliente_id, cliente_nombre,
     cliente_email, cliente_telefono, envio, subtotal, iva, total, metros_total, notas)
  VALUES
    (v_pres.empresa_id, v_pres.tienda_id, v_numero, 'pendiente', 'manual', v_pres.cliente_id,
     v_pres.cliente_nombre, v_pres.cliente_email, v_pres.cliente_telefono, v_pres.envio,
     v_pres.subtotal, v_pres.iva, v_pres.total, v_metros,
     concat_ws(E'\n', 'Del presupuesto ' || v_pres.numero, NULLIF(TRIM(COALESCE(v_pres.notas, '')), '')))
  RETURNING id INTO v_pedido_id;

  -- Las líneas tal cual: los importes ya están congelados en el presupuesto
  -- y el pedido es lo que el cliente aceptó, céntimo a céntimo.
  INSERT INTO public.pedido_items
    (pedido_id, producto_id, descripcion, cantidad, unidad, precio_unitario, iva_rate,
     subtotal, iva, total)
  SELECT v_pedido_id, i.producto_id, i.descripcion, i.cantidad, i.unidad, i.precio_unitario,
         i.iva_rate, i.subtotal, i.iva, i.total
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
  'líneas congeladas y enlace. Una sola vez por presupuesto.';

REVOKE ALL ON FUNCTION public.confirmar_presupuesto(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_presupuesto(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Presupuesto textil → pedido textil: el enlace
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_presupuestos
  ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES public.textil_pedidos(id) ON DELETE SET NULL;

-- Un pedido sale de un presupuesto como mucho.
CREATE UNIQUE INDEX IF NOT EXISTS textil_presupuestos_un_pedido
  ON public.textil_presupuestos (pedido_id) WHERE pedido_id IS NOT NULL;

COMMENT ON COLUMN public.textil_presupuestos.pedido_id IS
  'El pedido textil creado al confirmar este presupuesto.';
