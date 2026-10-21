-- ============================================================================
-- Niveles de usuario (4 de 4): las funciones SECURITY DEFINER que escriben
-- comprueban el nivel de quien las llama
-- ============================================================================
--
-- POR QUÉ
--   Una función SECURITY DEFINER se salta la RLS: las políticas de
--   20261031200200 no la frenan. La guardia de 20261031200100 sí (mira el
--   autor que la función fija en app.usuario_id), pero eso es la red de
--   seguridad. Aquí cada función lo comprueba ella misma, en su primera línea,
--   con un error claro y antes de tocar nada (ni bloquear la serie de
--   facturación).
--
-- QUÉ HACE
--   Usa rol_exigir_quien(_usuario_id, _accion), de 20261031200100: comprueba
--   el nivel de TODOS los que se identifican en la llamada: el _usuario_id que
--   recibe la función, el usuario del JWT (auth.uid()) y el autor de
--   auditoria_autor() (la cabecera x-usuario-id de adminComoUsuario). Pasar el
--   _usuario_id de un admin desde una sesión de visor no cuela. Si no hay
--   ninguno (webhook, sincronización automática), deja pasar.
--
--   Añade «PERFORM public.rol_exigir_quien(...)» al principio de estas
--      funciones. El resto del cuerpo es EXACTAMENTE el que tenían (copiado de
--      pg_get_functiondef tras aplicar todas las migraciones anteriores):
--
--   función                              exige     qué hace
--   emitir_factura                       escribir  emite una factura o ticket de tienda
--   emitir_factura_textil                escribir  emite una factura o ticket del textil
--   anular_factura                       escribir  anula con un registro nuevo (no borra)
--   factura_cambiar_estado_cobro         escribir  cambia el estado de cobro
--   serie_fijar_inicio                   escribir  fija el número por el que sigue una serie
--   pedido_fijar_realizado               escribir  fija cuándo se realizó un pedido
--   textil_compra_guardar_y_registrar    escribir  guarda y registra una compra textil
--   textil_stock_fusionar                borrar    fusiona dos variantes: la de origen desaparece
--   banco_conciliar                      escribir  concilia un movimiento con una factura
--   banco_desconciliar                   escribir  deshace una conciliación
--   banco_enlazar_como                   escribir  enlaza movimientos y documentos
--   banco_desenlazar_como                escribir  deshace un enlace
--   banco_confirmar                      escribir  confirma un enlace a revisar
--   banco_marcar_traspaso                escribir  marca un traspaso entre cuentas
--   banco_desmarcar_traspaso             escribir  desmarca un traspaso
--   textil_compra_registrar              escribir  registra una compra textil
--   textil_pedido_entregar               escribir  entrega un pedido textil
--   siguiente_numero                     escribir  da el siguiente número de presupuesto o pedido
--   plantillas_correo_sembrar            escribir  crea las plantillas de correo de una tienda
--   factura_borrar_ultima                borrar    borra la última factura o ticket de la serie
--   textil_stock_retirar                 borrar    borra o retira una variante de stock
--   smtp_guardar                         admin     guarda el servidor de correo
--   smtp_borrar_tienda                   admin     quita el correo propio de una tienda
--   tienda_credenciales_guardar          admin     guarda las credenciales de WooCommerce
--
--   «escribir» = admin o editor; «borrar» y «admin» = solo admin.
--
-- OJO AL MANTENERLAS
--   Si una migración posterior reescribe una de estas funciones con
--   CREATE OR REPLACE, tiene que conservar la línea de rol_exigir_quien().
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031200300_roles_funciones.sql,
-- que repone los cuerpos anteriores tal cual.
-- ============================================================================

-- emitir_factura: emite una factura o ticket de tienda. Exige escribir.
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

-- emitir_factura_textil: emite una factura o ticket del textil. Exige escribir.
CREATE OR REPLACE FUNCTION public.emitir_factura_textil(_usuario_id uuid, _receptor jsonb, _lineas jsonb, _marca_id uuid DEFAULT NULL::uuid, _fecha date DEFAULT CURRENT_DATE, _vencimiento date DEFAULT NULL::date, _cliente_id uuid DEFAULT NULL::uuid, _presupuesto_id uuid DEFAULT NULL::uuid, _notas text DEFAULT NULL::text, _rectifica_a_id uuid DEFAULT NULL::uuid, _motivo_rectificacion text DEFAULT NULL::text, _simplificada boolean DEFAULT false, _sustituye_a_id uuid DEFAULT NULL::uuid, _textil_pedido_id uuid DEFAULT NULL::uuid)
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
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
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
$function$;

-- anular_factura: anula con un registro nuevo (no borra). Exige escribir.
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

-- factura_cambiar_estado_cobro: cambia el estado de cobro. Exige escribir.
CREATE OR REPLACE FUNCTION public.factura_cambiar_estado_cobro(_usuario_id uuid, _factura_id uuid, _estado factura_estado)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tienda UUID;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _estado NOT IN ('emitida', 'pagada', 'vencida') THEN
    RAISE EXCEPTION
      'El estado de cobro solo puede ser emitida, pagada o vencida. Para anular, emite una rectificativa.';
  END IF;

  SELECT f.tienda_id INTO v_tienda FROM public.facturas f WHERE f.id = _factura_id;
  IF v_tienda IS NULL THEN
    RAISE EXCEPTION 'La factura % no existe', _factura_id;
  END IF;

  IF NOT public.is_tienda_member(_usuario_id, v_tienda) THEN
    RAISE EXCEPTION 'Sin acceso a esta factura';
  END IF;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  UPDATE public.facturas SET estado = _estado WHERE id = _factura_id;
END;
$function$;

