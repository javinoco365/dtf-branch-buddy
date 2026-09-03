-- ============================================================================
-- FASE 3 · Una sola empresa y una sola serie de facturación
-- ============================================================================
--
-- QUÉ ARREGLA
--
-- 1. HABÍA DOS TABLAS DE EMPRESA Y NO HABLABAN ENTRE ELLAS.
--    La pantalla «Datos de la empresa» escribe en empresa_global. El emisor de
--    la factura sale de empresas. Es decir: lo que se escribía en Configuración
--    NO llegaba a las facturas, y una emisión real habría salido con lo que
--    hubiera en empresas. Se descubre mirando una factura ya emitida, y
--    entonces ya no se puede corregir.
--
-- 2. HABÍA TRES SERIES DONDE TIENE QUE HABER UNA.
--      - DTF:            tiendas.serie_factura, por defecto 'A' → una por tienda.
--      - Textil:         'FAC', escrita a fuego.
--      - Rectificativas: compartían serie con las ordinarias.
--
--    RONOCA DESARROLLOS S.L. es una sola sociedad con un solo CIF: la
--    numeración es de la sociedad, no de cada tienda ni de cada módulo.
--
-- 3. LAS RECTIFICATIVAS NO TENÍAN SERIE PROPIA.
--    El RD 1619/2012 art. 6.1.a) obliga a serie específica para las
--    rectificativas. No es una preferencia.
--
-- CÓMO QUEDA LA NUMERACIÓN
--    Ordinarias:     2026/0001, 2026/0002, ...   (prefijo vacío)
--    Rectificativas: R2026/0001, R2026/0002, ... (prefijo 'R')
--    Reinicio anual. Los dos prefijos se configuran en empresas.
--
-- POR QUÉ ES SEGURO HACERLO AHORA
--    Javier confirma que no hay ninguna factura emitida, ni de DTF ni de
--    textil. Las series nuevas ('' y 'R') son claves distintas de las viejas
--    ('A', 'FAC'), así que aunque quedara algún contador antiguo NO se pisa ni
--    se decrementa nada: arrancan de cero por construcción.
--
-- QUÉ NO HACE
--    No borra empresa_global ni las columnas de serie de tiendas. Quedan
--    marcadas como obsoletas y dejan de usarse. Retirarlas es borrar datos
--    reales y va aparte, con tu autorización.
--
-- REVERSIBLE
--    Sí. Añade columnas y reemplaza funciones. No borra nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La empresa, con lo que le faltaba
-- ---------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS textil_marca_predeterminada_id UUID
    REFERENCES public.textil_marcas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serie_factura TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS serie_rectificativa TEXT NOT NULL DEFAULT 'R';

COMMENT ON COLUMN public.empresas.serie_factura IS
  'Prefijo de la serie ordinaria. Vacío da 2026/0001. Toda la facturación de '
  'la sociedad comparte esta serie: DTF, textil y manuales.';
COMMENT ON COLUMN public.empresas.serie_rectificativa IS
  'Prefijo de la serie de rectificativas. Tiene que ser distinto del ordinario: '
  'el RD 1619/2012 art. 6.1.a) exige serie específica para las rectificativas.';

-- Que nadie las deje iguales desde Configuración y funda las dos series.
ALTER TABLE public.empresas DROP CONSTRAINT IF EXISTS empresas_series_distintas;
ALTER TABLE public.empresas ADD CONSTRAINT empresas_series_distintas
  CHECK (serie_factura IS DISTINCT FROM serie_rectificativa);

