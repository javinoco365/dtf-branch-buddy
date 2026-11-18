-- ============================================================================
-- Recargo de equivalencia: el pedido lo recuerda y la factura lo lleva
-- ============================================================================
-- Decisión de Javier (18-11-2026). Un cliente minorista en recargo de
-- equivalencia paga, además del IVA, un 5,2 % sobre la base (1,4 % con el IVA
-- del 10 %; 0,5 % con el del 4 %). La web ya se lo cobra: la clase de impuesto
-- «RE General» de WooCommerce lleva dos tarifas, el IVA al 21 % y el «R.E» al
-- 5,2 %, las dos también sobre el envío. La sincronización lo reconoce en los
-- impuestos del pedido (src/dominio/sync-woo.ts, pidioRecargoWoo) y lo deja en
-- `pedidos.recargo_equivalencia`.
--
-- Qué hace:
--   1. pedidos.recargo_equivalencia (sí/no, por defecto no).
--   2. facturas.recargo_total y facturas.desglose_recargo: el recargo
--      congelado al emitir, aparte del IVA. Las facturas ya emitidas quedan
--      con 0 y sin desglose: no se tocan.
--   3. factura_calcular(): cada línea puede llevar `recargo_rate`. El recargo
--      se calcula como el IVA, por tipo sobre la base sumada de ese tipo, y
--      suma al total. Sin `recargo_rate` el resultado es el de siempre.
--   4. emitir_factura(): guarda el recargo. Es la versión de 20261031200300
--      (con rol_exigir_quien) sin más cambio que esas columnas.
--   5. anular_factura(): la rectificativa lleva el mismo recargo en negativo.
--      Es la versión de 20261031200300 sin más cambio que esa clave.
--   6. Un pedido con recargo no admite ticket: una factura simplificada no
--      puede llevarlo. Igual que con «Quiero factura».
--   7. La factura completa de un pedido con recargo tiene que llevarlo (si la
--      factura lleva IVA): es lo que se cobró. No cuenta para los canjes de
--      un ticket ni para las rectificativas.
--   8. El recargo de una factura emitida no se cambia, como el resto de sus
--      importes.
--
-- Reversible: supabase/reversiones/20261120100000_recargo_equivalencia.sql.
-- La reversión borra columnas: pídelo antes.

-- ---------------------------------------------------------------------------
-- 1 y 2. Columnas
-- ---------------------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS recargo_equivalencia BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos.recargo_equivalencia IS
  'La web cobró recargo de equivalencia (impuesto «R.E» en tax_lines). '
  'Con true, el pedido no admite ticket y su factura lleva el recargo.';

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS recargo_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desglose_recargo JSONB;

COMMENT ON COLUMN public.facturas.recargo_total IS
  'Recargo de equivalencia del documento, congelado al emitir. Suma al total: '
  'total = base_imponible + iva_total + recargo_total.';
COMMENT ON COLUMN public.facturas.desglose_recargo IS
  'Desglose del recargo de equivalencia por tipo, congelado al emitir: '
  '[{tipo, base, cuota}]. Nulo si no lleva.';

-- ---------------------------------------------------------------------------
-- 3. El cálculo
-- ---------------------------------------------------------------------------
-- La misma cuenta que calcularTotales() en src/dominio/importes.ts. Las
-- claves de cada línea son las de siempre; `recargo_rate` y `recargo` solo
-- salen en las que lo llevan, así que el snapshot de una factura sin recargo
-- no cambia.
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
      COALESCE((l ->> 'recargo_rate')::NUMERIC, 0) AS recargo_rate,
      round(
        COALESCE((l ->> 'cantidad')::NUMERIC, 0)
        * COALESCE((l ->> 'precio_unitario')::NUMERIC, 0)
        * (1 - COALESCE((l ->> 'descuento_pct')::NUMERIC, 0) / 100),
        2
      ) AS base
    FROM jsonb_array_elements(COALESCE(_lineas, '[]'::JSONB)) AS l
  ),
  calculadas AS (
    SELECT *,
           round(base * iva_rate / 100, 2) AS cuota,
           round(base * recargo_rate / 100, 2) AS recargo
      FROM lineas
  ),
  desglose AS (
    SELECT
      iva_rate AS tipo,
      round(sum(base), 2) AS base,
      round(round(sum(base), 2) * iva_rate / 100, 2) AS cuota
    FROM calculadas
    GROUP BY iva_rate
  ),
  desglose_re AS (
    SELECT
      recargo_rate AS tipo,
      round(sum(base), 2) AS base,
      round(round(sum(base), 2) * recargo_rate / 100, 2) AS cuota
    FROM calculadas
    WHERE recargo_rate <> 0
    GROUP BY recargo_rate
  ),
  sumas AS (
    SELECT
      COALESCE((SELECT round(sum(base), 2) FROM desglose), 0) AS base,
      COALESCE((SELECT round(sum(cuota), 2) FROM desglose), 0) AS iva,
      COALESCE((SELECT round(sum(cuota), 2) FROM desglose_re), 0) AS recargo
  )
  SELECT jsonb_build_object(
    'lineas', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'descripcion', descripcion,
                 'cantidad', cantidad,
                 'unidad', unidad,
                 'precio_unitario', precio_unitario,
                 'iva_rate', iva_rate,
                 'subtotal', base,
                 'iva', cuota,
                 'total', round(base + cuota + recargo, 2)
               )
               || CASE WHEN recargo_rate <> 0
                       THEN jsonb_build_object('recargo_rate', recargo_rate, 'recargo', recargo)
                       ELSE '{}'::JSONB END
               ORDER BY descripcion) FROM calculadas
    ), '[]'::JSONB),
    'desglose_iva', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota)
                       ORDER BY tipo DESC) FROM desglose
    ), '[]'::JSONB),
    'desglose_recargo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'base', base, 'cuota', cuota)
                       ORDER BY tipo DESC) FROM desglose_re
    ), '[]'::JSONB),
    'base_imponible', (SELECT base FROM sumas),
    'iva_total', (SELECT iva FROM sumas),
    'recargo_total', (SELECT recargo FROM sumas),
    'total', (SELECT round(base + iva + recargo, 2) FROM sumas)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Emitir: guarda el recargo
