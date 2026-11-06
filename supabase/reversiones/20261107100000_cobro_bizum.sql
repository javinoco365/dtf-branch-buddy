-- ============================================================================
-- REVERSIÓN de 20261107100000_cobro_bizum.sql
-- ============================================================================
-- Devuelve registrar_cobro() a la de 20260929100000_cobros.sql: vuelve a
-- rechazar 'bizum'. El valor 'bizum' se queda en public.cobro_metodo (un
-- ENUM no pierde valores sin recrearlo) y los cobros Bizum ya registrados
-- siguen ahí.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_cobro(
  _pedido_id UUID,
  _textil_pedido_id UUID,
  _fecha DATE,
  _recibido NUMERIC,
  _metodo public.cobro_metodo,
  _es_propina BOOLEAN DEFAULT false,
  _concepto_caja_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_numero TEXT;
  v_total NUMERIC;
  v_cancelado BOOLEAN;
  v_origen TEXT;
  v_cliente_id UUID;
  v_cliente_nombre TEXT;
  v_recibido NUMERIC;
  v_cobrado NUMERIC;
  v_pendiente NUMERIC;
  v_importe NUMERIC;
  v_propina NUMERIC;
  v_concepto RECORD;
  v_caja_id UUID;
  v_cobro_id UUID;
BEGIN
  IF num_nonnulls(_pedido_id, _textil_pedido_id) <> 1 THEN
    RAISE EXCEPTION 'Un cobro es de un pedido de tienda o de un pedido textil, de uno solo';
  END IF;

  v_recibido := round(COALESCE(_recibido, 0), 2);
  IF v_recibido <= 0 THEN
    RAISE EXCEPTION 'El importe tiene que ser mayor que cero';
  END IF;

  IF _metodo NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'Un cobro a mano es en efectivo, con tarjeta o por transferencia';
  END IF;

  -- El bloqueo es lo que impide que dos cobros a la vez se pasen del total.
  IF _pedido_id IS NOT NULL THEN
    SELECT p.empresa_id, p.numero, p.total, p.cancelado_en IS NOT NULL, p.origen,
           p.cliente_id, p.cliente_nombre
      INTO v_empresa, v_numero, v_total, v_cancelado, v_origen,
           v_cliente_id, v_cliente_nombre
      FROM public.pedidos p
     WHERE p.id = _pedido_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido % no existe', _pedido_id;
    END IF;
    IF v_origen = 'woocommerce' THEN
      RAISE EXCEPTION 'El pedido % es de la web: se cobra en la web y su cobro llega al sincronizar',
        v_numero;
    END IF;
    SELECT COALESCE(sum(c.importe), 0) INTO v_cobrado
      FROM public.cobros c WHERE c.pedido_id = _pedido_id;
  ELSE
    SELECT p.empresa_id, p.numero, p.total, p.estado = 'cancelado',
           p.cliente_id, p.cliente_nombre
      INTO v_empresa, v_numero, v_total, v_cancelado, v_cliente_id, v_cliente_nombre
      FROM public.textil_pedidos p
     WHERE p.id = _textil_pedido_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido textil % no existe', _textil_pedido_id;
    END IF;
    SELECT COALESCE(sum(c.importe), 0) INTO v_cobrado
      FROM public.cobros c WHERE c.textil_pedido_id = _textil_pedido_id;
  END IF;

  IF v_cancelado THEN
    RAISE EXCEPTION 'El pedido % está cancelado y no admite cobros', v_numero;
  END IF;

  -- En céntimos: el total de un pedido viejo puede traer más de dos decimales.
  v_pendiente := greatest(round(v_total, 2) - v_cobrado, 0);
  v_importe := least(v_recibido, v_pendiente);
  v_propina := v_recibido - v_importe;

  IF v_propina > 0 AND NOT COALESCE(_es_propina, false) THEN
    RAISE EXCEPTION 'El pedido % solo tiene % € pendientes. Para cobrar % €, marca «propina»: los % € de más se apuntan como propina',
      v_numero, v_pendiente, v_recibido, v_propina;
  END IF;
  IF v_propina = 0 AND COALESCE(_es_propina, false) THEN
    RAISE EXCEPTION 'No sobra nada: el cobro no supera lo pendiente (% €) y no hay propina',
      v_pendiente;
  END IF;

  IF _metodo = 'efectivo' THEN
    IF _concepto_caja_id IS NULL THEN
      RAISE EXCEPTION 'Un cobro en efectivo necesita un concepto de caja';
    END IF;

    SELECT cc.categoria, cc.nombre INTO v_concepto
      FROM public.caja_conceptos cc WHERE cc.id = _concepto_caja_id;
    IF v_concepto.nombre IS NULL THEN
      RAISE EXCEPTION 'El concepto de caja % no existe', _concepto_caja_id;
    END IF;
    IF v_concepto.categoria <> 'ingreso' THEN
      RAISE EXCEPTION '«%» es un concepto de gasto: un cobro va en un concepto de ingreso',
        v_concepto.nombre;
    END IF;

    -- A caja entra todo el efectivo recibido, propina incluida. categoria y
    -- concepto_nombre los sobrescribe el trigger de caja; van porque las
    -- columnas son NOT NULL. El cliente es ya la ficha única, así que va
    -- enlazado; el nombre suelto solo si el pedido no tiene ficha.
    INSERT INTO public.caja_movimientos
      (empresa_id, fecha, categoria, concepto_id, concepto_nombre,
       cliente_id, cliente_nombre, importe, observaciones)
    VALUES
      (v_empresa, _fecha, 'ingreso', _concepto_caja_id, '',
       v_cliente_id, CASE WHEN v_cliente_id IS NULL THEN v_cliente_nombre END,
       v_recibido,
       'Cobro del pedido ' || CASE WHEN _textil_pedido_id IS NOT NULL THEN 'textil ' ELSE '' END
         || v_numero
         || CASE WHEN v_propina > 0 THEN ' (incluye ' || v_propina || ' € de propina)' ELSE '' END)
    RETURNING id INTO v_caja_id;
  ELSIF _concepto_caja_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el cobro en efectivo va a caja: sobra el concepto de caja';
  END IF;

  INSERT INTO public.cobros
    (empresa_id, pedido_id, textil_pedido_id, fecha, importe, propina, metodo,
     caja_movimiento_id, notas)
  VALUES
    (v_empresa, _pedido_id, _textil_pedido_id, _fecha, v_importe, v_propina, _metodo,
     v_caja_id, NULLIF(TRIM(COALESCE(_notas, '')), ''))
  RETURNING id INTO v_cobro_id;

  RETURN v_cobro_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