-- ---------------------------------------------------------------------------
-- 2. Fundir empresa_global en empresas
-- ---------------------------------------------------------------------------
-- Conserva lo que ya hubiera en empresas, cae a empresa_global, y solo entonces
-- pone los datos de RONOCA. Así es idempotente: volver a ejecutarla no pisa lo
-- que edites luego en Configuración.
DO $fusion$
DECLARE
  v_empresa UUID;
  g RECORD;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;

  IF v_empresa IS NULL THEN
    INSERT INTO public.empresas (razon_social) VALUES ('RONOCA DESARROLLOS S.L.')
    RETURNING id INTO v_empresa;
    RAISE NOTICE 'No había empresa activa: creada.';
  END IF;

  SELECT * INTO g FROM public.empresa_global WHERE id = true;

  UPDATE public.empresas e SET
    razon_social = COALESCE(
      NULLIF(NULLIF(TRIM(e.razon_social), ''), 'Empresa sin nombre'),
      NULLIF(TRIM(g.razon_social), ''),
      'RONOCA DESARROLLOS S.L.'),
    cif            = COALESCE(NULLIF(TRIM(e.cif), ''),            NULLIF(TRIM(g.cif), ''),            'B88931118'),
    direccion      = COALESCE(NULLIF(TRIM(e.direccion), ''),      NULLIF(TRIM(g.direccion), ''),      'Avenida de Huelva 7, Local 4'),
    codigo_postal  = COALESCE(NULLIF(TRIM(e.codigo_postal), ''),  NULLIF(TRIM(g.codigo_postal), ''),  '21450'),
    ciudad         = COALESCE(NULLIF(TRIM(e.ciudad), ''),         NULLIF(TRIM(g.ciudad), ''),         'Cartaya'),
    provincia      = COALESCE(NULLIF(TRIM(e.provincia), ''),      NULLIF(TRIM(g.provincia), ''),      'Huelva'),
    pais           = COALESCE(NULLIF(TRIM(e.pais), ''),           NULLIF(TRIM(g.pais), ''),           'España'),
    email_fiscal   = COALESCE(NULLIF(TRIM(e.email_fiscal), ''),   NULLIF(TRIM(g.email_fiscal), '')),
    telefono       = COALESCE(NULLIF(TRIM(e.telefono), ''),       NULLIF(TRIM(g.telefono), '')),
    coste_consumibles_metro  = CASE WHEN e.coste_consumibles_metro  = 0 THEN COALESCE(g.coste_consumibles_metro, 0)  ELSE e.coste_consumibles_metro  END,
    coste_packaging_metro    = CASE WHEN e.coste_packaging_metro    = 0 THEN COALESCE(g.coste_packaging_metro, 0)    ELSE e.coste_packaging_metro    END,
    coste_electricidad_metro = CASE WHEN e.coste_electricidad_metro = 0 THEN COALESCE(g.coste_electricidad_metro, 0) ELSE e.coste_electricidad_metro END,
    textil_marca_predeterminada_id =
      COALESCE(e.textil_marca_predeterminada_id, g.textil_marca_predeterminada_id)
  WHERE e.id = v_empresa;

  RAISE NOTICE 'Empresa % consolidada.', v_empresa;
END
$fusion$;

COMMENT ON TABLE public.empresa_global IS
  'OBSOLETA. Sus datos viven ahora en public.empresas, que es de donde sale el '
  'emisor de las facturas. No se escribe desde la aplicación. Retirarla es un '
  'borrado de datos reales y va en una migración aparte.';

COMMENT ON COLUMN public.tiendas.serie_factura IS
  'OBSOLETA. La serie es de la sociedad: empresas.serie_factura.';
COMMENT ON COLUMN public.tiendas.siguiente_numero_factura IS
  'OBSOLETA. El contador vive en series_facturacion y lo asigna la base bajo bloqueo.';