-- serie_fijar_inicio: fija el número por el que sigue una serie. Exige escribir.
CREATE OR REPLACE FUNCTION public.serie_fijar_inicio(_usuario_id uuid, _empresa_id uuid, _ejercicio integer, _tipo factura_tipo, _siguiente integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_serie TEXT;
  v_serie_id UUID;
  v_emitidas BIGINT;
  v_anio INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario: el contador de facturas no se mueve sin autor';
  END IF;

  -- SECURITY DEFINER se salta la RLS, así que la pertenencia se comprueba aquí.
  IF NOT public.es_miembro_empresa(_usuario_id, _empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa';
  END IF;

  IF _siguiente IS NULL OR _siguiente < 1 THEN
    RAISE EXCEPTION 'El número de la próxima factura tiene que ser 1 o mayor, no %', _siguiente;
  END IF;

  -- Un ejercicio futuro se puede preparar; uno anterior al actual, no: si ya
  -- pasó, o tiene facturas (y entonces está cerrado igualmente) o no las tuvo
  -- nunca y no hay nada que numerar.
  IF _ejercicio IS NULL OR _ejercicio < v_anio OR _ejercicio > v_anio + 1 THEN
    RAISE EXCEPTION 'Ejercicio fuera de rango: % (solo % o %)', _ejercicio, v_anio, v_anio + 1;
  END IF;

  v_serie := public.empresa_serie(_empresa_id, _tipo);

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- El mismo bloqueo que toma emitir_factura(), por la misma razón.
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (_empresa_id, NULL, v_serie, _ejercicio, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;

  SELECT s.id INTO v_serie_id
    FROM public.series_facturacion s
   WHERE s.empresa_id = _empresa_id AND s.serie = v_serie AND s.ejercicio = _ejercicio
     FOR UPDATE;

  -- Dentro del bloqueo: si se comprobara antes, una emisión concurrente podría
  -- colarse entre la comprobación y la escritura y quedarse con un número que
  -- luego se reasignaría.
  SELECT count(*) INTO v_emitidas FROM (
    SELECT 1 FROM public.facturas f
     WHERE f.empresa_id = _empresa_id AND f.serie = v_serie AND f.ejercicio = _ejercicio
    UNION ALL
    SELECT 1 FROM public.textil_facturas tf
     WHERE tf.empresa_id = _empresa_id AND tf.serie = v_serie AND tf.ejercicio = _ejercicio
       AND tf.numero_serie IS NOT NULL
  ) x;

  IF v_emitidas > 0 THEN
    RAISE EXCEPTION
      'La serie % del ejercicio % ya tiene % factura(s) emitida(s): su numeración no se mueve. '
      'Subir el contador dejaría un hueco y bajarlo repetiría un número.',
      v_serie, _ejercicio, v_emitidas;
  END IF;

  -- numero_inicial es lo que impide que el detector de huecos cuente como
  -- ausentes los números anteriores, que nunca fueron de esta serie.
  UPDATE public.series_facturacion
     SET ultimo_numero = _siguiente - 1,
         numero_inicial = _siguiente
   WHERE id = v_serie_id;

  RETURN jsonb_build_object(
    'serie', v_serie,
    'ejercicio', _ejercicio,
    'tipo', _tipo,
    'proximo_numero', _siguiente
  );
END;
$function$;

-- pedido_fijar_realizado: fija cuándo se realizó un pedido. Exige escribir.
CREATE OR REPLACE FUNCTION public.pedido_fijar_realizado(_tabla text, _id uuid, _realizado timestamp with time zone, _usuario_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estado TEXT;
  v_desde TIMESTAMPTZ;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _tabla NOT IN ('pedidos', 'textil_pedidos') THEN
    RAISE EXCEPTION 'Tabla no válida: %', _tabla USING ERRCODE = '22023';
  END IF;
  IF _realizado IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de realizado' USING ERRCODE = '22023';
  END IF;
  IF _realizado > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'La fecha de realizado no puede ser futura' USING ERRCODE = '22023';
  END IF;

  IF _tabla = 'pedidos' THEN
    SELECT estado::TEXT, fecha_pedido INTO v_estado, v_desde
      FROM public.pedidos WHERE id = _id FOR UPDATE;
  ELSE
    SELECT estado, fecha::TIMESTAMPTZ INTO v_estado, v_desde
      FROM public.textil_pedidos WHERE id = _id FOR UPDATE;
  END IF;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_estado NOT IN ('enviado', 'entregado', 'cancelado') THEN
    RAISE EXCEPTION 'Solo se corrige la fecha de un pedido enviado o entregado'
      USING ERRCODE = '22023';
  END IF;
  -- Un día de margen: la hora de los pedidos web se guarda sin zona.
  IF _realizado < v_desde - interval '1 day' THEN
    RAISE EXCEPTION 'La fecha de realizado no puede ser anterior al pedido' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.usuario_id', coalesce(_usuario_id::TEXT, ''), true);
  PERFORM set_config('app.realizado_manual', 'on', true);
  IF _tabla = 'pedidos' THEN
    UPDATE public.pedidos SET realizado_en = _realizado, realizado_manual = true WHERE id = _id;
  ELSE
    UPDATE public.textil_pedidos SET realizado_en = _realizado, realizado_manual = true WHERE id = _id;
  END IF;
  PERFORM set_config('app.realizado_manual', '', true);
  RETURN _realizado;
END;
$function$;

-- textil_compra_guardar_y_registrar: guarda y registra una compra textil. Exige escribir.
CREATE OR REPLACE FUNCTION public.textil_compra_guardar_y_registrar(_compra jsonb, _usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID := NULLIF(btrim(_compra ->> 'id'), '')::UUID;
  v_existente RECORD;
  v_empresa UUID;
  v_categoria TEXT := COALESCE(NULLIF(btrim(_compra ->> 'categoria'), ''), 'textil');
  v_textil BOOLEAN;
  v_hoy DATE := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_fecha DATE;
  v_numero TEXT := NULLIF(btrim(_compra ->> 'numero'), '');
  v_nombre TEXT := NULLIF(btrim(_compra ->> 'proveedor'), '');
  v_nif TEXT := NULLIF(btrim(_compra ->> 'nif_proveedor'), '');
  v_base NUMERIC := COALESCE(NULLIF(_compra ->> 'base', '')::NUMERIC, 0);
  v_lectura JSONB := NULLIF(_compra -> 'lectura_ia', 'null'::JSONB);
  v_lineas JSONB := COALESCE(NULLIF(_compra -> 'lineas', 'null'::JSONB), '[]'::JSONB);
  v_prov_id UUID := NULLIF(btrim(_compra ->> 'proveedor_id'), '')::UUID;
  v_prov RECORD;
  v_prov_nombre TEXT;
  v_prov_nuevo BOOLEAN := false;
  r RECORD;
  v_j JSONB;
  v_nv JSONB;
  v_pj JSONB;
  v_stock UUID;
  v_var RECORD;
  v_metodo TEXT;
  v_producto UUID;
  v_p_nombre TEXT;
  v_p_categoria TEXT;
  v_p_marca TEXT;
  v_p_referencia TEXT;
  v_otro RECORD;
  v_color TEXT;
  v_talla TEXT;
  v_ean TEXT;
  v_esperadas NUMERIC;
  v_suma NUMERIC;
  v_suma_coste NUMERIC;
  v_movidas INT := 0;
  v_creadas INT := 0;
  v_aprendidas INT := 0;
  v_restriccion TEXT;
  -- Proformas (20261029100100)
  v_tipo TEXT := COALESCE(NULLIF(btrim(_compra ->> 'tipo_documento'), ''), 'factura');
  v_proforma_id UUID;
  v_pro RECORD;
  v_pro_numero TEXT;
  v_pro_proveedor TEXT;
  v_clave_factura TEXT;
  v_liquido NUMERIC;
  v_stock_res JSONB;
  v_pago JSONB;
  v_casado JSONB;
  v_num TEXT;
  -- Regularización (4.8-R)
  v_rg RECORD;
  v_saldo0 NUMERIC;
  v_saldo NUMERIC;
  v_cm NUMERIC;
  v_entran NUMERIC;
  v_salen NUMERIC;
  v_m NUMERIC;
  v_d NUMERIC;
  v_teorico NUMERIC;
  v_u NUMERIC;
  v_importe NUMERIC;
  v_valor NUMERIC;
  v_variantes JSONB := '[]'::JSONB;
  v_valor_proforma NUMERIC := 0;
  v_valor_entradas NUMERIC := 0;
  v_valor_devoluciones NUMERIC := 0;
  v_importe_ajustes NUMERIC := 0;
  v_total_entran NUMERIC := 0;
  v_total_salen NUMERIC := 0;
  v_mov_reg INT := 0;
  -- Pago
  v_enlaces INT := 0;
  v_grupos INT := 0;
  v_grupos_revisar INT := 0;
  v_grupo UUID;
  v_grupos_tocados UUID[];
  v_dif NUMERIC;
  v_liquido_pro NUMERIC;
  v_hereda BOOLEAN := false;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  -- 0. Autor y acceso -----------------------------------------------------
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sin usuario: la compra necesita un autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- Tipo de documento y proforma con la que se casa (E-PRO-9, E-PRO-8, E-PRO-3).
  IF v_tipo NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'Tipo de documento desconocido: %. Tiene que ser factura o proforma.', v_tipo
      USING ERRCODE = '22023';
  END IF;
  v_proforma_id := NULLIF(btrim(_compra ->> 'proforma_id'), '')::UUID;
  IF v_proforma_id IS NOT NULL AND v_tipo = 'proforma' THEN
    RAISE EXCEPTION 'Una proforma no se casa con otra proforma: lo que se casa con la proforma es su factura.'
      USING ERRCODE = '22023';
  END IF;
  IF v_proforma_id IS NOT NULL AND v_proforma_id = v_id THEN
    RAISE EXCEPTION 'El documento elegido no es una proforma.' USING ERRCODE = '22023';
  END IF;

  -- Bloqueo en orden de id (la factura, si ya existe, y su proforma): dos
  -- registros que se cruzan no se bloquean entre sí. Antes, las filas de los
  -- grupos del banco de la proforma: banco_confirmar y banco_desenlazar_como
  -- bloquean primero las filas del grupo y después la compra; con el mismo
  -- orden aquí, casar a la vez que se confirma o se deshace no se interbloquea.
  IF v_proforma_id IS NOT NULL THEN
    PERFORM 1 FROM public.banco_conciliaciones
     WHERE grupo IN (SELECT c.grupo FROM public.banco_conciliaciones c
                      WHERE c.compra_id = v_proforma_id)
     ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.textil_compras
     WHERE id IN (v_id, v_proforma_id) ORDER BY id FOR UPDATE;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existente FROM public.textil_compras WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La compra no existe.' USING ERRCODE = 'P0002';
    END IF;
    v_empresa := v_existente.empresa_id;
  ELSE
    v_empresa := COALESCE(NULLIF(btrim(_compra ->> 'empresa_id'), '')::UUID,
                          public.empresa_por_defecto());
  END IF;

  IF v_empresa IS NULL OR NOT public.es_miembro_empresa(_usuario_id, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  -- La proforma: existe, es de la empresa, es una proforma registrada, sin
  -- factura y de la misma familia (textil o no textil). E-PRO-1 a E-PRO-7.
  IF v_proforma_id IS NOT NULL THEN
    SELECT * INTO v_pro FROM public.textil_compras WHERE id = v_proforma_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La proforma elegida no existe.' USING ERRCODE = 'P0002';
    END IF;
    v_pro_numero := COALESCE(v_pro.numero, '(sin número)');
    IF v_pro.empresa_id <> v_empresa THEN
      RAISE EXCEPTION 'La proforma es de otra empresa.' USING ERRCODE = '42501';
    END IF;
    IF v_pro.tipo_documento <> 'proforma' THEN
      RAISE EXCEPTION 'El documento elegido no es una proforma.' USING ERRCODE = '22023';
    END IF;
    IF v_pro.estado <> 'registrada' OR v_pro.borrada_en IS NOT NULL THEN
      RAISE EXCEPTION 'La proforma % todavía no está registrada o está borrada: regístrala antes de casarla.',
        v_pro_numero USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT f.numero INTO v_num FROM public.textil_compras f
     WHERE f.proforma_id = v_pro.id ORDER BY f.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'La proforma % ya tiene factura (n.º %).', v_pro_numero,
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
    END IF;
    IF (v_pro.categoria = 'textil') <> (v_categoria = 'textil') THEN
      RAISE EXCEPTION 'Una proforma textil solo se casa con una factura textil, y una de otra categoría con una factura que no sea textil.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 1. Cabecera -----------------------------------------------------------
  IF v_id IS NOT NULL THEN
    IF v_existente.estado = 'registrada' THEN
      RAISE EXCEPTION 'La compra % ya estaba registrada.', COALESCE(v_existente.numero, '(sin número)')
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  v_fecha := NULLIF(btrim(_compra ->> 'fecha'), '')::DATE;
  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha de la factura: sin ella no se sabe en qué periodo cuenta.'
      USING ERRCODE = '22023';
  END IF;
  IF v_fecha > v_hoy THEN
    RAISE EXCEPTION 'La fecha de la factura (%) es posterior a hoy: revisa que esté bien leída.',
      to_char(v_fecha, 'DD/MM/YYYY') USING ERRCODE = '22023';
  END IF;

  v_textil := v_categoria = 'textil';

  IF v_id IS NULL THEN
    INSERT INTO public.textil_compras
      (empresa_id, proveedor, nif_proveedor, numero, fecha, concepto, notas, base, iva, irpf,
       total, categoria, gasto_id, tipo_iva, tipo_irpf, liquido_origen, nota_descuadre,
       forma_pago, lectura_ia, estado, tipo_documento)
    VALUES
      (v_empresa, v_nombre, v_nif, v_numero, v_fecha,
       NULLIF(btrim(_compra ->> 'concepto'), ''), NULLIF(btrim(_compra ->> 'notas'), ''),
       v_base,
       COALESCE(NULLIF(_compra ->> 'iva', '')::NUMERIC, 0),
       COALESCE(NULLIF(_compra ->> 'irpf', '')::NUMERIC, 0),
       COALESCE(NULLIF(_compra ->> 'total', '')::NUMERIC, 0),
       v_categoria,
       NULLIF(btrim(_compra ->> 'gasto_id'), '')::UUID,
       COALESCE(NULLIF(_compra ->> 'tipo_iva', '')::NUMERIC, 0.21),
       COALESCE(NULLIF(_compra ->> 'tipo_irpf', '')::NUMERIC, 0),
       COALESCE(NULLIF(btrim(_compra ->> 'liquido_origen'), ''), 'calculado'),
       NULLIF(btrim(_compra ->> 'nota_descuadre'), ''),
       NULLIF(btrim(_compra ->> 'forma_pago'), ''),
       v_lectura, 'borrador', v_tipo)
    RETURNING id INTO v_id;
  ELSE
    -- Una clave que no viene en el JSON conserva lo que había (lo que guardó
    -- la cola: el concepto y el IRPF leídos, la nota con el fichero…), como
    -- hacía guardarCompra. Si viene, aunque sea nula, manda.
    UPDATE public.textil_compras
       SET proveedor = v_nombre,
           nif_proveedor = v_nif,
           numero = v_numero,
           fecha = v_fecha,
           concepto = CASE WHEN _compra ? 'concepto'
                           THEN NULLIF(btrim(_compra ->> 'concepto'), '') ELSE concepto END,
           notas = CASE WHEN _compra ? 'notas'
                        THEN NULLIF(btrim(_compra ->> 'notas'), '') ELSE notas END,
           base = v_base,
           iva = COALESCE(NULLIF(_compra ->> 'iva', '')::NUMERIC, 0),
           irpf = CASE WHEN _compra ? 'irpf'
                       THEN COALESCE(NULLIF(_compra ->> 'irpf', '')::NUMERIC, 0) ELSE irpf END,
           total = COALESCE(NULLIF(_compra ->> 'total', '')::NUMERIC, 0),
           categoria = v_categoria,
           gasto_id = CASE WHEN _compra ? 'gasto_id'
                           THEN NULLIF(btrim(_compra ->> 'gasto_id'), '')::UUID ELSE gasto_id END,
           tipo_iva = COALESCE(NULLIF(_compra ->> 'tipo_iva', '')::NUMERIC, tipo_iva),
           tipo_irpf = COALESCE(NULLIF(_compra ->> 'tipo_irpf', '')::NUMERIC, tipo_irpf),
           liquido_origen = COALESCE(NULLIF(btrim(_compra ->> 'liquido_origen'), ''), liquido_origen),
           nota_descuadre = CASE WHEN _compra ? 'nota_descuadre'
                                 THEN NULLIF(btrim(_compra ->> 'nota_descuadre'), '') ELSE nota_descuadre END,
           forma_pago = CASE WHEN _compra ? 'forma_pago'
                             THEN NULLIF(btrim(_compra ->> 'forma_pago'), '') ELSE forma_pago END,
           lectura_ia = COALESCE(lectura_ia, v_lectura),
           tipo_documento = v_tipo,
           estado = 'borrador'
     WHERE id = v_id;
  END IF;

  -- 2. Proveedor ----------------------------------------------------------
  IF v_prov_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.proveedores WHERE id = v_prov_id;
    IF NOT FOUND OR v_prov.empresa_id <> v_empresa THEN
      RAISE EXCEPTION 'El proveedor elegido no es de esta empresa.' USING ERRCODE = '42501';
    END IF;
    IF v_prov.nif_clave <> '' AND public.nif_clave(v_nif) <> ''
       AND v_prov.nif_clave <> public.nif_clave(v_nif) THEN
      RAISE EXCEPTION 'El NIF de la factura (%) no es el del proveedor elegido (%). Vuelve a elegir el proveedor.',
        v_nif, v_prov.nif USING ERRCODE = '22023';
    END IF;
    -- El elegido no tenía NIF y la factura sí: se completa (como en la rama
    -- de abajo), salvo que ese NIF ya sea de otro proveedor.
    IF v_prov.nif_clave = '' AND public.nif_clave(v_nif) <> ''
       AND NOT EXISTS (SELECT 1 FROM public.proveedores
                        WHERE empresa_id = v_empresa AND nif_clave = public.nif_clave(v_nif)) THEN
      UPDATE public.proveedores SET nif = v_nif WHERE id = v_prov_id;
    END IF;
  ELSIF public.nif_clave(v_nif) <> '' THEN
    SELECT id INTO v_prov_id FROM public.proveedores
     WHERE empresa_id = v_empresa AND nif_clave = public.nif_clave(v_nif);
    -- Si llegó antes sin NIF, se completa ese: así no se parte en dos.
    IF v_prov_id IS NULL AND public.textil_clave(v_nombre) <> '' THEN
      SELECT id INTO v_prov_id FROM public.proveedores
       WHERE empresa_id = v_empresa AND nif_clave = ''
         AND nombre_clave = public.textil_clave(v_nombre)
       FOR UPDATE;
      IF v_prov_id IS NOT NULL THEN
        UPDATE public.proveedores SET nif = v_nif WHERE id = v_prov_id;
      END IF;
    END IF;
    IF v_prov_id IS NULL THEN
      INSERT INTO public.proveedores (empresa_id, nombre, nif, origen)
      VALUES (v_empresa, COALESCE(v_nombre, v_nif), v_nif, 'escaner')
      ON CONFLICT (empresa_id, nif_clave) WHERE nif_clave <> '' DO NOTHING
      RETURNING id INTO v_prov_id;
      IF v_prov_id IS NULL THEN
        SELECT id INTO v_prov_id FROM public.proveedores
         WHERE empresa_id = v_empresa AND nif_clave = public.nif_clave(v_nif);
      ELSE
        v_prov_nuevo := true;
      END IF;
    END IF;
  ELSIF public.textil_clave(v_nombre) <> '' THEN
    -- Sin NIF en la factura: primero el proveedor CON NIF de ese nombre, si
    -- es uno solo (la IA no leyó el NIF de un proveedor que ya está en el
    -- catálogo: no se parte en dos); si no, el de ese nombre sin NIF.
    SELECT min(id::TEXT)::UUID INTO v_prov_id FROM public.proveedores
     WHERE empresa_id = v_empresa AND nif_clave <> ''
       AND nombre_clave = public.textil_clave(v_nombre)
    HAVING count(*) = 1;
    IF v_prov_id IS NULL THEN
      SELECT id INTO v_prov_id FROM public.proveedores
       WHERE empresa_id = v_empresa AND nif_clave = ''
         AND nombre_clave = public.textil_clave(v_nombre);
    END IF;
    IF v_prov_id IS NULL THEN
      INSERT INTO public.proveedores (empresa_id, nombre, origen)
      VALUES (v_empresa, v_nombre, 'escaner')
      ON CONFLICT (empresa_id, nombre_clave) WHERE nif_clave = '' DO NOTHING
      RETURNING id INTO v_prov_id;
      IF v_prov_id IS NULL THEN
        SELECT id INTO v_prov_id FROM public.proveedores
         WHERE empresa_id = v_empresa AND nif_clave = ''
           AND nombre_clave = public.textil_clave(v_nombre);
      ELSE
        v_prov_nuevo := true;
      END IF;
    END IF;
  END IF;

  IF v_prov_id IS NULL AND v_textil THEN
    RAISE EXCEPTION 'Falta el proveedor (nombre o NIF): en textil, la memoria del escáner y los pagos se apuntan a él.'
      USING ERRCODE = '22023';
  END IF;
  IF v_prov_id IS NOT NULL THEN
    SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_prov_id;
  END IF;

  -- La proforma tiene que ser del mismo proveedor (E-PRO-6): por el
  -- proveedor del catálogo si las dos lo tienen; si no, por la clave del
  -- nombre o NIF (proveedor_clave) de las dos filas.
  IF v_proforma_id IS NOT NULL THEN
    SELECT proveedor_clave INTO v_clave_factura FROM public.textil_compras WHERE id = v_id;
    IF (v_pro.proveedor_id IS NOT NULL AND v_prov_id IS NOT NULL AND v_pro.proveedor_id <> v_prov_id)
       OR ((v_pro.proveedor_id IS NULL OR v_prov_id IS NULL)
           AND COALESCE(v_pro.proveedor_clave, '') <> '' AND COALESCE(v_clave_factura, '') <> ''
           AND v_pro.proveedor_clave <> v_clave_factura) THEN
      SELECT COALESCE(p.nombre, v_pro.proveedor) INTO v_pro_proveedor
        FROM (SELECT 1) x LEFT JOIN public.proveedores p ON p.id = v_pro.proveedor_id;
      RAISE EXCEPTION 'La proforma % es de otro proveedor (%): solo se casa con una factura del mismo proveedor.',
        v_pro_numero, COALESCE(v_pro_proveedor, '(sin nombre)') USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Una proforma que llega cuando su factura ya está registrada (sin casar):
  -- el casado solo se hace al registrar la factura, así que registrarla
  -- volvería a meter el género y a pedir su pago. Mismo proveedor (el del
  -- catálogo o la clave del nombre o NIF) y mismo número. La pantalla avisa
  -- además de la que tiene el mismo importe (duplicadosDe) y pide confirmarlo.
  IF v_tipo = 'proforma' THEN
    SELECT f.numero INTO v_num
      FROM public.textil_compras f, public.textil_compras c
     WHERE c.id = v_id AND f.id <> v_id
       AND f.empresa_id = v_empresa AND f.tipo_documento = 'factura'
       AND f.estado = 'registrada' AND f.borrada_en IS NULL AND f.proforma_id IS NULL
       AND ((v_prov_id IS NOT NULL AND f.proveedor_id = v_prov_id)
            OR (COALESCE(c.proveedor_clave, '') <> '' AND f.proveedor_clave = c.proveedor_clave))
       AND COALESCE(c.numero_clave, '') <> '' AND f.numero_clave = c.numero_clave
     ORDER BY f.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Esta proforma parece de la factura %, ya registrada: no la registres (la factura ya cuenta y, si es textil, su género ya entró).',
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- 3. Líneas -------------------------------------------------------------
  -- La variante (stock_id) se escribe en el paso 4.6, después de validarla.
  DELETE FROM public.textil_compra_lineas WHERE compra_id = v_id;

  INSERT INTO public.textil_compra_lineas
    (compra_id, orden, descripcion, cantidad, precio_unitario, importe, unidad, tipo,
     referencia, marca, modelo, color, talla, ean, unidades_por_pack,
     unidades_stock, coste_total_entrada, coste_unitario_entrada, casado_metodo, linea_papel)
  SELECT v_id, (e.n - 1)::INT,
         COALESCE(e.l ->> 'descripcion', ''),
         NULLIF(e.l ->> 'cantidad', '')::NUMERIC,
         COALESCE(NULLIF(e.l ->> 'precio_unitario', '')::NUMERIC, 0),
         COALESCE(NULLIF(e.l ->> 'importe', '')::NUMERIC, 0),
         NULLIF(btrim(e.l ->> 'unidad'), ''),
         COALESCE(NULLIF(btrim(e.l ->> 'tipo'), ''), 'articulo'),
         NULLIF(btrim(e.l ->> 'referencia'), ''),
         NULLIF(btrim(e.l ->> 'marca'), ''),
         NULLIF(btrim(e.l ->> 'modelo'), ''),
         NULLIF(btrim(e.l ->> 'color'), ''),
         NULLIF(btrim(e.l ->> 'talla'), ''),
         NULLIF(btrim(e.l ->> 'ean'), ''),
         COALESCE(NULLIF(e.l ->> 'unidades_por_pack', '')::NUMERIC, 1),
         CASE WHEN v_textil AND COALESCE(NULLIF(btrim(e.l ->> 'tipo'), ''), 'articulo') = 'articulo'
              THEN NULLIF(e.l ->> 'unidades_stock', '')::NUMERIC END,
         CASE WHEN v_textil AND COALESCE(NULLIF(btrim(e.l ->> 'tipo'), ''), 'articulo') = 'articulo'
              THEN NULLIF(e.l ->> 'coste_total_entrada', '')::NUMERIC END,
         CASE WHEN v_textil AND COALESCE(NULLIF(btrim(e.l ->> 'tipo'), ''), 'articulo') = 'articulo'
              THEN NULLIF(e.l ->> 'coste_unitario_entrada', '')::NUMERIC END,
         CASE WHEN v_textil AND COALESCE(NULLIF(btrim(e.l ->> 'tipo'), ''), 'articulo') = 'articulo'
              THEN NULLIF(btrim(e.l ->> 'casado_metodo'), '') END,
         NULLIF(btrim(e.l ->> 'linea_papel'), '')::INT
    FROM jsonb_array_elements(v_lineas) WITH ORDINALITY AS e(l, n);

  -- 4. Solo textil: validar, casar, mover stock y aprender ------------------
  IF v_textil THEN
    -- 4.1 Al menos un artículo.
    IF NOT EXISTS (SELECT 1 FROM public.textil_compra_lineas
                    WHERE compra_id = v_id AND tipo = 'articulo') THEN
      RAISE EXCEPTION 'Una factura textil necesita al menos una línea de artículo.'
        USING ERRCODE = '22023';
    END IF;

    -- 4.2 Cada artículo: importe, unidades y coste de entrada.
    FOR r IN SELECT * FROM public.textil_compra_lineas
              WHERE compra_id = v_id AND tipo = 'articulo' ORDER BY orden
    LOOP
      IF r.importe < 0 THEN
        RAISE EXCEPTION 'Línea %: un artículo no puede tener importe negativo; si es un abono o un descuento, márcala como descuento.',
          r.orden + 1 USING ERRCODE = '22023';
      END IF;
      v_esperadas := round(r.cantidad * r.unidades_por_pack, 6);
      IF r.unidades_stock IS NULL OR r.unidades_stock <> v_esperadas
         OR r.unidades_stock <> trunc(r.unidades_stock) OR r.unidades_stock <= 0 THEN
        RAISE EXCEPTION 'Línea %: las unidades de una prenda tienen que ser enteras y mayores que cero (% × % = %).',
          r.orden + 1,
          replace(trim_scale(r.cantidad)::TEXT, '.', ','),
          replace(trim_scale(r.unidades_por_pack)::TEXT, '.', ','),
          replace(trim_scale(v_esperadas)::TEXT, '.', ',')
          USING ERRCODE = '22023';
      END IF;
      IF r.coste_total_entrada IS NULL OR r.coste_total_entrada < 0
         OR r.coste_unitario_entrada IS NULL OR r.coste_unitario_entrada < 0 THEN
        RAISE EXCEPTION 'Línea %: falta el coste de entrada. Vuelve a abrir la revisión y regístrala otra vez.',
          r.orden + 1 USING ERRCODE = '22023';
      END IF;
      IF abs(r.unidades_stock * r.coste_unitario_entrada - r.coste_total_entrada) >= 0.005 THEN
        RAISE EXCEPTION 'Línea %: % unidades a % no dan % de coste de entrada.',
          r.orden + 1,
          replace(trim_scale(r.unidades_stock)::TEXT, '.', ','),
          replace(trim_scale(r.coste_unitario_entrada)::TEXT, '.', ','),
          replace(to_char(r.coste_total_entrada, 'FM999999999990.00'), '.', ',')
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    -- 4.3 Portes y descuentos con su signo.
    SELECT orden INTO r FROM public.textil_compra_lineas
     WHERE compra_id = v_id
       AND ((tipo = 'porte' AND importe < 0) OR (tipo = 'descuento' AND importe > 0))
     ORDER BY orden LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Línea %: un porte no puede ser negativo ni un descuento positivo.',
        r.orden + 1 USING ERRCODE = '22023';
    END IF;

    -- 4.4 Las líneas suman la base (redondeo por línea, como el dominio).
    SELECT COALESCE(sum(round(importe, 2)), 0) INTO v_suma
      FROM public.textil_compra_lineas WHERE compra_id = v_id;
    IF abs(v_suma - round(v_base, 2)) > 0.02 THEN
      RAISE EXCEPTION 'Las líneas suman % y la base dice %: falta o sobra una línea (porte, descuento…) o hay un importe mal leído.',
        replace(to_char(v_suma, 'FM999999999990.00'), '.', ','),
        replace(to_char(round(v_base, 2), 'FM999999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;

    -- 4.5 I1: Σ coste de entrada = base, al céntimo.
    SELECT COALESCE(sum(coste_total_entrada), 0) INTO v_suma_coste
      FROM public.textil_compra_lineas WHERE compra_id = v_id AND tipo = 'articulo';
    IF round(v_suma_coste, 2) <> round(v_base, 2) THEN
      RAISE EXCEPTION 'El coste de entrada suma % y la base es %: tienen que cuadrar al céntimo.',
        replace(to_char(round(v_suma_coste, 2), 'FM999999999990.00'), '.', ','),
        replace(to_char(round(v_base, 2), 'FM999999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;

    -- 4.6 La variante de cada artículo (y 4.7, el EAN aprendido).
    FOR r IN SELECT * FROM public.textil_compra_lineas
              WHERE compra_id = v_id AND tipo = 'articulo' ORDER BY orden
    LOOP
      v_j := v_lineas -> r.orden;
      v_stock := NULLIF(btrim(v_j ->> 'stock_id'), '')::UUID;
      v_nv := NULLIF(v_j -> 'nueva_variante', 'null'::JSONB);
      v_metodo := r.casado_metodo;

      IF v_stock IS NOT NULL THEN
        SELECT empresa_id, activa, repetida INTO v_var FROM public.textil_stock WHERE id = v_stock;
        IF NOT FOUND OR v_var.empresa_id <> v_empresa THEN
          RAISE EXCEPTION 'Línea %: la variante no es de esta empresa.', r.orden + 1
            USING ERRCODE = '42501';
        END IF;
        IF NOT v_var.activa THEN
          RAISE EXCEPTION 'Línea %: la variante está desactivada. Elige otra o reactívala en Stock.', r.orden + 1
            USING ERRCODE = 'restrict_violation';
        END IF;
        IF v_var.repetida THEN
          RAISE EXCEPTION 'Línea %: la variante está repetida. Usa la buena o fusiónalas en Stock.', r.orden + 1
            USING ERRCODE = 'restrict_violation';
        END IF;

      ELSIF v_nv IS NOT NULL THEN
        v_producto := NULLIF(btrim(v_nv ->> 'producto_id'), '')::UUID;
        v_pj := NULLIF(v_nv -> 'producto', 'null'::JSONB);
        IF v_producto IS NULL AND v_pj IS NULL THEN
          RAISE EXCEPTION 'Línea %: falta la variante del catálogo. Elige una o crea una nueva.', r.orden + 1
            USING ERRCODE = 'restrict_violation';
        END IF;

        IF v_producto IS NOT NULL THEN
          SELECT nombre, categoria INTO v_p_nombre, v_p_categoria
            FROM public.textil_productos WHERE id = v_producto AND empresa_id = v_empresa;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Línea %: el producto no es de esta empresa.', r.orden + 1
              USING ERRCODE = '42501';
          END IF;
        ELSE
          v_p_marca := NULLIF(btrim(v_pj ->> 'marca'), '');
          v_p_referencia := NULLIF(btrim(v_pj ->> 'referencia'), '');
          v_p_nombre := btrim(COALESCE(v_pj ->> 'nombre', ''));
          v_p_categoria := NULLIF(btrim(v_pj ->> 'categoria'), '');
          v_producto := NULL;
          IF public.textil_clave(v_p_referencia) <> '' THEN
            SELECT id, nombre, nombre_clave INTO v_otro
              FROM public.textil_productos
             WHERE empresa_id = v_empresa
               AND marca_clave = public.textil_clave(v_p_marca)
               AND referencia_clave = public.textil_clave(v_p_referencia);
            v_producto := v_otro.id;
            -- Esa marca y referencia ya son de un producto con OTRO nombre: no
            -- se reutiliza en silencio (las prendas entrarían en otro producto
            -- y el nombre escrito se perdería).
            IF v_producto IS NOT NULL AND v_otro.nombre_clave <> public.textil_clave(v_p_nombre) THEN
              RAISE EXCEPTION 'Línea %: la referencia % ya es del producto %; elígelo o cambia la referencia.',
                r.orden + 1, v_p_referencia, v_otro.nombre USING ERRCODE = 'unique_violation';
            END IF;
            IF v_producto IS NULL THEN
              INSERT INTO public.textil_productos (empresa_id, marca, referencia, nombre, categoria, origen)
              VALUES (v_empresa, v_p_marca, v_p_referencia, v_p_nombre, v_p_categoria, 'escaner')
              ON CONFLICT (empresa_id, marca_clave, referencia_clave) WHERE referencia_clave <> '' DO NOTHING
              RETURNING id INTO v_producto;
              IF v_producto IS NULL THEN
                SELECT id INTO v_producto
                  FROM public.textil_productos
                 WHERE empresa_id = v_empresa
                   AND marca_clave = public.textil_clave(v_p_marca)
                   AND referencia_clave = public.textil_clave(v_p_referencia);
              END IF;
            END IF;
          ELSE
            SELECT id INTO v_producto
              FROM public.textil_productos
             WHERE empresa_id = v_empresa
               AND marca_clave = public.textil_clave(v_p_marca)
               AND nombre_clave = public.textil_clave(v_p_nombre)
               AND referencia_clave = '';
            IF v_producto IS NULL THEN
              INSERT INTO public.textil_productos (empresa_id, marca, referencia, nombre, categoria, origen)
              VALUES (v_empresa, v_p_marca, NULL, v_p_nombre, v_p_categoria, 'escaner')
              ON CONFLICT (empresa_id, marca_clave, nombre_clave) WHERE referencia_clave = '' DO NOTHING
              RETURNING id INTO v_producto;
              IF v_producto IS NULL THEN
                SELECT id INTO v_producto
                  FROM public.textil_productos
                 WHERE empresa_id = v_empresa
                   AND marca_clave = public.textil_clave(v_p_marca)
                   AND nombre_clave = public.textil_clave(v_p_nombre)
                   AND referencia_clave = '';
              END IF;
            END IF;
          END IF;
        END IF;

        -- La variante toma el nombre y la categoría del producto.
        SELECT nombre, categoria INTO v_p_nombre, v_p_categoria
          FROM public.textil_productos WHERE id = v_producto;

        v_color := NULLIF(btrim(v_nv ->> 'color'), '');
        v_talla := NULLIF(btrim(v_nv ->> 'talla'), '');
        v_ean := NULLIF(btrim(v_nv ->> 'ean'), '');

        SELECT id INTO v_stock FROM public.textil_stock
         WHERE producto_id = v_producto AND activa AND NOT repetida
           AND color_clave = public.textil_clave(v_color)
           AND talla_clave = public.textil_clave_talla(v_talla);

        IF v_ean IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.textil_stock
              WHERE empresa_id = v_empresa AND ean = v_ean
                AND id IS DISTINCT FROM v_stock) THEN
          RAISE EXCEPTION 'Línea %: el EAN % ya lo tiene otra variante.', r.orden + 1, v_ean
            USING ERRCODE = 'unique_violation';
        END IF;

        IF v_stock IS NULL THEN
          INSERT INTO public.textil_stock
            (empresa_id, producto_id, nombre, categoria, color, talla, ean, sku,
             precio_venta, cantidad_minima, cantidad, coste_unitario)
          VALUES
            (v_empresa, v_producto, v_p_nombre, v_p_categoria, v_color, v_talla, v_ean,
             NULLIF(btrim(v_nv ->> 'sku'), ''),
             COALESCE(NULLIF(v_nv ->> 'precio_venta', '')::NUMERIC, 0),
             COALESCE(NULLIF(v_nv ->> 'cantidad_minima', '')::NUMERIC, 0),
             0, 0)
          ON CONFLICT (producto_id, color_clave, talla_clave) WHERE activa AND NOT repetida DO NOTHING
          RETURNING id INTO v_stock;
          IF v_stock IS NULL THEN
            SELECT id INTO v_stock FROM public.textil_stock
             WHERE producto_id = v_producto AND activa AND NOT repetida
               AND color_clave = public.textil_clave(v_color)
               AND talla_clave = public.textil_clave_talla(v_talla);
          ELSE
            v_creadas := v_creadas + 1;
          END IF;
        ELSIF v_ean IS NOT NULL THEN
          UPDATE public.textil_stock SET ean = v_ean WHERE id = v_stock AND ean IS NULL;
        END IF;
        v_metodo := 'nueva';

      ELSE
        RAISE EXCEPTION 'Línea %: falta la variante del catálogo. Elige una o crea una nueva.', r.orden + 1
          USING ERRCODE = 'restrict_violation';
      END IF;

      UPDATE public.textil_compra_lineas
         SET stock_id = v_stock, casado_metodo = v_metodo
       WHERE id = r.id;

      -- 4.7 EAN aprendido: la variante no lo tiene y ninguna otra de la empresa.
      IF r.ean ~ '^([0-9]{8}|[0-9]{12,14})$' THEN
        UPDATE public.textil_stock s SET ean = r.ean
         WHERE s.id = v_stock AND s.ean IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.textil_stock o
                            WHERE o.empresa_id = v_empresa AND o.ean = r.ean);
      END IF;
    END LOOP;

    IF v_proforma_id IS NULL THEN
      -- 4.8 Movimientos: una entrada por artículo, enlazada a su línea (factura
      --     o proforma: la proforma mete el stock igual que una factura).
      FOR r IN SELECT * FROM public.textil_compra_lineas
                WHERE compra_id = v_id AND tipo = 'articulo' ORDER BY orden
      LOOP
        INSERT INTO public.textil_stock_movimientos
          (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id,
           fecha, nota)
        VALUES
          (v_empresa, r.stock_id, 'compra', r.unidades_stock, r.coste_unitario_entrada, v_id, r.id,
           v_fecha,
           'Compra ' || COALESCE(v_numero, '(sin número)')
             || COALESCE(' de ' || COALESCE(v_nombre, v_prov_nombre), '')
             || ' · línea ' || (r.orden + 1));
        v_movidas := v_movidas + 1;
      END LOOP;

    ELSE
      -- 4.8-R Regularización (factura textil casada con su proforma). El género
      --       ya lo metió la proforma: aquí solo entra o sale la diferencia de
      --       unidades por variante y se revaloriza lo que queda de la proforma
      --       al coste de la factura. Todos los movimientos llevan compra_id = la
      --       factura y su fecha. Ningún UPDATE ni DELETE de movimientos.
      SELECT COALESCE(sum(pe.valor), 0) INTO v_valor_proforma
        FROM public.proforma_entradas(v_pro.id) pe;

      FOR v_rg IN
        WITH p AS (
          SELECT pe.stock_id, pe.unidades, pe.coste_unitario, pe.posteriores
            FROM public.proforma_entradas(v_pro.id) pe
        ), f AS (
          SELECT l.stock_id,
                 sum(l.unidades_stock) AS unidades,
                 sum(l.coste_total_entrada) AS valor,
                 (array_agg(l.id ORDER BY l.orden))[1] AS linea
            FROM public.textil_compra_lineas l
           WHERE l.compra_id = v_id AND l.tipo = 'articulo'
           GROUP BY l.stock_id
        )
        SELECT COALESCE(p.stock_id, f.stock_id) AS stock_id,
               COALESCE(p.unidades, 0) AS up,
               p.coste_unitario AS cp,
               COALESCE(f.unidades, 0) AS uf,
               round(f.valor / NULLIF(f.unidades, 0), 8) AS cf,
               f.linea,
               COALESCE(p.posteriores, 0) AS posteriores
          FROM p FULL OUTER JOIN f ON f.stock_id = p.stock_id
         ORDER BY 1   -- orden fijo de bloqueo de las variantes
      LOOP
        -- c0. El saldo ANTES de regularizar. Una variante retirada (activa =
        --     false, con 0 unidades) no admite la salida de c2: quedaría en
        --     negativo y fuera del almacén, sin forma de corregirla.
        SELECT cantidad, activa, nombre, color, talla INTO v_var
          FROM public.textil_stock WHERE id = v_rg.stock_id FOR UPDATE;
        v_saldo0 := v_var.cantidad;
        IF NOT v_var.activa AND v_rg.up > v_rg.uf THEN
          RAISE EXCEPTION 'La variante % está retirada y la factura trae menos unidades que la proforma: reactívala en Stock (o fusiónala con la buena) antes de casar.',
            concat_ws(' · ', v_var.nombre, v_var.color, v_var.talla)
            USING ERRCODE = 'restrict_violation';
        END IF;

        -- c1. La factura trae más: entra la diferencia al coste de la factura.
        v_entran := greatest(v_rg.uf - v_rg.up, 0);
        IF v_entran > 0 THEN
          INSERT INTO public.textil_stock_movimientos
            (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id,
             fecha, nota)
          VALUES
            (v_empresa, v_rg.stock_id, 'compra', v_entran, v_rg.cf, v_id, v_rg.linea, v_fecha,
             'Regularización: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
               || v_pro_numero || ' · entran ' || replace(trim_scale(v_entran)::TEXT, '.', ','))
          RETURNING round(cantidad * coste_unitario, 2) INTO v_valor;
          v_valor_entradas := v_valor_entradas + v_valor;
          v_mov_reg := v_mov_reg + 1;
        END IF;

        -- c2. La factura trae menos: sale la diferencia (al coste medio vigente,
        --     que pone el trigger; el saldo puede quedar negativo).
        v_salen := greatest(v_rg.up - v_rg.uf, 0);
        IF v_salen > 0 THEN
          INSERT INTO public.textil_stock_movimientos
            (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, fecha, nota)
          VALUES
            (v_empresa, v_rg.stock_id, 'devolucion_proveedor', -v_salen, 0, v_id, v_fecha,
             'Regularización: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
               || v_pro_numero || ' · salen ' || replace(trim_scale(v_salen)::TEXT, '.', ','))
          RETURNING round(cantidad * coste_unitario, 2) INTO v_valor;
          v_valor_devoluciones := v_valor_devoluciones + v_valor;
          v_mov_reg := v_mov_reg + 1;
        END IF;

        -- c3. Otro coste: se revaloriza lo que sigue en el almacén de la
        --     proforma. Lo ya vendido no se toca (queda sin aplicar).
        v_m := least(v_rg.up, v_rg.uf);
        v_d := CASE WHEN v_rg.up = 0 OR v_rg.uf = 0 THEN 0 ELSE v_rg.cf - v_rg.cp END;
        v_teorico := round(v_m * v_d, 2);
        v_u := 0;
        v_importe := 0;
        IF v_teorico <> 0 THEN
          -- Saldo y coste medio de después de c1/c2 (para el tope y el trigger).
          SELECT cantidad, coste_unitario INTO v_saldo, v_cm
            FROM public.textil_stock WHERE id = v_rg.stock_id FOR UPDATE;
          -- Unidades de la proforma que siguen en el almacén. No se usa v_saldo:
          -- incluye las que entraron en c1, ya al coste de la factura. Tampoco
          -- cuenta lo que entró de otros documentos después de la proforma
          -- (posteriores): lo que queda es lo más nuevo, y si la proforma ya
          -- se vendió, su diferencia no se carga sobre el género de otra compra.
          v_u := least(v_m, greatest(v_saldo0 - v_rg.posteriores - v_salen, 0));
          v_importe := round(v_u * v_d, 2);
          IF v_saldo > 0 AND v_saldo * v_cm + v_importe < 0 THEN
            v_importe := -floor(v_saldo * v_cm * 100) / 100;
          END IF;
          IF v_saldo > 0 AND v_importe <> 0 THEN
            INSERT INTO public.textil_stock_movimientos
              (empresa_id, stock_id, motivo, cantidad, coste_unitario, importe_ajuste, compra_id,
               fecha, nota)
            VALUES
              (v_empresa, v_rg.stock_id, 'ajuste_coste', 0, 0, v_importe, v_id, v_fecha,
               'Ajuste de coste: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
                 || v_pro_numero || ' · ' || replace(trim_scale(v_u)::TEXT, '.', ',') || ' uds');
            v_importe_ajustes := v_importe_ajustes + v_importe;
            v_mov_reg := v_mov_reg + 1;
          ELSE
            v_importe := 0;
            v_u := 0;
          END IF;
        END IF;

        -- c4. La fila de la variante (FilaRegularizacion).
        v_variantes := v_variantes || jsonb_build_object(
          'stock_id', v_rg.stock_id,
          'unidades_proforma', v_rg.up,
          'unidades_factura', v_rg.uf,
          'coste_unitario_proforma', CASE WHEN v_rg.up = 0 THEN NULL ELSE v_rg.cp END,
          'coste_unitario_factura', CASE WHEN v_rg.uf = 0 THEN NULL ELSE v_rg.cf END,
          'entran', v_entran,
          'salen', v_salen,
          'unidades_ajustadas', v_u,
          'importe_ajuste', v_importe,
          'importe_sin_aplicar', v_teorico - v_importe);
        v_total_entran := v_total_entran + v_entran;
        v_total_salen := v_total_salen + v_salen;
      END LOOP;

      -- d/e. Lo que no se pudo llevar al stock (lo ya vendido, las salidas al
      --      coste medio, redondeos) es el residuo: así P7 cuadra al céntimo.
      v_stock_res := jsonb_build_object(
        'variantes', v_variantes,
        'entran', v_total_entran,
        'salen', v_total_salen,
        'valor_proforma', v_valor_proforma,
        'valor_entradas', v_valor_entradas,
        'valor_devoluciones', v_valor_devoluciones,
        'importe_ajustes', v_importe_ajustes,
        'diferencia_sin_aplicar', round(v_base - (v_valor_proforma + v_valor_entradas
                                                  + v_valor_devoluciones + v_importe_ajustes), 2),
        'movimientos', v_mov_reg);
      v_movidas := v_movidas + v_mov_reg;
    END IF;

    -- 4.9 Memoria: por clave; una clave que fue a variantes distintas es
    --     ambigua: no se aprende y se olvida lo que hubiera.
    FOR r IN
      SELECT public.textil_clave_memoria(l.referencia, l.color, l.talla, l.descripcion) AS clave,
             count(DISTINCT l.stock_id) AS variantes,
             min(l.stock_id::TEXT)::UUID AS stock_id,
             (array_agg(l.unidades_por_pack ORDER BY l.orden DESC))[1] AS pack
        FROM public.textil_compra_lineas l
       WHERE l.compra_id = v_id AND l.tipo = 'articulo'
       GROUP BY 1
    LOOP
      CONTINUE WHEN r.clave = '';
      IF r.variantes = 1 THEN
        INSERT INTO public.textil_referencias_proveedor AS t
          (empresa_id, proveedor_id, clave, stock_id, unidades_por_pack, veces,
           ultima_compra_id, origen)
        VALUES (v_empresa, v_prov_id, r.clave, r.stock_id, r.pack, 1, v_id, 'escaner')
        ON CONFLICT (empresa_id, proveedor_id, clave) DO UPDATE
          SET veces = CASE WHEN t.stock_id = EXCLUDED.stock_id THEN t.veces + 1 ELSE 1 END,
              stock_id = EXCLUDED.stock_id,
              unidades_por_pack = EXCLUDED.unidades_por_pack,
              ultima_compra_id = EXCLUDED.ultima_compra_id,
              origen = 'escaner',
              updated_at = now();
        v_aprendidas := v_aprendidas + 1;
      ELSE
        DELETE FROM public.textil_referencias_proveedor
         WHERE empresa_id = v_empresa AND proveedor_id = v_prov_id AND clave = r.clave;
      END IF;
    END LOOP;
  END IF;

  -- 4b. Pago (solo la factura casada, de cualquier categoría) -------------
  -- Los enlaces del banco de la proforma pasan a la factura: UPDATE en su
  -- sitio (conserva grupo, estado, motivo, conciliado_por y marco_pagada; lo
  -- audita banco_conciliaciones_auditoria con app.usuario_id ya fijado), con
  -- lo que la factura espera ver en el banco (−líquido), y la diferencia de
  -- cada grupo se recalcula: si no cuadra, el grupo queda en «revisar». La
  -- proforma no se toca: conserva su pago como historia y deja de contar
  -- porque está casada. estado_pago y fecha_pago pasan en el paso 5.
  -- La factura hereda «pagada» si el pago está enlazado en el banco (si el
  -- líquido difiere, su grupo queda en «revisar» con la diferencia) o si su
  -- líquido no pasa del que se pagó por la proforma (queda cubierta; lo pagado
  -- de más queda en casado_resumen.pago.diferencia, negativa). Una proforma
  -- pagada a mano, sin enlace, y una factura por MÁS: la factura queda
  -- pendiente (nada diría que falta pagar la diferencia) y casado_resumen.pago
  -- lo anota; Tesorería solo cuenta como deuda líquido − liquido_proforma.
  IF v_proforma_id IS NOT NULL THEN
    SELECT liquido INTO v_liquido FROM public.textil_compras WHERE id = v_id;

    -- Ya bloqueadas en el paso 0, antes de la proforma (el orden del motor).
    -- Otra vez por si entre medias se enlazó un grupo nuevo (ya confirmado).
    PERFORM 1 FROM public.banco_conciliaciones
     WHERE grupo IN (SELECT c.grupo FROM public.banco_conciliaciones c WHERE c.compra_id = v_pro.id)
     ORDER BY id FOR UPDATE;

    SELECT COALESCE(array_agg(DISTINCT c.grupo), '{}') INTO v_grupos_tocados
      FROM public.banco_conciliaciones c WHERE c.compra_id = v_pro.id;

    UPDATE public.banco_conciliaciones SET compra_id = v_id, importe = -v_liquido
     WHERE compra_id = v_pro.id;
    GET DIAGNOSTICS v_enlaces = ROW_COUNT;

    FOREACH v_grupo IN ARRAY v_grupos_tocados LOOP
      -- Σ movimientos distintos − Σ documentos distintos (uno por documento).
      SELECT round(
               COALESCE((SELECT sum(m.importe) FROM public.banco_movimientos m
                          WHERE m.id IN (SELECT c.movimiento_id FROM public.banco_conciliaciones c
                                          WHERE c.grupo = v_grupo)), 0)
             - COALESCE((SELECT sum(x.importe)
                           FROM (SELECT DISTINCT ON (COALESCE(c.factura_id, c.compra_id,
                                                              c.textil_factura_id)) c.importe
                                   FROM public.banco_conciliaciones c
                                  WHERE c.grupo = v_grupo
                                  ORDER BY COALESCE(c.factura_id, c.compra_id, c.textil_factura_id),
                                           c.id) x), 0), 2)
        INTO v_dif;
      UPDATE public.banco_conciliaciones
         SET diferencia = v_dif,
             estado = CASE WHEN v_dif <> 0 THEN 'revisar' ELSE estado END
       WHERE grupo = v_grupo;
      v_grupos := v_grupos + 1;
      IF v_dif <> 0 THEN
        v_grupos_revisar := v_grupos_revisar + 1;
      END IF;
    END LOOP;

    v_liquido_pro := round(COALESCE(v_pro.liquido, v_pro.total, 0)::NUMERIC, 2);
    v_hereda := v_pro.estado_pago = 'pagada'
                AND (v_enlaces > 0 OR round(v_liquido, 2) <= v_liquido_pro);

    v_pago := jsonb_build_object(
      'enlaces_movidos', v_enlaces,
      'grupos', v_grupos,
      'grupos_revisar', v_grupos_revisar,
      'estado_pago', CASE WHEN v_hereda THEN 'pagada' ELSE 'pendiente' END,
      'fecha_pago', CASE WHEN v_hereda THEN v_pro.fecha_pago END,
      'proforma_pagada', v_pro.estado_pago = 'pagada',
      'liquido_proforma', v_liquido_pro,
      'diferencia', round(v_liquido - v_liquido_pro, 2));
    v_casado := jsonb_build_object(
      'proforma_id', v_proforma_id,
      'stock', v_stock_res,
      'pago', v_pago);
  END IF;

  -- 5. Registrar ----------------------------------------------------------
  -- En su propio bloque: solo el único de factura duplicada (y el de la
  -- proforma ya casada) se traducen; un único de EAN, variante o memoria no
  -- puede salir como «ya registrada». La factura casada guarda aquí su
  -- proforma, el pago que hereda de ella y lo que hizo el casado.
  BEGIN
    IF v_proforma_id IS NULL THEN
      UPDATE public.textil_compras
         SET estado = 'registrada', revision = 'revisada', revision_motivo = NULL,
             proveedor_id = v_prov_id
       WHERE id = v_id;
    ELSE
      UPDATE public.textil_compras
         SET estado = 'registrada', revision = 'revisada', revision_motivo = NULL,
             proveedor_id = v_prov_id,
             proforma_id = v_proforma_id,
             estado_pago = CASE WHEN v_hereda THEN 'pagada' ELSE 'pendiente' END,
             fecha_pago = CASE WHEN v_hereda THEN v_pro.fecha_pago END,
             casado_resumen = v_casado
       WHERE id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'textil_compras_factura_unica' THEN
      IF v_tipo = 'proforma' THEN
        RAISE EXCEPTION 'Esta proforma (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.'
          USING ERRCODE = 'unique_violation';
      END IF;
      RAISE EXCEPTION 'Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_restriccion = 'textil_compras_proforma_casada_unica' THEN
      -- Carrera: otra factura la casó a la vez (E-PRO-5).
      SELECT f.numero INTO v_num FROM public.textil_compras f
       WHERE f.proforma_id = v_proforma_id AND f.id <> v_id ORDER BY f.id LIMIT 1;
      RAISE EXCEPTION 'La proforma % ya tiene factura (n.º %).', v_pro_numero,
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
    END IF;
    RAISE;
  END;

  -- 6. Resultado ----------------------------------------------------------
  RETURN jsonb_build_object(
    'id', v_id,
    'movidas', v_movidas,
    'variantes_creadas', v_creadas,
    'aprendidas', v_aprendidas,
    'proveedor_id', v_prov_id,
    'proveedor_nuevo', v_prov_nuevo,
    'tipo_documento', v_tipo,
    'proforma_id', v_proforma_id,
    'casado', v_casado);
END;
$function$;

-- textil_stock_fusionar: fusiona dos variantes: la de origen desaparece. Exige borrar.
CREATE OR REPLACE FUNCTION public.textil_stock_fusionar(_origen uuid, _destino uuid, _usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_origen RECORD;
  v_destino RECORD;
  v_q NUMERIC;
  v_c NUMERIC;
  v_reservas INT := 0;
  v_lineas INT := 0;
  v_n INT;
  r RECORD;
BEGIN
  -- Nivel: borrar (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'borrar');
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sin usuario: la compra necesita un autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  IF _origen = _destino THEN
    RAISE EXCEPTION 'No se fusiona una variante consigo misma.' USING ERRCODE = '22023';
  END IF;

  -- Bloqueo en orden de id: dos fusiones cruzadas no se bloquean entre sí.
  PERFORM 1 FROM public.textil_stock WHERE id IN (_origen, _destino) ORDER BY id FOR UPDATE;
  SELECT * INTO v_origen FROM public.textil_stock WHERE id = _origen;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante no existe.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_destino FROM public.textil_stock WHERE id = _destino;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.es_miembro_empresa(_usuario_id, v_origen.empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF v_origen.empresa_id <> v_destino.empresa_id THEN
    RAISE EXCEPTION 'Las dos variantes tienen que ser de la misma empresa.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_destino.activa OR v_destino.repetida THEN
    RAISE EXCEPTION 'La variante de destino tiene que estar activa y no repetida.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Con la bandera, el coste congelado de las líneas se conserva y la entrada
  -- del destino lleva el coste del origen (aunque sea 0): los dos ajustes
  -- suman 0.
  PERFORM set_config('app.fusion_variantes', '1', true);

  -- 2. Las unidades pasan al coste medio del origen. Con existencias
  --    negativas es al revés: la salida es la del destino, y toda salida sale
  --    al coste medio de su variante (paso 4 de stock_aplicar_movimiento), así
  --    que los dos ajustes van al coste del destino. Si no, no sumarían 0 y
  --    la fusión dejaría una merma o una ganancia que no existe.
  v_q := v_origen.cantidad;
  v_c := CASE WHEN v_q < 0 THEN v_destino.coste_unitario ELSE v_origen.coste_unitario END;
  IF v_q <> 0 THEN
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
    VALUES (v_origen.empresa_id, _origen, 'ajuste_inventario', -v_q, v_c,
            'Fusión: pasa a ' || concat_ws(' · ', v_destino.nombre, v_destino.color, v_destino.talla));
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
    VALUES (v_destino.empresa_id, _destino, 'ajuste_inventario', v_q, v_c,
            'Fusión: viene de ' || concat_ws(' · ', v_origen.nombre, v_origen.color, v_origen.talla));
  END IF;

  -- 3. Reservas: al destino, sumando si ya había una del mismo pedido.
  FOR r IN SELECT * FROM public.textil_stock_reservas WHERE stock_id = _origen LOOP
    INSERT INTO public.textil_stock_reservas AS t (empresa_id, stock_id, textil_pedido_id, cantidad)
    VALUES (r.empresa_id, _destino, r.textil_pedido_id, r.cantidad)
    ON CONFLICT (textil_pedido_id, stock_id) DO UPDATE SET cantidad = t.cantidad + EXCLUDED.cantidad;
    v_reservas := v_reservas + 1;
  END LOOP;
  DELETE FROM public.textil_stock_reservas WHERE stock_id = _origen;

  -- 4. Lo que apuntaba al origen pasa al destino (las líneas de compras
  --    registradas y de facturas no: son historia).
  UPDATE public.textil_pedido_items SET stock_id = _destino WHERE stock_id = _origen;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_lineas := v_lineas + v_n;
  UPDATE public.textil_presupuesto_items SET stock_id = _destino WHERE stock_id = _origen;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_lineas := v_lineas + v_n;
  UPDATE public.textil_compra_lineas l SET stock_id = _destino
    FROM public.textil_compras c
   WHERE c.id = l.compra_id AND c.estado = 'borrador' AND l.stock_id = _origen;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_lineas := v_lineas + v_n;
  UPDATE public.textil_referencias_proveedor SET stock_id = _destino WHERE stock_id = _origen;

  -- 5. El EAN pasa si el destino no tiene.
  IF v_destino.ean IS NULL AND v_origen.ean IS NOT NULL THEN
    UPDATE public.textil_stock SET ean = NULL WHERE id = _origen;
    UPDATE public.textil_stock SET ean = v_origen.ean WHERE id = _destino;
  END IF;

  -- 6. El origen queda retirado y apuntando a su destino.
  UPDATE public.textil_stock
     SET activa = false, repetida = false, fusionada_en = _destino
   WHERE id = _origen;

  PERFORM set_config('app.fusion_variantes', '', true);

  RETURN jsonb_build_object('unidades', v_q, 'reservas', v_reservas, 'lineas', v_lineas);
END;
$function$;

-- banco_conciliar: concilia un movimiento con una factura. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_conciliar(_usuario_id uuid, _movimiento_id uuid, _factura_id uuid, _motivo text DEFAULT 'importe'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo UUID;
  v_id UUID;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  v_grupo := public.banco_enlazar_como(
    _usuario_id, ARRAY[_movimiento_id],
    jsonb_build_array(jsonb_build_object('tipo', 'factura', 'id', _factura_id)),
    'conciliada', _motivo);
  SELECT id INTO v_id FROM public.banco_conciliaciones WHERE grupo = v_grupo;
  RETURN v_id;
END;
$function$;

-- banco_desconciliar: deshace una conciliación. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id uuid, _movimiento_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo UUID;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  SELECT grupo INTO v_grupo FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id LIMIT 1;
  IF v_grupo IS NULL THEN RETURN false; END IF;
  RETURN public.banco_desenlazar_como(_usuario_id, v_grupo) > 0;
END;
$function$;

-- banco_enlazar_como: enlaza movimientos y documentos. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_enlazar_como(_usuario_id uuid, _movimientos uuid[], _documentos jsonb, _estado text, _motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo UUID := gen_random_uuid();
  v_empresa UUID;
  v_signo INT;
  v_suma_mov NUMERIC := 0;
  v_suma_doc NUMERIC := 0;
  v_n_mov INT := 0;
  v_n_doc INT;
  v_esperado NUMERIC;
  v_doc_empresa UUID;
  v_docs JSONB := '[]'::jsonb;
  m RECORD;
  d RECORD;
  v_estado TEXT;
  v_borrada BOOLEAN;
  v_num TEXT;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _usuario_id IS NULL THEN RAISE EXCEPTION 'Sin usuario'; END IF;
  IF _estado NOT IN ('conciliada', 'revisar') THEN
    RAISE EXCEPTION 'Estado de conciliación desconocido: %', _estado;
  END IF;
  v_n_doc := COALESCE(jsonb_array_length(_documentos), 0);
  IF COALESCE(cardinality(_movimientos), 0) = 0 OR v_n_doc = 0 THEN
    RAISE EXCEPTION 'Falta el movimiento o el documento';
  END IF;
  IF cardinality(_movimientos) > 1 AND v_n_doc > 1 THEN
    RAISE EXCEPTION 'Varios movimientos contra varias facturas no se enlazan de una vez: hazlo por partes.';
  END IF;

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- Movimientos, bloqueados en orden fijo para no cruzarse con otra llamada.
  FOR m IN SELECT * FROM public.banco_movimientos
            WHERE id = ANY(_movimientos) ORDER BY id FOR UPDATE LOOP
    v_n_mov := v_n_mov + 1;
    IF v_empresa IS NULL THEN
      v_empresa := m.empresa_id;
      v_signo := sign(m.importe);
    ELSIF m.empresa_id <> v_empresa THEN
      RAISE EXCEPTION 'Los movimientos son de empresas distintas';
    ELSIF sign(m.importe) <> v_signo THEN
      RAISE EXCEPTION 'No se mezclan cargos y abonos en un mismo enlace';
    END IF;
    IF m.traspaso_con IS NOT NULL THEN
      RAISE EXCEPTION 'El movimiento del % es un traspaso entre cuentas propias: no paga nada', m.fecha;
    END IF;
    IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE movimiento_id = m.id) THEN
      RAISE EXCEPTION 'El movimiento del % por % ya está conciliado', m.fecha, m.importe;
    END IF;
    v_suma_mov := v_suma_mov + m.importe;
  END LOOP;
  IF v_n_mov <> (SELECT count(DISTINCT x) FROM unnest(_movimientos) x) THEN
    RAISE EXCEPTION 'El movimiento no existe';
  END IF;
  IF NOT public.es_miembro_empresa(_usuario_id, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a estos movimientos';
  END IF;

  -- Documentos, también bloqueados.
  FOR d IN SELECT DISTINCT e->>'tipo' AS tipo, (e->>'id')::UUID AS id
             FROM jsonb_array_elements(_documentos) e ORDER BY 2 LOOP
    IF d.tipo = 'compra' THEN
      SELECT c.empresa_id, -c.liquido, c.estado, c.borrada_en IS NOT NULL
        INTO v_doc_empresa, v_esperado, v_estado, v_borrada
        FROM public.textil_compras c WHERE c.id = d.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La factura recibida no existe'; END IF;
      IF v_estado <> 'registrada' OR v_borrada THEN
        RAISE EXCEPTION 'Solo se concilian facturas recibidas registradas';
      END IF;
      IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE compra_id = d.id) THEN
        RAISE EXCEPTION 'Esa factura recibida ya está conciliada';
      END IF;
      -- La proforma ya casada: su pago vive en la factura (E-PRO-14).
      SELECT f.numero INTO v_num FROM public.textil_compras f WHERE f.proforma_id = d.id LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Esa proforma ya tiene factura (n.º %): concilia el pago con la factura.',
          COALESCE(v_num, '(sin número)');
      END IF;
    ELSIF d.tipo = 'factura' THEN
      SELECT t.empresa_id, f.total, f.estado::TEXT INTO v_doc_empresa, v_esperado, v_estado
        FROM public.facturas f JOIN public.tiendas t ON t.id = f.tienda_id
       WHERE f.id = d.id FOR UPDATE OF f;
      IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
      IF v_estado = 'borrador' THEN
        RAISE EXCEPTION 'La factura todavía es un borrador: emítela antes de darla por cobrada.';
      END IF;
      IF v_estado = 'anulada' THEN RAISE EXCEPTION 'La factura está anulada'; END IF;
      IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE factura_id = d.id) THEN
        RAISE EXCEPTION 'Esa factura ya está conciliada';
      END IF;
    ELSIF d.tipo = 'textil' THEN
      SELECT f.empresa_id, f.total, f.estado INTO v_doc_empresa, v_esperado, v_estado
        FROM public.textil_facturas f WHERE f.id = d.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La factura de textil no existe'; END IF;
      IF v_estado IN ('borrador', 'anulada') THEN
        RAISE EXCEPTION 'La factura de textil está en %', v_estado;
      END IF;
      IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE textil_factura_id = d.id) THEN
        RAISE EXCEPTION 'Esa factura de textil ya está conciliada';
      END IF;
    ELSE
      RAISE EXCEPTION 'Tipo de documento desconocido: %', d.tipo;
    END IF;

    IF v_doc_empresa IS DISTINCT FROM v_empresa THEN
      RAISE EXCEPTION 'El documento es de otra empresa';
    END IF;
    IF sign(v_esperado) <> v_signo THEN
      RAISE EXCEPTION '%', CASE WHEN v_signo < 0
        THEN 'Un cargo no paga una factura emitida: se concilia con una factura recibida.'
        ELSE 'Un abono no paga una factura recibida: se concilia con una factura emitida.' END;
    END IF;
    v_suma_doc := v_suma_doc + v_esperado;
    v_docs := v_docs || jsonb_build_object('tipo', d.tipo, 'id', d.id, 'importe', v_esperado);
  END LOOP;

  INSERT INTO public.banco_conciliaciones
    (movimiento_id, factura_id, compra_id, textil_factura_id, motivo, diferencia,
     conciliado_por, estado, grupo, importe, marco_pagada)
  SELECT mv, CASE WHEN x->>'tipo' = 'factura' THEN (x->>'id')::UUID END,
         CASE WHEN x->>'tipo' = 'compra' THEN (x->>'id')::UUID END,
         CASE WHEN x->>'tipo' = 'textil' THEN (x->>'id')::UUID END,
         _motivo, round(v_suma_mov - v_suma_doc, 2), _usuario_id, _estado, v_grupo,
         (x->>'importe')::NUMERIC, false
    FROM unnest(_movimientos) mv CROSS JOIN jsonb_array_elements(v_docs) x;

  IF _estado = 'conciliada' THEN
    PERFORM public.banco_aplicar_efectos(_usuario_id, v_grupo);
  END IF;
  RETURN v_grupo;
END;
$function$;

-- banco_desenlazar_como: deshace un enlace. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_desenlazar_como(_usuario_id uuid, _grupo uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa UUID;
  r RECORD;
  v_n INT;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  SELECT m.empresa_id INTO v_empresa
    FROM public.banco_conciliaciones c JOIN public.banco_movimientos m ON m.id = c.movimiento_id
   WHERE c.grupo = _grupo LIMIT 1;
  IF v_empresa IS NULL THEN RETURN 0; END IF;
  IF _usuario_id IS NULL OR NOT public.es_miembro_empresa(_usuario_id, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a este enlace';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  PERFORM 1 FROM public.banco_conciliaciones WHERE grupo = _grupo FOR UPDATE;
  FOR r IN SELECT DISTINCT compra_id, factura_id FROM public.banco_conciliaciones
            WHERE grupo = _grupo AND marco_pagada LOOP
    IF r.compra_id IS NOT NULL THEN
      UPDATE public.textil_compras SET estado_pago = 'pendiente', fecha_pago = NULL
       WHERE id = r.compra_id AND estado_pago = 'pagada';
    ELSIF r.factura_id IS NOT NULL THEN
      IF (SELECT estado FROM public.facturas WHERE id = r.factura_id) = 'pagada' THEN
        PERFORM public.factura_cambiar_estado_cobro(_usuario_id, r.factura_id, 'emitida');
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.banco_conciliaciones WHERE grupo = _grupo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- banco_confirmar: confirma un enlace a revisar. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_confirmar(_grupo uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario UUID := auth.uid();
  v_empresa UUID;
  v_n INT;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  SELECT m.empresa_id INTO v_empresa
    FROM public.banco_conciliaciones c JOIN public.banco_movimientos m ON m.id = c.movimiento_id
   WHERE c.grupo = _grupo LIMIT 1;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Ese enlace ya no existe'; END IF;
  IF v_usuario IS NULL OR NOT public.es_miembro_empresa(v_usuario, v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a este enlace';
  END IF;
  PERFORM set_config('app.usuario_id', v_usuario::TEXT, true);

  PERFORM 1 FROM public.banco_conciliaciones WHERE grupo = _grupo FOR UPDATE;
  UPDATE public.banco_conciliaciones SET estado = 'conciliada', conciliado_por = v_usuario
   WHERE grupo = _grupo AND estado = 'revisar';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN false; END IF;

  PERFORM public.banco_aplicar_efectos(v_usuario, _grupo);
  RETURN true;
END;
$function$;

-- banco_marcar_traspaso: marca un traspaso entre cuentas. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_marcar_traspaso(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario UUID := auth.uid();
  a RECORD;
  b RECORD;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  IF _a = _b THEN RAISE EXCEPTION 'Un traspaso son dos movimientos'; END IF;
  -- En orden fijo, para no bloquearse con otra llamada que los coja al revés.
  PERFORM 1 FROM public.banco_movimientos WHERE id IN (_a, _b) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.banco_movimientos WHERE id = _a;
  SELECT * INTO b FROM public.banco_movimientos WHERE id = _b;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'El movimiento no existe'; END IF;
  IF a.empresa_id <> b.empresa_id THEN RAISE EXCEPTION 'Son de empresas distintas'; END IF;
  IF v_usuario IS NULL OR NOT public.es_miembro_empresa(v_usuario, a.empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a estos movimientos';
  END IF;
  IF a.cuenta_id IS NULL OR b.cuenta_id IS NULL OR a.cuenta_id = b.cuenta_id THEN
    RAISE EXCEPTION 'Un traspaso va de una cuenta propia a otra distinta';
  END IF;
  IF a.importe + b.importe <> 0 THEN
    RAISE EXCEPTION 'Los importes no son espejo (% y %)', a.importe, b.importe;
  END IF;
  IF a.traspaso_con IS NOT NULL OR b.traspaso_con IS NOT NULL THEN
    RAISE EXCEPTION 'Alguno ya está marcado como traspaso';
  END IF;
  IF EXISTS (SELECT 1 FROM public.banco_conciliaciones WHERE movimiento_id IN (_a, _b)) THEN
    RAISE EXCEPTION 'Alguno ya está conciliado con una factura: deshazlo antes';
  END IF;

  PERFORM set_config('app.usuario_id', v_usuario::TEXT, true);
  UPDATE public.banco_movimientos SET traspaso_con = _b WHERE id = _a;
  UPDATE public.banco_movimientos SET traspaso_con = _a WHERE id = _b;
  RETURN true;
END;
$function$;

-- banco_desmarcar_traspaso: desmarca un traspaso. Exige escribir.
CREATE OR REPLACE FUNCTION public.banco_desmarcar_traspaso(_movimiento_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario UUID := auth.uid();
  m RECORD;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  SELECT * INTO m FROM public.banco_movimientos WHERE id = _movimiento_id FOR UPDATE;
  IF NOT FOUND OR m.traspaso_con IS NULL THEN RETURN false; END IF;
  IF v_usuario IS NULL OR NOT public.es_miembro_empresa(v_usuario, m.empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a este movimiento';
  END IF;
  PERFORM set_config('app.usuario_id', v_usuario::TEXT, true);
  UPDATE public.banco_movimientos SET traspaso_con = NULL
   WHERE id IN (_movimiento_id, m.traspaso_con);
  RETURN true;
END;
$function$;

-- textil_compra_registrar: registra una compra textil. Exige escribir.
CREATE OR REPLACE FUNCTION public.textil_compra_registrar(_compra_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_sin_casar INT;
  r RECORD;
  v_n INT := 0;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  SELECT * INTO v_compra FROM public.textil_compras WHERE id = _compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La compra no existe.' USING ERRCODE = 'P0002';
  END IF;

  -- Es SECURITY DEFINER y la puede llamar authenticated: sin esto registraba
  -- la compra de cualquier empresa.
  IF auth.uid() IS NOT NULL
     AND NOT public.es_miembro_empresa(auth.uid(), v_compra.empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa.' USING ERRCODE = '42501';
  END IF;

  IF v_compra.estado = 'registrada' THEN
    RAISE EXCEPTION 'La compra % ya estaba registrada.', COALESCE(v_compra.numero, '(sin número)')
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Las proformas y las facturas casadas van por textil_compra_guardar_y_registrar:
  -- por aquí, la proforma no regularizaría y su pago no pasaría (E-PRO-10).
  IF v_compra.proforma_id IS NOT NULL OR v_compra.tipo_documento = 'proforma' THEN
    RAISE EXCEPTION 'Las proformas y las facturas casadas con una proforma se registran desde la revisión de Compras.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_compra.categoria = 'textil' THEN
    IF EXISTS (SELECT 1 FROM public.textil_compra_lineas
                WHERE compra_id = _compra_id AND tipo <> 'articulo') THEN
      RAISE EXCEPTION 'Esta compra tiene portes, descuentos u otros cargos: regístrala desde la revisión de Textil › Compras para repartirlos.'
        USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT count(*) INTO v_sin_casar
      FROM public.textil_compra_lineas WHERE compra_id = _compra_id AND stock_id IS NULL;
    IF v_sin_casar > 0 THEN
      RAISE EXCEPTION
        'Hay % línea(s) sin asignar a una variante del catálogo. Asígnalas o '
        'bórralas antes de registrar.', v_sin_casar
        USING ERRCODE = 'restrict_violation';
    END IF;

    FOR r IN
      SELECT id, orden, stock_id, cantidad, precio_unitario, unidades_por_pack, coste_unitario_entrada
        FROM public.textil_compra_lineas WHERE compra_id = _compra_id ORDER BY orden
    LOOP
      INSERT INTO public.textil_stock_movimientos
        (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id,
         fecha, nota)
      VALUES (v_compra.empresa_id, r.stock_id, 'compra', r.cantidad * r.unidades_por_pack,
              COALESCE(r.coste_unitario_entrada, r.precio_unitario / r.unidades_por_pack),
              _compra_id, r.id,
              COALESCE(v_compra.fecha, (now() AT TIME ZONE 'Europe/Madrid')::date),
              'Compra ' || COALESCE(v_compra.numero, '(sin número)') ||
              COALESCE(' de ' || v_compra.proveedor, '') || ' · línea ' || (r.orden + 1));
      v_n := v_n + 1;
    END LOOP;
  END IF;

  UPDATE public.textil_compras SET estado = 'registrada' WHERE id = _compra_id;
  RETURN v_n;
END;
$function$;

-- textil_pedido_entregar: entrega un pedido textil. Exige escribir.
CREATE OR REPLACE FUNCTION public.textil_pedido_entregar(_pedido_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_n INT := 0;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  FOR r IN
    SELECT empresa_id, stock_id, cantidad
      FROM public.textil_stock_reservas
     WHERE textil_pedido_id = _pedido_id
  LOOP
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, textil_pedido_id, nota)
    VALUES (r.empresa_id, r.stock_id, 'venta', -r.cantidad, _pedido_id,
            'Entrega del pedido');
    v_n := v_n + 1;
  END LOOP;

  DELETE FROM public.textil_stock_reservas WHERE textil_pedido_id = _pedido_id;
  RETURN v_n;
END;
$function$;

-- siguiente_numero: da el siguiente número de presupuesto o pedido. Exige escribir.
CREATE OR REPLACE FUNCTION public.siguiente_numero(_empresa_id uuid, _ambito text, _ejercicio integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ejercicio INT := COALESCE(_ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_numero INT;
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  -- Una sola sentencia: no hay hueco entre leer y escribir por el que se cuele
  -- otra sesión. El segundo que llegue espera al bloqueo de fila y se lleva el
  -- siguiente.
  INSERT INTO public.contadores AS c (empresa_id, ambito, ejercicio, ultimo)
  VALUES (_empresa_id, _ambito, v_ejercicio, 1)
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = c.ultimo + 1, updated_at = now()
  RETURNING c.ultimo INTO v_numero;

  RETURN v_numero;
END;
$function$;

-- plantillas_correo_sembrar: crea las plantillas de correo de una tienda. Exige escribir.
CREATE OR REPLACE FUNCTION public.plantillas_correo_sembrar(_tienda_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Nivel: escribir (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  INSERT INTO public.tienda_plantillas_correo (empresa_id, tienda_id, clave, asunto, cuerpo)
  SELECT
    t.empresa_id,
    t.id,
    'pedido_enviado',
    'Tu pedido {{pedido_numero}} ya está en camino',
    E'Hola {{cliente_nombre}}:\n\nTu pedido {{pedido_numero}} ha salido de nuestras instalaciones.\n\nTransportista: {{transportista}}\nNúmero de seguimiento: {{codigo_seguimiento}}\nPuedes seguirlo aquí: {{seguimiento_url}}\n\nGracias por confiar en nosotros.\n\n{{tienda_nombre}}'
  FROM public.tiendas t
  WHERE t.id = _tienda_id AND t.empresa_id IS NOT NULL
  ON CONFLICT (tienda_id, clave) DO NOTHING;
END;
$function$;

-- factura_borrar_ultima: borra la última factura o ticket de la serie. Exige borrar.
CREATE OR REPLACE FUNCTION public.factura_borrar_ultima(_tipo text, _id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario UUID := auth.uid();
  v_empresa UUID;
  v_tienda UUID;
  v_serie TEXT;
  v_ejercicio INT;
  v_numero INT;
  v_estado TEXT;
  v_ultimo INT;
  v_inicial INT;
  v_mayor INT;
  v_ref TEXT;
  v_otra TEXT;
BEGIN
  -- Nivel: borrar (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'borrar');
  IF v_usuario IS NULL THEN RAISE EXCEPTION 'Sin usuario'; END IF;

  IF _tipo = 'tienda' THEN
    SELECT f.empresa_id, f.tienda_id, f.serie, f.ejercicio, f.numero, f.estado::TEXT
      INTO v_empresa, v_tienda, v_serie, v_ejercicio, v_numero, v_estado
      FROM public.facturas f WHERE f.id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
    IF NOT public.is_tienda_member(v_usuario, v_tienda) THEN
      RAISE EXCEPTION 'Sin acceso a esta factura';
    END IF;
  ELSIF _tipo = 'textil' THEN
    SELECT f.empresa_id, f.serie, f.ejercicio, f.numero_serie, f.estado
      INTO v_empresa, v_serie, v_ejercicio, v_numero, v_estado
      FROM public.textil_facturas f WHERE f.id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
    IF NOT public.es_miembro_empresa(v_usuario, v_empresa) THEN
      RAISE EXCEPTION 'Sin acceso a esta factura';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de factura desconocido: %', _tipo;
  END IF;

  PERFORM set_config('app.usuario_id', v_usuario::TEXT, true);

  -- Un borrador no tiene número: se borra y ya está.
  IF COALESCE(v_estado, '') = 'borrador' THEN
    PERFORM set_config('app.borrar_factura', _id::TEXT, true);
    IF _tipo = 'tienda' THEN DELETE FROM public.facturas WHERE id = _id;
    ELSE DELETE FROM public.textil_facturas WHERE id = _id; END IF;
    PERFORM set_config('app.borrar_factura', '', true);
    RETURN jsonb_build_object('referencia', NULL, 'tienda_id', v_tienda);
  END IF;

  IF v_numero IS NULL OR v_ejercicio IS NULL THEN
    RAISE EXCEPTION 'Esta factura no tiene número de serie: no se puede borrar.';
  END IF;
  v_ref := public.factura_referencia(v_serie, v_ejercicio, v_numero);

  -- El contador de la serie, bloqueado: nadie emite mientras tanto.
  SELECT s.ultimo_numero, s.numero_inicial INTO v_ultimo, v_inicial
    FROM public.series_facturacion s
   WHERE s.empresa_id = v_empresa AND s.serie = v_serie AND s.ejercicio = v_ejercicio
   FOR UPDATE;

  v_mayor := public.serie_mayor_numero(v_empresa, v_serie, v_ejercicio);
  IF v_numero <> v_mayor OR (v_ultimo IS NOT NULL AND v_numero <> v_ultimo) THEN
    RAISE EXCEPTION 'Solo se puede borrar la última de la serie. La última es %.',
      public.factura_referencia(v_serie, v_ejercicio, GREATEST(v_mayor, COALESCE(v_ultimo, 0)));
  END IF;

  -- Lo que depende de ella, antes.
  SELECT COALESCE(x.numero, '') INTO v_otra FROM (
    SELECT public.factura_referencia(f.serie, f.ejercicio, f.numero) AS numero
      FROM public.facturas f WHERE f.rectifica_a_id = _id OR f.sustituye_a_id = _id
    UNION ALL
    SELECT t.numero FROM public.textil_facturas t WHERE t.rectifica_a_id = _id OR t.sustituye_a_id = _id
  ) x LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'La factura % la rectifica o la sustituye la %: borra antes esa.', v_ref, v_otra;
  END IF;
  IF EXISTS (SELECT 1 FROM public.banco_conciliaciones c
              WHERE c.factura_id = _id OR c.textil_factura_id = _id) THEN
    RAISE EXCEPTION 'La factura % está conciliada con el banco: deshaz la conciliación antes.', v_ref;
  END IF;

  PERFORM set_config('app.borrar_factura', _id::TEXT, true);
  IF _tipo = 'tienda' THEN DELETE FROM public.facturas WHERE id = _id;
  ELSE DELETE FROM public.textil_facturas WHERE id = _id; END IF;
  PERFORM set_config('app.borrar_factura', '', true);

  -- El contador vuelve a la última que queda: la siguiente coge este número.
  v_mayor := COALESCE(public.serie_mayor_numero(v_empresa, v_serie, v_ejercicio),
                      COALESCE(v_inicial, 1) - 1);
  UPDATE public.series_facturacion SET ultimo_numero = v_mayor
   WHERE empresa_id = v_empresa AND serie = v_serie AND ejercicio = v_ejercicio;

  RETURN jsonb_build_object('referencia', v_ref, 'tienda_id', v_tienda,
                            'siguiente', public.factura_referencia(v_serie, v_ejercicio, v_mayor + 1));
END;
$function$;

-- textil_stock_retirar: borra o retira una variante de stock. Exige borrar.
CREATE OR REPLACE FUNCTION public.textil_stock_retirar(_stock_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_movimientos INT;
  v_cantidad NUMERIC;
BEGIN
  -- Nivel: borrar (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'borrar');
  SELECT cantidad INTO v_cantidad FROM public.textil_stock WHERE id = _stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'borrada';   -- ya no estaba (como antes)
  END IF;

  SELECT count(*) INTO v_movimientos
    FROM public.textil_stock_movimientos WHERE stock_id = _stock_id;

  IF v_movimientos = 0 THEN
    DELETE FROM public.textil_stock WHERE id = _stock_id;
    RETURN 'borrada';
  END IF;

  IF v_cantidad <> 0 THEN
    RAISE EXCEPTION 'Esta variante tiene % unidades: para retirarla, anota antes una merma o un ajuste de inventario que la deje a 0, o fusiónala con la buena.',
      replace(trim_scale(v_cantidad)::TEXT, '.', ',') USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE public.textil_stock SET activa = false, updated_at = now() WHERE id = _stock_id;
  RETURN 'desactivada';
END;
$function$;

-- smtp_guardar: guarda el servidor de correo. Exige admin.
CREATE OR REPLACE FUNCTION public.smtp_guardar(_empresa_id uuid, _tienda_id uuid, _host text, _puerto integer, _usuario text, _clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secreto UUID;
  v_nombre TEXT := 'smtp_' || COALESCE(_tienda_id::TEXT, 'general_' || _empresa_id::TEXT);
BEGIN
  -- Nivel: admin (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'admin');
  SELECT clave_secret_id INTO v_secreto
    FROM public.smtp_config
   WHERE empresa_id = _empresa_id
     AND tienda_id IS NOT DISTINCT FROM _tienda_id;

  -- Clave vacía = «no la cambies». Así se puede corregir el puerto sin tener
  -- que volver a teclear la contraseña, que además la pantalla no conoce.
  IF COALESCE(_clave, '') <> '' THEN
    IF v_secreto IS NULL THEN
      v_secreto := vault.create_secret(_clave, v_nombre, 'Contraseña SMTP');
    ELSE
      PERFORM vault.update_secret(v_secreto, _clave);
    END IF;
  END IF;

  IF v_secreto IS NULL THEN
    RAISE EXCEPTION 'Hace falta la contraseña la primera vez que se configura el correo';
  END IF;

  -- Sin ON CONFLICT: los índices son parciales y no sirven de destino de un
  -- upsert. Se mira y se decide, que además se lee mejor.
  IF EXISTS (
    SELECT 1 FROM public.smtp_config
     WHERE empresa_id = _empresa_id AND tienda_id IS NOT DISTINCT FROM _tienda_id
  ) THEN
    UPDATE public.smtp_config
       SET host = btrim(_host),
           puerto = _puerto,
           usuario = btrim(_usuario),
           clave_secret_id = v_secreto
     WHERE empresa_id = _empresa_id
       AND tienda_id IS NOT DISTINCT FROM _tienda_id;
  ELSE
    INSERT INTO public.smtp_config (empresa_id, tienda_id, host, puerto, usuario, clave_secret_id)
    VALUES (_empresa_id, _tienda_id, btrim(_host), _puerto, btrim(_usuario), v_secreto);
  END IF;
END;
$function$;

-- smtp_borrar_tienda: quita el correo propio de una tienda. Exige admin.
CREATE OR REPLACE FUNCTION public.smtp_borrar_tienda(_tienda_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_borradas INT;
BEGIN
  -- Nivel: admin (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'admin');
  -- El secreto de Vault se queda: borrarlo desde aquí sería borrar una clave
  -- que quizá comparte otra fila. Sin referencia, es inaccesible.
  DELETE FROM public.smtp_config WHERE tienda_id = _tienda_id;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas > 0;
END;
$function$;

-- tienda_credenciales_guardar: guarda las credenciales de WooCommerce. Exige admin.
CREATE OR REPLACE FUNCTION public.tienda_credenciales_guardar(_tienda_id uuid, _consumer_key text, _consumer_secret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id_key UUID;
  v_id_secret UUID;
BEGIN
  -- Nivel: admin (20261031200300).
  PERFORM public.rol_exigir_quien(NULL, 'admin');
  SELECT consumer_key_secret_id, consumer_secret_secret_id
    INTO v_id_key, v_id_secret
    FROM public.tienda_credenciales WHERE tienda_id = _tienda_id;

  IF v_id_key IS NULL THEN
    v_id_key := vault.create_secret(
      _consumer_key, 'woo_ck_' || _tienda_id::TEXT, 'Consumer key de WooCommerce');
  ELSE
    PERFORM vault.update_secret(v_id_key, _consumer_key);
  END IF;

  IF v_id_secret IS NULL THEN
    v_id_secret := vault.create_secret(
      _consumer_secret, 'woo_cs_' || _tienda_id::TEXT, 'Consumer secret de WooCommerce');
  ELSE
    PERFORM vault.update_secret(v_id_secret, _consumer_secret);
  END IF;

  -- El valor ya está en Vault. Las columnas en claro se quedan vacías: si no,
  -- cambiar las credenciales dejaría las anteriores tiradas en la tabla.
  INSERT INTO public.tienda_credenciales (
    tienda_id, consumer_key, consumer_secret,
    consumer_key_secret_id, consumer_secret_secret_id)
  VALUES (_tienda_id, '', '', v_id_key, v_id_secret)
  ON CONFLICT (tienda_id) DO UPDATE SET
    consumer_key = '',
    consumer_secret = '',
    consumer_key_secret_id = EXCLUDED.consumer_key_secret_id,
    consumer_secret_secret_id = EXCLUDED.consumer_secret_secret_id,
    updated_at = now();
END;
$function$;

NOTIFY pgrst, 'reload schema';
