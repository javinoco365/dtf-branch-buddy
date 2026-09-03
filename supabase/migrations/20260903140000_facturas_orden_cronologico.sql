-- ============================================================================
-- La numeración también tiene que ir en orden de fecha
-- ============================================================================
--
-- EL PROBLEMA
--   Al abrir la factura manual a fechas —necesario: una factura no siempre se
--   emite el mismo día que se hace el trabajo— aparece un hueco por el que se
--   cuela una numeración incoherente.
--
--   El número lo asigna la base de forma correlativa, pero la FECHA la elige
--   quien emite. Nada impedía que la 2026/0005 llevara fecha anterior a la
--   2026/0004. Una serie correlativa cuyas fechas van hacia atrás no es una
--   serie correlativa: el número y la fecha tienen que contar la misma
--   historia, y bajo Verifactu esa incoherencia es visible desde fuera.
--
-- QUÉ HACE
--   emitir_factura() y emitir_factura_textil() rechazan una fecha anterior a la
--   de la última factura emitida en la misma serie y ejercicio. Mismo día sí:
--   varias facturas por día es lo normal. Hacia atrás no.
--
--   La comprobación va DENTRO de la función, después del bloqueo de la fila de
--   la serie, porque es el único sitio donde no puede colarse una emisión
--   simultánea entre la comprobación y la escritura.
--
-- POR QUÉ UNA FUNCIÓN Y NO UN TRIGGER
--   Las dos tablas de factura comparten serie. Un trigger por tabla solo vería
--   la mitad de la historia, igual que le pasaba a facturas_huecos_en_serie().
--
-- REVERSIBLE
--   Sí. Es una función nueva y dos CREATE OR REPLACE que la llaman.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.factura_comprobar_fecha(
  _empresa_id UUID, _serie TEXT, _ejercicio INT, _fecha DATE
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ultima DATE;
BEGIN
  SELECT max(f.fecha) INTO v_ultima FROM (
    SELECT fecha, empresa_id, serie, ejercicio FROM public.facturas
    UNION ALL
    SELECT fecha, empresa_id, serie, ejercicio FROM public.textil_facturas
  ) f
  WHERE f.empresa_id = _empresa_id AND f.serie = _serie AND f.ejercicio = _ejercicio;

  IF v_ultima IS NOT NULL AND _fecha < v_ultima THEN
    RAISE EXCEPTION
      'No se puede emitir con fecha % : la última factura de la serie es del %. '
      'La numeración es correlativa y las fechas tienen que acompañarla.',
      to_char(_fecha, 'DD/MM/YYYY'), to_char(v_ultima, 'DD/MM/YYYY');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) IS
  'Impide emitir con fecha anterior a la última de la serie. Mira las dos '
  'tablas de factura, que comparten numeración.';

REVOKE EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) TO service_role;

-- emitir_factura(): idéntica salvo la comprobación de fecha.
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
-- emitir_factura_textil(): idéntica salvo la comprobación de fecha.
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