-- ---------------------------------------------------------------------------
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
    recargo_total, desglose_recargo,
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
    -- Recargo de equivalencia (20261120100000): 0 y sin desglose si no lleva.
    COALESCE((v_calc ->> 'recargo_total')::NUMERIC, 0),
    NULLIF(v_calc -> 'desglose_recargo', '[]'::JSONB),
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
    'recargo_total', COALESCE((v_calc ->> 'recargo_total')::NUMERIC, 0),
    'total', (v_calc ->> 'total')::NUMERIC
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Anular: la rectificativa lleva el mismo recargo
-- ---------------------------------------------------------------------------
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
           'iva_rate', (l ->> 'iva_rate')::NUMERIC,
           -- El recargo de equivalencia de la línea, si lo llevaba (20261120100000).
           'recargo_rate', COALESCE((l ->> 'recargo_rate')::NUMERIC, 0)
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

-- ---------------------------------------------------------------------------
-- 6 y 7. Pedido con recargo: ni ticket, ni factura sin recargo
-- ---------------------------------------------------------------------------
-- Solo al dar de alta el documento. Un documento ya emitido no se toca.
CREATE OR REPLACE FUNCTION public.factura_recargo_del_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero TEXT;
BEGIN
  IF NEW.pedido_id IS NULL OR NEW.tipo IS NULL OR NEW.tipo = 'rectificativa' THEN
    RETURN NEW;
  END IF;
  SELECT p.numero INTO v_numero
    FROM public.pedidos p
   WHERE p.id = NEW.pedido_id AND p.recargo_equivalencia;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo = 'simplificada' THEN
    RAISE EXCEPTION
      'El pedido % lleva recargo de equivalencia: emite factura completa, no ticket.',
      COALESCE(v_numero, NEW.pedido_id::TEXT);
  END IF;

  -- Factura completa: tiene que llevar el recargo que se cobró. Un canje de
  -- ticket copia las líneas del ticket y no puede llevarlo; sin IVA (todo al
  -- 0 %) tampoco hay recargo.
  IF NEW.sustituye_a_id IS NULL
     AND COALESCE(NEW.iva_total, 0) <> 0
     AND COALESCE(NEW.recargo_total, 0) = 0 THEN
    RAISE EXCEPTION
      'El pedido % lleva recargo de equivalencia y la factura no lo incluye.',
      COALESCE(v_numero, NEW.pedido_id::TEXT);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.factura_recargo_del_pedido() IS
  'Un pedido con recargo de equivalencia no admite ticket, y su factura completa lleva el recargo.';

REVOKE EXECUTE ON FUNCTION public.factura_recargo_del_pedido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturas_recargo_del_pedido ON public.facturas;
CREATE TRIGGER facturas_recargo_del_pedido
  BEFORE INSERT ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_recargo_del_pedido();

-- ---------------------------------------------------------------------------
-- 8. El recargo de una factura emitida no cambia
-- ---------------------------------------------------------------------------
-- factura_inmutable() protege el resto de importes; estas dos columnas son
-- nuevas y se protegen aquí, aparte, para no reescribirla.
CREATE OR REPLACE FUNCTION public.factura_recargo_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.estado = 'borrador' THEN
    RETURN NEW;
  END IF;
  IF (NEW.recargo_total, NEW.desglose_recargo) IS DISTINCT FROM
     (OLD.recargo_total, OLD.desglose_recargo) THEN
    RAISE EXCEPTION
      'La factura % está emitida: su recargo de equivalencia no se modifica.',
      public.factura_referencia(OLD.serie, OLD.ejercicio, OLD.numero);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.factura_recargo_inmutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturas_recargo_inmutable ON public.facturas;
CREATE TRIGGER facturas_recargo_inmutable
  BEFORE UPDATE ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_recargo_inmutable();

NOTIFY pgrst, 'reload schema';
