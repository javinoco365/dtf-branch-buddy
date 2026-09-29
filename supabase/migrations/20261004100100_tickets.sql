-- ============================================================================
-- TICKETS (2 de 2) · Factura simplificada, serie T y canje por factura
-- ============================================================================
--
-- POR QUÉ
--   Los pedidos pequeños no tienen datos fiscales del cliente, y toda venta
--   necesita al menos una factura simplificada (el «ticket», RD 1619/2012
--   art. 4). El ticket no es una pieza aparte: es un tipo más del mismo motor,
--   con la misma numeración bajo bloqueo, los mismos snapshots y la misma
--   prohibición de editar o borrar lo emitido.
--
-- QUÉ HACE
--   1. empresas: serie de tickets ('T' → T2026/0001) y los dos límites:
--        - 400 €   el general (profesionales, o cuando no se sabe).
--        - 3000 €  a un particular (venta al por menor, art. 4.1.b).
--   2. clientes.tipo_fiscal: particular, profesional o sin indicar.
--   3. Canje: facturas.sustituye_a_id y textil_facturas.sustituye_a_id. Un
--      ticket se canjea por una factura completa NUEVA; el ticket no se toca.
--   4. textil_facturas.textil_pedido_id, para emitir desde el pedido textil.
--   5. emitir_factura() y emitir_factura_textil() aceptan _simplificada y
--      _sustituye_a_id (y la textil, _textil_pedido_id):
--        - El LÍMITE lo comprueba la base: desde el navegador no se salta.
--        - El tipo fiscal que decidió el límite queda congelado en el
--          receptor del ticket.
--        - Un pedido, un documento: no se emite otro mientras el anterior no
--          esté rectificado. Con el pedido bloqueado, así dos clics seguidos
--          no sacan dos tickets.
--        - El ticket nace «pagada»: documenta una venta cobrada. Lo que falte
--          por cobrar se ve en el pedido, no en la lista de facturas.
--   6. La inmutabilidad cubre también sustituye_a_id.
--   7. serie_estado() devuelve también la serie de tickets.
--
-- LO QUE NO HACE
--   Nada de Verifactu. Cuando se integre el proveedor, el tipo de cada
--   registro sale de aquí: simplificada es F2, la ordinaria con sustituye_a_id
--   es F3 y la rectificativa de un ticket es R5.
--
-- REQUISITO
--   Aplicar ANTES 20261004100000_ticket_tipo.sql, en una ejecución aparte.
--
-- SE PUEDE EJECUTAR DOS VECES
--   Columnas con IF NOT EXISTS, restricciones con DROP ... IF EXISTS antes de
--   crear, funciones con CREATE OR REPLACE. Las dos funciones de emisión se
--   borran y se crean de nuevo porque cambia su firma: son código, no datos.
--
-- REVERSIBLE
--   Sí mientras no se haya emitido ningún ticket: son columnas nuevas y
--   funciones. No borra ni modifica ninguna fila existente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La empresa: serie de tickets y límites
-- ---------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS serie_simplificada TEXT NOT NULL DEFAULT 'T',
  ADD COLUMN IF NOT EXISTS limite_simplificada NUMERIC(12,2) NOT NULL DEFAULT 400,
  ADD COLUMN IF NOT EXISTS limite_simplificada_particular NUMERIC(12,2) NOT NULL DEFAULT 3000;

COMMENT ON COLUMN public.empresas.serie_simplificada IS
  'Prefijo de la serie de tickets (facturas simplificadas): T da T2026/0001.';
COMMENT ON COLUMN public.empresas.limite_simplificada IS
  'Importe máximo de un ticket, IVA incluido, salvo a particulares. RD 1619/2012 art. 4.1.a.';
COMMENT ON COLUMN public.empresas.limite_simplificada_particular IS
  'Importe máximo de un ticket a un particular (venta al por menor), IVA incluido. '
  'RD 1619/2012 art. 4.1.b.';