-- ---------------------------------------------------------------------------
-- 3. La referencia que se imprime
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.factura_referencia(
  _serie TEXT, _ejercicio INT, _numero INT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(_serie, '') || _ejercicio::TEXT || '/' || lpad(_numero::TEXT, 4, '0');
$$;

COMMENT ON FUNCTION public.factura_referencia(TEXT, INT, INT) IS
  'La referencia visible de una factura: 2026/0001 las ordinarias, R2026/0001 '
  'las rectificativas. Un solo sitio, para que el PDF, la pantalla y los '
  'mensajes de error no puedan discrepar.';

-- La serie que toca según el tipo de documento.
CREATE OR REPLACE FUNCTION public.empresa_serie(
  _empresa_id UUID, _tipo public.factura_tipo
) RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_serie TEXT;
BEGIN
  SELECT CASE WHEN _tipo = 'rectificativa' THEN e.serie_rectificativa ELSE e.serie_factura END
    INTO v_serie
    FROM public.empresas e WHERE e.id = _empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La empresa % no existe', _empresa_id;
  END IF;
  RETURN COALESCE(v_serie, '');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Emisión DTF: la serie sale de la sociedad, no de la tienda
-- ---------------------------------------------------------------------------
-- Idéntica a 20260902130000 salvo el bloque de la serie. La tienda sigue
-- aportando el nombre comercial; la identidad fiscal y la numeración, no.
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
  _motivo_rectificacion TEXT DEFAULT NULL
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
  v_tipo public.factura_tipo := CASE WHEN _rectifica_a_id IS NULL
                                     THEN 'ordinaria' ELSE 'rectificativa' END;
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

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  SELECT t.empresa_id INTO v_empresa FROM public.tiendas t WHERE t.id = _tienda_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'La tienda % no existe o no tiene empresa', _tienda_id;
  END IF;

  -- Aquí está el cambio: la serie es de la sociedad y depende del tipo.
  v_serie := public.empresa_serie(v_empresa, v_tipo);

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

  v_calc := public.factura_calcular(_lineas);

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
    tipo, rectifica_a_id, motivo_rectificacion,
    base_imponible, iva_total, total,
    estado, notas, emitida_en,
    emisor_snapshot, receptor_snapshot, lineas_snapshot, desglose_iva,
    cliente_nombre, cliente_nif, cliente_direccion,
    emisor_nombre, emisor_cif, emisor_direccion
  ) VALUES (
    v_empresa, _tienda_id, _cliente_id, _pedido_id,
    v_serie, v_numero, v_ejercicio, _fecha, _fecha_vencimiento,
    v_tipo, _rectifica_a_id, NULLIF(TRIM(_motivo_rectificacion), ''),
    (v_calc ->> 'base_imponible')::NUMERIC,
    (v_calc ->> 'iva_total')::NUMERIC,
    (v_calc ->> 'total')::NUMERIC,
    'emitida', _notas, now(),
    v_emisor, _receptor, v_calc -> 'lineas', v_calc -> 'desglose_iva',
    _receptor ->> 'nombre', _receptor ->> 'nif', _receptor ->> 'direccion',
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

-- ---------------------------------------------------------------------------
-- 5. Emisión textil: la misma serie que todo lo demás
-- ---------------------------------------------------------------------------
-- Idéntica a 20260902130100 salvo que la serie 'FAC' escrita a fuego pasa a ser
-- la de la sociedad, y el número de texto pasa a factura_referencia().
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
  _motivo_rectificacion TEXT DEFAULT NULL
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
  v_tipo public.factura_tipo := CASE WHEN _rectifica_a_id IS NULL
                                     THEN 'ordinaria' ELSE 'rectificativa' END;
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

  v_empresa := public.empresa_por_defecto();

  IF NOT public.es_miembro_empresa(_usuario_id, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa';
  END IF;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- Aquí está el cambio: la misma serie que las facturas de DTF.
  v_serie := public.empresa_serie(v_empresa, v_tipo);

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

  v_calc := public.factura_calcular(_lineas);

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
    marca_id, presupuesto_id, fecha, vencimiento, estado,
    tipo, rectifica_a_id, motivo_rectificacion, emitida_en,
    subtotal, iva, total, notas,
    emisor_snapshot, receptor_snapshot, lineas_snapshot, desglose_iva
  ) VALUES (
    v_empresa, v_numero_texto, v_serie, v_ejercicio, v_numero,
    _cliente_id,
    _receptor ->> 'nombre', _receptor ->> 'email',
    _receptor ->> 'nif', _receptor ->> 'direccion',
    _marca_id, _presupuesto_id, _fecha, _vencimiento, 'emitida',
    v_tipo, _rectifica_a_id, NULLIF(TRIM(_motivo_rectificacion), ''), now(),
    (v_calc ->> 'base_imponible')::NUMERIC,
    (v_calc ->> 'iva_total')::NUMERIC,
    (v_calc ->> 'total')::NUMERIC,
    _notas,
    v_emisor, _receptor, v_calc -> 'lineas', v_calc -> 'desglose_iva'
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

-- ---------------------------------------------------------------------------
-- 6. Permisos de las funciones nuevas
-- ---------------------------------------------------------------------------
-- Las dos funciones de emisión conservan sus GRANT: CREATE OR REPLACE no los
-- toca. Estas son nuevas y hay que concederlos.
REVOKE EXECUTE ON FUNCTION public.factura_referencia(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.factura_referencia(TEXT, INT, INT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.empresa_serie(UUID, public.factura_tipo) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_serie(UUID, public.factura_tipo) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Los mensajes de error, con la referencia de verdad
-- ---------------------------------------------------------------------------
-- Idéntica salvo cómo compone v_ref.
CREATE OR REPLACE FUNCTION public.factura_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ref TEXT;
BEGIN
  -- Con la serie ordinaria vacía, componer 'serie-numero' a mano daba
  -- mensajes como «La factura -1 está emitida». La referencia la construye
  -- factura_referencia() y solo ella.
  v_ref := public.factura_referencia(OLD.serie, OLD.ejercicio, OLD.numero);

  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'borrador' THEN RETURN OLD; END IF;
    RAISE EXCEPTION
      'La factura % está emitida y no se borra. Emite una rectificativa o una anulación.', v_ref;
  END IF;

  IF OLD.estado = 'borrador' THEN RETURN NEW; END IF;

  -- Anular mutando la fila no vale: la anulación es un registro nuevo.
  IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
    RAISE EXCEPTION
      'La factura % no se anula cambiándole el estado. La anulación es una factura rectificativa nueva.', v_ref;
  END IF;

  IF (NEW.serie, NEW.numero, NEW.ejercicio, NEW.fecha, NEW.tipo,
      NEW.base_imponible, NEW.iva_total, NEW.total,
      NEW.emisor_snapshot, NEW.receptor_snapshot, NEW.lineas_snapshot, NEW.desglose_iva,
      NEW.cliente_nombre, NEW.cliente_nif, NEW.cliente_direccion,
      NEW.emisor_nombre, NEW.emisor_cif, NEW.emisor_direccion,
      NEW.rectifica_a_id, NEW.motivo_rectificacion, NEW.emitida_en, NEW.tienda_id, NEW.empresa_id)
     IS DISTINCT FROM
     (OLD.serie, OLD.numero, OLD.ejercicio, OLD.fecha, OLD.tipo,
      OLD.base_imponible, OLD.iva_total, OLD.total,
      OLD.emisor_snapshot, OLD.receptor_snapshot, OLD.lineas_snapshot, OLD.desglose_iva,
      OLD.cliente_nombre, OLD.cliente_nif, OLD.cliente_direccion,
      OLD.emisor_nombre, OLD.emisor_cif, OLD.emisor_direccion,
      OLD.rectifica_a_id, OLD.motivo_rectificacion, OLD.emitida_en, OLD.tienda_id, OLD.empresa_id)
  THEN
    RAISE EXCEPTION
      'La factura % está emitida: su contenido fiscal no se modifica. Solo se pueden cambiar el estado de cobro y el PDF.', v_ref;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Anulación: la referencia también dentro del documento
-- ---------------------------------------------------------------------------
-- Componía 'serie-numero' a mano en tres sitios. Uno de ellos son las NOTAS de
-- la rectificativa, o sea contenido fiscal de un documento emitido: habría
-- quedado «Anulación de la factura -1» impreso y sin poder corregirlo.
CREATE OR REPLACE FUNCTION public.anular_factura(
  _usuario_id UUID,
  _factura_id UUID,
  _motivo TEXT DEFAULT 'R1'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_original RECORD;
  v_lineas JSONB;
BEGIN
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
$$;

-- ---------------------------------------------------------------------------
-- 9. La comprobación de huecos, ahora que la serie abarca dos tablas
-- ---------------------------------------------------------------------------
-- Con la serie unificada, un mismo contador reparte números entre facturas
-- (DTF y manuales) y textil_facturas (tienda física). La versión anterior solo
-- miraba facturas, así que CADA factura textil aparecía como un hueco: la
-- comprobación que existe para detectar numeración rota habría estado en rojo
-- permanentemente, y una alarma que siempre suena no avisa de nada.
CREATE OR REPLACE FUNCTION public.facturas_huecos_en_serie()
RETURNS TABLE (empresa_id UUID, serie TEXT, ejercicio INTEGER, numero_ausente INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emitidas AS (
    SELECT f.empresa_id, f.serie, f.ejercicio, f.numero
      FROM public.facturas f
    UNION ALL
    SELECT tf.empresa_id, tf.serie, tf.ejercicio, tf.numero_serie
      FROM public.textil_facturas tf
     WHERE tf.numero_serie IS NOT NULL
  )
  SELECT s.empresa_id, s.serie, s.ejercicio, g.n
  FROM public.series_facturacion s
  CROSS JOIN LATERAL generate_series(1, s.ultimo_numero) AS g(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM emitidas e
     WHERE e.empresa_id = s.empresa_id
       AND e.serie = s.serie
       AND e.ejercicio = s.ejercicio
       AND e.numero = g.n
  );
$$;

COMMENT ON FUNCTION public.facturas_huecos_en_serie() IS
  'Números asignados por el contador que no corresponden a ninguna factura '
  'emitida, mirando las dos tablas que comparten serie. Sin filas, la '
  'numeración está completa.';

REVOKE EXECUTE ON FUNCTION public.facturas_huecos_en_serie() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturas_huecos_en_serie() TO authenticated;
