-- ============================================================================
-- REVERSIÓN de 20261120100000_recargo_equivalencia.sql
-- ============================================================================
-- Repone factura_calcular() (20260902130000), emitir_factura() y
-- anular_factura() (20261031200300) tal como estaban, quita las dos reglas del
-- recargo y las columnas nuevas.
--
-- OJO: borra columnas. Se pierde qué pedidos llevan recargo (la siguiente
-- sincronización no lo vuelve a traer hasta reaplicar la migración) y el
-- recargo congelado de las facturas ya emitidas con él, cuyo total sí lo
-- incluye. Si ya hay facturas emitidas con recargo, no lo reviertas: pídelo
-- antes.
-- ============================================================================

DROP TRIGGER IF EXISTS facturas_recargo_inmutable ON public.facturas;
DROP FUNCTION IF EXISTS public.factura_recargo_inmutable();
DROP TRIGGER IF EXISTS facturas_recargo_del_pedido ON public.facturas;
DROP FUNCTION IF EXISTS public.factura_recargo_del_pedido();

CREATE OR REPLACE FUNCTION public.factura_calcular(_lineas JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH lineas AS (
    SELECT
      COALESCE((l ->> 'descripcion'), '') AS descripcion,
      COALESCE((l ->> 'cantidad')::NUMERIC, 0) AS cantidad,
      COALESCE((l ->> 'unidad'), 'ud') AS unidad,
      COALESCE((l ->> 'precio_unitario')::NUMERIC, 0) AS precio_unitario,
      COALESCE((l ->> 'iva_rate')::NUMERIC, 0) AS iva_rate,
      round(
        COALESCE((l ->> 'cantidad')::NUMERIC, 0)
        * COALESCE((l ->> 'precio_unitario')::NUMERIC, 0)
        * (1 - COALESCE((l ->> 'descuento_pct')::NUMERIC, 0) / 100),
        2
      ) AS base
    FROM jsonb_array_elements(COALESCE(_lineas, '[]'::JSONB)) AS l
  ),
  calculadas AS (
    SELECT *, round(base * iva_rate / 100, 2) AS cuota FROM lineas
  ),
  desglose AS (
    SELECT
      iva_rate AS tipo,
      round(sum(base), 2) AS base,
      round(round(sum(base), 2) * iva_rate / 100, 2) AS cuota
    FROM calculadas
    GROUP BY iva_rate
  )
  SELECT jsonb_build_object(
    'lineas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'descripcion', descripcion,
        'cantidad', cantidad,
        'unidad', unidad,
        'precio_unitario', precio_unitario,
        'iva_rate', iva_rate,
        'subtotal', base,
        'iva', cuota,
        'total', round(base + cuota, 2)
      ) ORDER BY descripcion) FROM calculadas
    ), '[]'::JSONB),
    'desglose_iva', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota)
                       ORDER BY tipo DESC) FROM desglose
    ), '[]'::JSONB),
    'base_imponible', COALESCE((SELECT round(sum(base), 2) FROM desglose), 0),
    'iva_total', COALESCE((SELECT round(sum(cuota), 2) FROM desglose), 0),
    'total', COALESCE((SELECT round(sum(base) + sum(cuota), 2) FROM desglose), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.emitir_factura(_usuario_id uuid, _tienda_id uuid, _receptor jsonb, _lineas jsonb, _fecha date DEFAULT CURRENT_DATE, _fecha_vencimiento date DEFAULT NULL::date, _cliente_id uuid DEFAULT NULL::uuid, _pedido_id uuid DEFAULT NULL::uuid, _notas text DEFAULT NULL::text, _rectifica_a_id uuid DEFAULT NULL::uuid, _motivo_rectificacion text DEFAULT NULL::text, _simplificada boolean DEFAULT false, _sustituye_a_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa UUID;
  v_serie TEXT;
  v_ejercicio INT := EXTRACT(YEAR FROM _fecha)::INT;
  v_numero INT;
  v_serie_id UUID;
  v_calc JSONB;
  v_emisor JSONB;
  v_factura_id UUID;
  v_receptor JSONB := COALESCE(_receptor, '{}'::JSONB);
  v_pedido UUID := _pedido_id;
  v_tipo public.factura_tipo;
  v_ticket RECORD;
  v_previa RECORD;
  r RECORD;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario que emite: una factura no se emite sin autor';
  END IF;

  IF NOT public.is_tienda_member(_usuario_id, _tienda_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta tienda';
  END IF;

  IF jsonb_array_length(COALESCE(_lineas, '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'Una factura sin líneas no se emite';
  END IF;

  IF _rectifica_a_id IS NOT NULL AND COALESCE(TRIM(_motivo_rectificacion), '') = '' THEN
    RAISE EXCEPTION 'Una rectificativa necesita motivo (códigos R1 a R5)';
  END IF;

  IF _rectifica_a_id IS NOT NULL AND (COALESCE(_simplificada, false) OR _sustituye_a_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Una rectificativa se emite solo como rectificativa, no como ticket ni como canje';
  END IF;

  IF COALESCE(_simplificada, false) AND _sustituye_a_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lo que sustituye a un ticket es una factura completa, no otro ticket';
  END IF;

  v_tipo := CASE
              WHEN _rectifica_a_id IS NOT NULL THEN 'rectificativa'
              WHEN COALESCE(_simplificada, false) THEN 'simplificada'
              ELSE 'ordinaria'
            END;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  SELECT t.empresa_id INTO v_empresa FROM public.tiendas t WHERE t.id = _tienda_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'La tienda % no existe o no tiene empresa', _tienda_id;
  END IF;

  -- Los importes antes que el número: si algo no cuadra, se rechaza sin haber
  -- tocado el contador.
  v_calc := public.factura_calcular(_lineas);

  IF v_tipo = 'simplificada' THEN
    v_receptor := public.ticket_receptor(
      v_empresa, v_receptor, _cliente_id, (v_calc ->> 'total')::NUMERIC);
  END IF;

  -- ---- Canje de un ticket por factura completa ----
  IF _sustituye_a_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.facturas WHERE id = _sustituye_a_id FOR UPDATE;
    IF NOT FOUND OR v_ticket.empresa_id IS DISTINCT FROM v_empresa THEN
      RAISE EXCEPTION 'El ticket que se quiere canjear no existe';
    END IF;
    IF v_ticket.tipo <> 'simplificada' THEN
      RAISE EXCEPTION 'Solo se canjea un ticket, y % no lo es',
        public.factura_referencia(v_ticket.serie, v_ticket.ejercicio, v_ticket.numero);
    END IF;
    IF EXISTS (SELECT 1 FROM public.facturas WHERE sustituye_a_id = _sustituye_a_id) THEN
      RAISE EXCEPTION 'El ticket % ya se canjeó por factura',
        public.factura_referencia(v_ticket.serie, v_ticket.ejercicio, v_ticket.numero);
    END IF;
    IF EXISTS (SELECT 1 FROM public.facturas WHERE rectifica_a_id = _sustituye_a_id) THEN
      RAISE EXCEPTION 'El ticket % tiene una rectificativa y ya no se canjea',
        public.factura_referencia(v_ticket.serie, v_ticket.ejercicio, v_ticket.numero);
    END IF;
    IF (v_calc ->> 'total')::NUMERIC <> v_ticket.total THEN
      RAISE EXCEPTION 'La factura tiene que sumar lo mismo que el ticket % (% €), no % €',
        public.factura_referencia(v_ticket.serie, v_ticket.ejercicio, v_ticket.numero),
        v_ticket.total, (v_calc ->> 'total')::NUMERIC;
    END IF;
    IF COALESCE(TRIM(v_receptor ->> 'nombre'), '') = ''
       OR COALESCE(TRIM(v_receptor ->> 'nif'), '') = '' THEN
      RAISE EXCEPTION 'Para canjear un ticket por factura hacen falta el nombre y el NIF del cliente';
    END IF;
    v_pedido := COALESCE(v_pedido, v_ticket.pedido_id);
  END IF;

  -- ---- Un pedido, un documento ----
  -- Con el pedido bloqueado: dos clics seguidos esperan uno al otro y el
  -- segundo encuentra el documento del primero.
  IF v_pedido IS NOT NULL AND v_tipo IN ('ordinaria', 'simplificada') AND _sustituye_a_id IS NULL THEN
    PERFORM 1 FROM public.pedidos WHERE id = v_pedido FOR UPDATE;

    SELECT f.serie, f.ejercicio, f.numero INTO v_previa
      FROM public.facturas f
     WHERE f.pedido_id = v_pedido
       AND f.tipo IN ('ordinaria', 'simplificada')
       AND f.estado NOT IN ('borrador', 'anulada')
       AND NOT EXISTS (SELECT 1 FROM public.facturas x WHERE x.rectifica_a_id = f.id)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'El pedido ya tiene el documento %. Para cambiarlo, rectifícalo primero.',
        public.factura_referencia(v_previa.serie, v_previa.ejercicio, v_previa.numero);
    END IF;
  END IF;

  v_serie := public.empresa_serie(v_empresa, v_tipo);

  -- La fecha no puede ir hacia atrás respecto a la última de la serie.
  PERFORM public.factura_comprobar_fecha(v_empresa, v_serie, v_ejercicio, _fecha);

  -- ---- El número, bajo bloqueo ----
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (v_empresa, NULL, v_serie, v_ejercicio, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;

  SELECT s.id, s.ultimo_numero INTO v_serie_id, v_numero
    FROM public.series_facturacion s
   WHERE s.empresa_id = v_empresa AND s.serie = v_serie AND s.ejercicio = v_ejercicio
     FOR UPDATE;

  v_numero := v_numero + 1;

  UPDATE public.series_facturacion
     SET ultimo_numero = v_numero
   WHERE id = v_serie_id;

  -- ---- Emisor: la sociedad. La tienda pone el nombre comercial y el logo ----
  SELECT jsonb_build_object(
           'razon_social', e.razon_social,
           'cif', e.cif,
           'direccion', e.direccion,
           'codigo_postal', e.codigo_postal,
           'ciudad', e.ciudad,
           'provincia', e.provincia,
           'pais', COALESCE(e.pais, 'España'),
           'email', e.email_fiscal,
           'telefono', e.telefono,
           'nombre_comercial', t.nombre,
           'logo_url', t.logo_url
         )
    INTO v_emisor
    FROM public.empresas e
    JOIN public.tiendas t ON t.id = _tienda_id
   WHERE e.id = v_empresa;

  INSERT INTO public.facturas (
    empresa_id, tienda_id, cliente_id, pedido_id,
    serie, numero, ejercicio, fecha, fecha_vencimiento,
    tipo, rectifica_a_id, motivo_rectificacion, sustituye_a_id,
    base_imponible, iva_total, total,
    estado, notas, emitida_en,
    emisor_snapshot, receptor_snapshot, lineas_snapshot, desglose_iva,
    cliente_nombre, cliente_nif, cliente_direccion,
    emisor_nombre, emisor_cif, emisor_direccion
  ) VALUES (
    v_empresa, _tienda_id, _cliente_id, v_pedido,
    v_serie, v_numero, v_ejercicio, _fecha, _fecha_vencimiento,
    v_tipo, _rectifica_a_id, NULLIF(TRIM(_motivo_rectificacion), ''), _sustituye_a_id,
    (v_calc ->> 'base_imponible')::NUMERIC,
    (v_calc ->> 'iva_total')::NUMERIC,
    (v_calc ->> 'total')::NUMERIC,
    -- El ticket documenta una venta cobrada.
    CASE WHEN v_tipo = 'simplificada' THEN 'pagada' ELSE 'emitida' END::public.factura_estado,
    _notas, now(),
    v_emisor, v_receptor, v_calc -> 'lineas', v_calc -> 'desglose_iva',
    v_receptor ->> 'nombre', v_receptor ->> 'nif', v_receptor ->> 'direccion',
    v_emisor ->> 'razon_social', v_emisor ->> 'cif', v_emisor ->> 'direccion'
  )
  RETURNING id INTO v_factura_id;

  FOR r IN SELECT * FROM jsonb_array_elements(v_calc -> 'lineas') AS l(linea) LOOP
    INSERT INTO public.factura_items (
      factura_id, descripcion, cantidad, unidad,
      precio_unitario, iva_rate, subtotal, iva, total
    ) VALUES (
      v_factura_id,
      r.linea ->> 'descripcion',
      (r.linea ->> 'cantidad')::NUMERIC,
      r.linea ->> 'unidad',
      (r.linea ->> 'precio_unitario')::NUMERIC,
      (r.linea ->> 'iva_rate')::NUMERIC,
      (r.linea ->> 'subtotal')::NUMERIC,
      (r.linea ->> 'iva')::NUMERIC,
      (r.linea ->> 'total')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_factura_id,
    'serie', v_serie,
    'numero', v_numero,
    'ejercicio', v_ejercicio,
    'referencia', public.factura_referencia(v_serie, v_ejercicio, v_numero),
    'tipo', v_tipo,
    'base_imponible', (v_calc ->> 'base_imponible')::NUMERIC,
    'iva_total', (v_calc ->> 'iva_total')::NUMERIC,
    'total', (v_calc ->> 'total')::NUMERIC
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_factura(_usuario_id uuid, _factura_id uuid, _motivo text DEFAULT 'R1'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original RECORD;
  v_lineas JSONB;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  SELECT * INTO v_original FROM public.facturas WHERE id = _factura_id;
  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'La factura % no existe', _factura_id;
  END IF;

  IF v_original.estado = 'borrador' THEN
    RAISE EXCEPTION 'Un borrador no se anula: se descarta.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.facturas WHERE rectifica_a_id = _factura_id) THEN
    RAISE EXCEPTION 'La factura % ya tiene una rectificativa emitida',
      public.factura_referencia(v_original.serie, v_original.ejercicio, v_original.numero);
  END IF;

  -- Las líneas congeladas de la original, con la cantidad cambiada de signo.
  SELECT jsonb_agg(jsonb_build_object(
           'descripcion', l ->> 'descripcion',
           'cantidad', -((l ->> 'cantidad')::NUMERIC),
           'unidad', l ->> 'unidad',
           'precio_unitario', (l ->> 'precio_unitario')::NUMERIC,
           'iva_rate', (l ->> 'iva_rate')::NUMERIC
         ))
    INTO v_lineas
    FROM jsonb_array_elements(COALESCE(v_original.lineas_snapshot, '[]'::JSONB)) AS l;

  IF v_lineas IS NULL THEN
    RAISE EXCEPTION
      'La factura % no tiene líneas congeladas: se emitió antes de este motor y hay que anularla a mano',
      public.factura_referencia(v_original.serie, v_original.ejercicio, v_original.numero);
  END IF;

  RETURN public.emitir_factura(
    _usuario_id            => _usuario_id,
    _tienda_id             => v_original.tienda_id,
    _receptor              => COALESCE(v_original.receptor_snapshot, '{}'::JSONB),
    _lineas                => v_lineas,
    _fecha                 => CURRENT_DATE,
    _cliente_id            => v_original.cliente_id,
    _pedido_id             => v_original.pedido_id,
    _notas                 => format('Anulación de la factura %s', public.factura_referencia(
                                v_original.serie, v_original.ejercicio, v_original.numero)),
    _rectifica_a_id        => _factura_id,
    _motivo_rectificacion  => COALESCE(NULLIF(TRIM(_motivo), ''), 'R1')
  );
END;
$function$;

ALTER TABLE public.facturas
  DROP COLUMN IF EXISTS desglose_recargo,
  DROP COLUMN IF EXISTS recargo_total;
ALTER TABLE public.pedidos DROP COLUMN IF EXISTS recargo_equivalencia;

NOTIFY pgrst, 'reload schema';