-- Las tres series, distintas entre sí: si dos coincidieran, sus números se
-- mezclarían en un mismo contador.
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_series_distintas;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_series_distintas
  CHECK (serie_factura IS DISTINCT FROM serie_rectificativa
     AND serie_simplificada IS DISTINCT FROM serie_factura
     AND serie_simplificada IS DISTINCT FROM serie_rectificativa);

ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_limites_simplificada;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_limites_simplificada
  CHECK (limite_simplificada > 0 AND limite_simplificada_particular >= limite_simplificada);

-- ---------------------------------------------------------------------------
-- 2. El cliente: particular o profesional
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_fiscal TEXT;

ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_tipo_fiscal_valido;
ALTER TABLE public.clientes ADD CONSTRAINT clientes_tipo_fiscal_valido
  CHECK (tipo_fiscal IS NULL OR tipo_fiscal IN ('particular', 'profesional'));

COMMENT ON COLUMN public.clientes.tipo_fiscal IS
  'particular o profesional. Decide hasta dónde puede llegar un ticket: 3000 € '
  'a un particular, 400 € a un profesional. Vacío cuenta como profesional, que '
  'es el límite seguro.';

-- ---------------------------------------------------------------------------
-- 3. Canje de ticket por factura, y el pedido textil
-- ---------------------------------------------------------------------------
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS sustituye_a_id UUID
    REFERENCES public.facturas(id) ON DELETE RESTRICT;

ALTER TABLE public.textil_facturas
  ADD COLUMN IF NOT EXISTS sustituye_a_id UUID
    REFERENCES public.textil_facturas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS textil_pedido_id UUID
    REFERENCES public.textil_pedidos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.facturas.sustituye_a_id IS
  'Ticket que esta factura completa sustituye (canje). En Verifactu, F3.';
COMMENT ON COLUMN public.textil_facturas.sustituye_a_id IS
  'Ticket que esta factura completa sustituye (canje). En Verifactu, F3.';
COMMENT ON COLUMN public.textil_facturas.textil_pedido_id IS
  'Pedido textil del que sale la factura o el ticket.';

-- Un ticket se canjea una vez.
CREATE UNIQUE INDEX IF NOT EXISTS facturas_sustituye_unica
  ON public.facturas (sustituye_a_id) WHERE sustituye_a_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS textil_facturas_sustituye_unica
  ON public.textil_facturas (sustituye_a_id) WHERE sustituye_a_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS facturas_por_pedido
  ON public.facturas (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_facturas_por_pedido
  ON public.textil_facturas (textil_pedido_id) WHERE textil_pedido_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. La serie de cada tipo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.empresa_serie(
  _empresa_id UUID, _tipo public.factura_tipo
) RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_serie TEXT;
BEGIN
  SELECT CASE _tipo
           WHEN 'rectificativa' THEN e.serie_rectificativa
           WHEN 'simplificada'  THEN e.serie_simplificada
           ELSE e.serie_factura
         END
    INTO v_serie
    FROM public.empresas e WHERE e.id = _empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La empresa % no existe', _empresa_id;
  END IF;
  RETURN COALESCE(v_serie, '');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. El límite del ticket, en un solo sitio
-- ---------------------------------------------------------------------------
-- Devuelve el receptor con el tipo fiscal que decidió el límite, para que
-- quede congelado en el ticket: dentro de cuatro años se tiene que poder ver
-- por qué uno de 1.200 € salió como ticket.
CREATE OR REPLACE FUNCTION public.ticket_receptor(
  _empresa_id UUID, _receptor JSONB, _cliente_id UUID, _total NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo_fiscal TEXT := NULLIF(TRIM(COALESCE(_receptor ->> 'tipo_fiscal', '')), '');
  v_general NUMERIC;
  v_particular NUMERIC;
  v_limite NUMERIC;
BEGIN
  IF v_tipo_fiscal IS NULL AND _cliente_id IS NOT NULL THEN
    SELECT c.tipo_fiscal INTO v_tipo_fiscal FROM public.clientes c WHERE c.id = _cliente_id;
  END IF;

  IF v_tipo_fiscal IS NOT NULL AND v_tipo_fiscal NOT IN ('particular', 'profesional') THEN
    RAISE EXCEPTION 'Tipo fiscal desconocido: «%». Es particular o profesional.', v_tipo_fiscal;
  END IF;

  SELECT e.limite_simplificada, e.limite_simplificada_particular
    INTO v_general, v_particular
    FROM public.empresas e WHERE e.id = _empresa_id;

  v_limite := CASE WHEN v_tipo_fiscal = 'particular' THEN v_particular ELSE v_general END;

  IF _total > v_limite THEN
    IF v_tipo_fiscal = 'particular' THEN
      RAISE EXCEPTION
        'Un ticket a un particular no puede pasar de % € y este suma % €. Emite factura completa.',
        replace(v_limite::TEXT, '.', ','), replace(_total::TEXT, '.', ',');
    ELSE
      RAISE EXCEPTION
        'Un ticket no puede pasar de % € y este suma % €. Si el cliente es un particular, '
        'márcalo (hasta % €); si no, emite factura completa.',
        replace(v_limite::TEXT, '.', ','), replace(_total::TEXT, '.', ','),
        replace(v_particular::TEXT, '.', ',');
    END IF;
  END IF;

  IF v_tipo_fiscal IS NULL THEN
    RETURN COALESCE(_receptor, '{}'::JSONB);
  END IF;
  RETURN COALESCE(_receptor, '{}'::JSONB) || jsonb_build_object('tipo_fiscal', v_tipo_fiscal);
END;
$$;

COMMENT ON FUNCTION public.ticket_receptor(UUID, JSONB, UUID, NUMERIC) IS
  'Comprueba el límite del ticket según el tipo fiscal del cliente y devuelve '
  'el receptor con ese tipo congelado.';

REVOKE EXECUTE ON FUNCTION public.ticket_receptor(UUID, JSONB, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_receptor(UUID, JSONB, UUID, NUMERIC) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Emitir en tiendas
-- ---------------------------------------------------------------------------
-- La firma cambia: la vieja se borra para que no queden dos versiones con el
-- mismo nombre y la API no sepa a cuál llamar.
DROP FUNCTION IF EXISTS public.emitir_factura(
  UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.emitir_factura(
  _usuario_id UUID,
  _tienda_id UUID,
  _receptor JSONB,
  _lineas JSONB,
  _fecha DATE DEFAULT CURRENT_DATE,
  _fecha_vencimiento DATE DEFAULT NULL,
  _cliente_id UUID DEFAULT NULL,
  _pedido_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL,
  _rectifica_a_id UUID DEFAULT NULL,
  _motivo_rectificacion TEXT DEFAULT NULL,
  _simplificada BOOLEAN DEFAULT false,
  _sustituye_a_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.emitir_factura(
  UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura(
  UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Emitir en textil
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.emitir_factura_textil(
  UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.emitir_factura_textil(
  _usuario_id UUID,
  _receptor JSONB,
  _lineas JSONB,
  _marca_id UUID DEFAULT NULL,
  _fecha DATE DEFAULT CURRENT_DATE,
  _vencimiento DATE DEFAULT NULL,
  _cliente_id UUID DEFAULT NULL,
  _presupuesto_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL,
  _rectifica_a_id UUID DEFAULT NULL,
  _motivo_rectificacion TEXT DEFAULT NULL,
  _simplificada BOOLEAN DEFAULT false,
  _sustituye_a_id UUID DEFAULT NULL,
  _textil_pedido_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_serie TEXT;
  v_ejercicio INT := EXTRACT(YEAR FROM _fecha)::INT;
  v_numero INT;
  v_serie_id UUID;
  v_numero_texto TEXT;
  v_calc JSONB;
  v_emisor JSONB;
  v_factura_id UUID;
  v_receptor JSONB := COALESCE(_receptor, '{}'::JSONB);
  v_pedido UUID := _textil_pedido_id;
  v_tipo public.factura_tipo;
  v_ticket RECORD;
  v_previa TEXT;
  r RECORD;
BEGIN
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario que emite: una factura no se emite sin autor';
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

  v_empresa := public.empresa_por_defecto();

  IF NOT public.es_miembro_empresa(_usuario_id, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa';
  END IF;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  v_calc := public.factura_calcular(_lineas);

  IF v_tipo = 'simplificada' THEN
    v_receptor := public.ticket_receptor(
      v_empresa, v_receptor, _cliente_id, (v_calc ->> 'total')::NUMERIC);
  END IF;

  -- ---- Canje de un ticket por factura completa ----
  IF _sustituye_a_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.textil_facturas WHERE id = _sustituye_a_id FOR UPDATE;
    IF NOT FOUND OR v_ticket.empresa_id IS DISTINCT FROM v_empresa THEN
      RAISE EXCEPTION 'El ticket que se quiere canjear no existe';
    END IF;
    IF v_ticket.tipo <> 'simplificada' THEN
      RAISE EXCEPTION 'Solo se canjea un ticket, y % no lo es', v_ticket.numero;
    END IF;
    IF EXISTS (SELECT 1 FROM public.textil_facturas WHERE sustituye_a_id = _sustituye_a_id) THEN
      RAISE EXCEPTION 'El ticket % ya se canjeó por factura', v_ticket.numero;
    END IF;
    IF EXISTS (SELECT 1 FROM public.textil_facturas WHERE rectifica_a_id = _sustituye_a_id) THEN
      RAISE EXCEPTION 'El ticket % tiene una rectificativa y ya no se canjea', v_ticket.numero;
    END IF;
    IF (v_calc ->> 'total')::NUMERIC <> v_ticket.total THEN
      RAISE EXCEPTION 'La factura tiene que sumar lo mismo que el ticket % (% €), no % €',
        v_ticket.numero, v_ticket.total, (v_calc ->> 'total')::NUMERIC;
    END IF;
    IF COALESCE(TRIM(v_receptor ->> 'nombre'), '') = ''
       OR COALESCE(TRIM(v_receptor ->> 'nif'), '') = '' THEN
      RAISE EXCEPTION 'Para canjear un ticket por factura hacen falta el nombre y el NIF del cliente';
    END IF;
    v_pedido := COALESCE(v_pedido, v_ticket.textil_pedido_id);
  END IF;

  -- ---- Un pedido, un documento ----
  IF v_pedido IS NOT NULL AND v_tipo IN ('ordinaria', 'simplificada') AND _sustituye_a_id IS NULL THEN
    PERFORM 1 FROM public.textil_pedidos WHERE id = v_pedido FOR UPDATE;

    SELECT f.numero INTO v_previa
      FROM public.textil_facturas f
     WHERE f.textil_pedido_id = v_pedido
       AND f.tipo IN ('ordinaria', 'simplificada')
       AND COALESCE(f.estado, '') NOT IN ('borrador', 'anulada')
       AND NOT EXISTS (SELECT 1 FROM public.textil_facturas x WHERE x.rectifica_a_id = f.id)
     LIMIT 1;

    IF v_previa IS NOT NULL THEN
      RAISE EXCEPTION 'El pedido ya tiene el documento %. Para cambiarlo, rectifícalo primero.',
        v_previa;
    END IF;
  END IF;

  v_serie := public.empresa_serie(v_empresa, v_tipo);

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
  UPDATE public.series_facturacion SET ultimo_numero = v_numero WHERE id = v_serie_id;

  v_numero_texto := public.factura_referencia(v_serie, v_ejercicio, v_numero);

  -- ---- Emisor: sociedad + marca comercial ----
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
           'nombre_comercial', m.nombre,
           'logo_url', m.logo_url
         )
    INTO v_emisor
    FROM public.empresas e
    LEFT JOIN public.textil_marcas m ON m.id = _marca_id
   WHERE e.id = v_empresa;

  INSERT INTO public.textil_facturas (
    empresa_id, numero, serie, ejercicio, numero_serie,
    cliente_id, cliente_nombre, cliente_email, cliente_nif, cliente_direccion,
    marca_id, presupuesto_id, textil_pedido_id, fecha, vencimiento, estado,
    tipo, rectifica_a_id, motivo_rectificacion, sustituye_a_id, emitida_en,
    subtotal, iva, total, notas,
    emisor_snapshot, receptor_snapshot, lineas_snapshot, desglose_iva
  ) VALUES (
    v_empresa, v_numero_texto, v_serie, v_ejercicio, v_numero,
    _cliente_id,
    v_receptor ->> 'nombre', v_receptor ->> 'email',
    v_receptor ->> 'nif', v_receptor ->> 'direccion',
    _marca_id, _presupuesto_id, v_pedido, _fecha, _vencimiento,
    -- El ticket documenta una venta cobrada.
    CASE WHEN v_tipo = 'simplificada' THEN 'pagada' ELSE 'emitida' END,
    v_tipo, _rectifica_a_id, NULLIF(TRIM(_motivo_rectificacion), ''), _sustituye_a_id, now(),
    (v_calc ->> 'base_imponible')::NUMERIC,
    (v_calc ->> 'iva_total')::NUMERIC,
    (v_calc ->> 'total')::NUMERIC,
    _notas,
    v_emisor, v_receptor, v_calc -> 'lineas', v_calc -> 'desglose_iva'
  )
  RETURNING id INTO v_factura_id;

  FOR r IN SELECT * FROM jsonb_array_elements(v_calc -> 'lineas') AS l(linea) LOOP
    INSERT INTO public.textil_factura_items (
      factura_id, descripcion, cantidad, precio_unitario, iva_pct, subtotal
    ) VALUES (
      v_factura_id,
      r.linea ->> 'descripcion',
      (r.linea ->> 'cantidad')::NUMERIC,
      (r.linea ->> 'precio_unitario')::NUMERIC,
      (r.linea ->> 'iva_rate')::NUMERIC,
      (r.linea ->> 'subtotal')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_factura_id,
    'numero', v_numero_texto,
    'referencia', v_numero_texto,
    'serie', v_serie,
    'numero_serie', v_numero,
    'ejercicio', v_ejercicio,
    'tipo', v_tipo,
    'base_imponible', (v_calc ->> 'base_imponible')::NUMERIC,
    'iva_total', (v_calc ->> 'iva_total')::NUMERIC,
    'total', (v_calc ->> 'total')::NUMERIC
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emitir_factura_textil(
  UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura_textil(
  UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT, BOOLEAN, UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Inmutabilidad: el canje también es contenido fiscal
-- ---------------------------------------------------------------------------
-- Idénticas a las vigentes salvo sustituye_a_id en la comparación.
CREATE OR REPLACE FUNCTION public.factura_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ref TEXT;
BEGIN
  v_ref := public.factura_referencia(OLD.serie, OLD.ejercicio, OLD.numero);

  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'borrador' THEN RETURN OLD; END IF;
    RAISE EXCEPTION
      'La factura % está emitida y no se borra. Emite una rectificativa o una anulación.', v_ref;
  END IF;

  IF OLD.estado = 'borrador' THEN RETURN NEW; END IF;

  IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
    RAISE EXCEPTION
      'La factura % no se anula cambiándole el estado. La anulación es una factura rectificativa nueva.', v_ref;
  END IF;

  IF (NEW.serie, NEW.numero, NEW.ejercicio, NEW.fecha, NEW.tipo,
      NEW.base_imponible, NEW.iva_total, NEW.total,
      NEW.emisor_snapshot, NEW.receptor_snapshot, NEW.lineas_snapshot, NEW.desglose_iva,
      NEW.cliente_nombre, NEW.cliente_nif, NEW.cliente_direccion,
      NEW.emisor_nombre, NEW.emisor_cif, NEW.emisor_direccion,
      NEW.rectifica_a_id, NEW.motivo_rectificacion, NEW.sustituye_a_id,
      NEW.emitida_en, NEW.tienda_id, NEW.empresa_id)
     IS DISTINCT FROM
     (OLD.serie, OLD.numero, OLD.ejercicio, OLD.fecha, OLD.tipo,
      OLD.base_imponible, OLD.iva_total, OLD.total,
      OLD.emisor_snapshot, OLD.receptor_snapshot, OLD.lineas_snapshot, OLD.desglose_iva,
      OLD.cliente_nombre, OLD.cliente_nif, OLD.cliente_direccion,
      OLD.emisor_nombre, OLD.emisor_cif, OLD.emisor_direccion,
      OLD.rectifica_a_id, OLD.motivo_rectificacion, OLD.sustituye_a_id,
      OLD.emitida_en, OLD.tienda_id, OLD.empresa_id)
  THEN
    RAISE EXCEPTION
      'La factura % está emitida: su contenido fiscal no se modifica. Solo se pueden cambiar el estado de cobro y el PDF.', v_ref;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.textil_factura_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(OLD.estado, '') = 'borrador' THEN RETURN NEW; END IF;

  IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
    RAISE EXCEPTION
      'La factura % no se anula cambiándole el estado. La anulación es una rectificativa nueva.',
      OLD.numero;
  END IF;

  IF (NEW.numero, NEW.serie, NEW.ejercicio, NEW.numero_serie, NEW.fecha, NEW.tipo,
      NEW.subtotal, NEW.iva, NEW.total,
      NEW.emisor_snapshot, NEW.receptor_snapshot, NEW.lineas_snapshot, NEW.desglose_iva,
      NEW.cliente_nombre, NEW.cliente_nif, NEW.cliente_direccion,
      NEW.rectifica_a_id, NEW.motivo_rectificacion, NEW.sustituye_a_id,
      NEW.emitida_en, NEW.empresa_id)
     IS DISTINCT FROM
     (OLD.numero, OLD.serie, OLD.ejercicio, OLD.numero_serie, OLD.fecha, OLD.tipo,
      OLD.subtotal, OLD.iva, OLD.total,
      OLD.emisor_snapshot, OLD.receptor_snapshot, OLD.lineas_snapshot, OLD.desglose_iva,
      OLD.cliente_nombre, OLD.cliente_nif, OLD.cliente_direccion,
      OLD.rectifica_a_id, OLD.motivo_rectificacion, OLD.sustituye_a_id,
      OLD.emitida_en, OLD.empresa_id)
  THEN
    RAISE EXCEPTION
      'La factura % está emitida: su contenido fiscal no se modifica. Emite una rectificativa.',
      OLD.numero;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Por dónde va cada serie, tickets incluidos
-- ---------------------------------------------------------------------------
-- Idéntica a la de 20260905100000 con una fila más.
CREATE OR REPLACE FUNCTION public.serie_estado(
  _empresa_id UUID,
  _ejercicio INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TABLE (
  tipo public.factura_tipo,
  serie TEXT,
  ejercicio INTEGER,
  numero_inicial INTEGER,
  ultimo_numero INTEGER,
  proximo_numero INTEGER,
  emitidas BIGINT,
  se_puede_fijar BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tipos AS (
    SELECT t.tipo, public.empresa_serie(_empresa_id, t.tipo) AS serie
      FROM (VALUES ('ordinaria'::public.factura_tipo),
                   ('rectificativa'::public.factura_tipo),
                   ('simplificada'::public.factura_tipo))
        AS t(tipo)
  ),
  emitidas AS (
    SELECT f.empresa_id, f.serie, f.ejercicio FROM public.facturas f
    UNION ALL
    SELECT tf.empresa_id, tf.serie, tf.ejercicio
      FROM public.textil_facturas tf WHERE tf.numero_serie IS NOT NULL
  )
  SELECT
    t.tipo,
    t.serie,
    _ejercicio,
    COALESCE(s.numero_inicial, 1),
    COALESCE(s.ultimo_numero, COALESCE(s.numero_inicial, 1) - 1),
    GREATEST(COALESCE(s.ultimo_numero, 0) + 1, COALESCE(s.numero_inicial, 1)),
    COALESCE(n.emitidas, 0),
    COALESCE(n.emitidas, 0) = 0
  FROM tipos t
  LEFT JOIN public.series_facturacion s
    ON s.empresa_id = _empresa_id AND s.serie = t.serie AND s.ejercicio = _ejercicio
  LEFT JOIN LATERAL (
    SELECT count(*) AS emitidas FROM emitidas e
     WHERE e.empresa_id = _empresa_id AND e.serie = t.serie AND e.ejercicio = _ejercicio
  ) n ON TRUE
  ORDER BY t.tipo;
$$;

-- Que la API vea las funciones nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
