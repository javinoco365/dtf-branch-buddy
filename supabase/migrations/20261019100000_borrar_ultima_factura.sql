-- ============================================================================
-- BORRAR LA ÚLTIMA FACTURA O TICKET DE UNA SERIE
-- ============================================================================
--
-- QUÉ RESUELVE
--   Una factura o ticket emitido no se podía borrar nunca: solo anular con una
--   rectificativa. Javier decide (7-10-2026) que la ÚLTIMA de cada serie se
--   pueda borrar del todo y que su número lo reutilice la siguiente. Solo la
--   última: así la numeración sigue siendo correlativa y sin huecos.
--
-- QUÉ HACE
--   factura_borrar_ultima(tipo, id), con tipo 'tienda' (facturas) o 'textil'
--   (textil_facturas):
--     - Comprueba que es la de número más alto de su serie y ejercicio,
--       mirando las dos tablas (comparten contador), y que el contador va por
--       ella. Si no, dice cuál es la última.
--     - Se niega si la rectifica o la sustituye otra (bórrala antes) o si está
--       conciliada con el banco (deshazlo antes).
--     - La borra con sus líneas y deja el contador en la última que queda: la
--       siguiente coge su número.
--     - Un borrador (sin número) se borra sin más comprobaciones.
--   Las funciones de inmutabilidad dejan pasar ESE borrado y ningún otro: la
--   función marca en la transacción qué factura borra (app.borrar_factura) y
--   solo ella puede hacerlo, porque nadie más tiene permiso de DELETE.
--   La auditoría registra el borrado con su autor, como cualquier cambio.
--   El PDF lo borra el servidor después (el almacenamiento no se toca en SQL).
--
-- REVERSIBLE
--   Sí, en lo que a esquema se refiere: DROP FUNCTION de factura_borrar_ultima
--   y volver a crear las cuatro funciones de inmutabilidad sin la primera
--   línea (están en 20261004100100_tickets.sql, 20260902120200_rls_por_empresa.sql,
--   20260902130000_motor_facturacion.sql y 20260902130100_motor_facturacion_textil.sql).
--   Lo que se haya borrado con ella no vuelve. Se puede aplicar dos veces.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Las protecciones dejan pasar el borrado que hace factura_borrar_ultima
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.factura_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ref TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.borrar_factura', true) = OLD.id::TEXT THEN
    RETURN OLD;
  END IF;

  v_ref := public.factura_referencia(OLD.serie, OLD.ejercicio, OLD.numero);

  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'borrador' THEN RETURN OLD; END IF;
    RAISE EXCEPTION
      'La factura % está emitida. Solo se puede borrar la última de su serie.', v_ref;
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

CREATE OR REPLACE FUNCTION public.factura_emitida_no_se_borra()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.borrar_factura', true) = OLD.id::TEXT THEN RETURN OLD; END IF;
  IF COALESCE(OLD.estado::TEXT, '') <> 'borrador' THEN
    RAISE EXCEPTION
      'La factura % está emitida. Solo se puede borrar la última de su serie.',
      COALESCE(OLD.numero, OLD.id::TEXT);
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.factura_item_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_estado TEXT;
  v_factura UUID := COALESCE(NEW.factura_id, OLD.factura_id);
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.borrar_factura', true) = OLD.factura_id::TEXT THEN
    RETURN OLD;
  END IF;

  SELECT f.estado::TEXT INTO v_estado FROM public.facturas f WHERE f.id = v_factura;

  IF v_estado IS NOT NULL AND v_estado <> 'borrador' THEN
    RAISE EXCEPTION
      'Las líneas de una factura emitida no se modifican. Emite una rectificativa.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.textil_factura_item_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.borrar_factura', true) = OLD.factura_id::TEXT THEN
    RETURN OLD;
  END IF;

  SELECT f.estado INTO v_estado
    FROM public.textil_facturas f
   WHERE f.id = COALESCE(NEW.factura_id, OLD.factura_id);

  IF v_estado IS NOT NULL AND v_estado <> 'borrador' THEN
    RAISE EXCEPTION
      'Las líneas de una factura emitida no se modifican. Emite una rectificativa.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. El número más alto emitido de una serie, en las dos tablas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serie_mayor_numero(_empresa_id UUID, _serie TEXT, _ejercicio INT)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(n) FROM (
    SELECT f.numero AS n FROM public.facturas f
     WHERE f.empresa_id = _empresa_id AND f.serie = _serie AND f.ejercicio = _ejercicio
       AND f.estado <> 'borrador'
    UNION ALL
    SELECT t.numero_serie FROM public.textil_facturas t
     WHERE t.empresa_id = _empresa_id AND t.serie = _serie AND t.ejercicio = _ejercicio
       AND COALESCE(t.estado, '') <> 'borrador'
  ) x;
$$;

REVOKE EXECUTE ON FUNCTION public.serie_mayor_numero(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.serie_mayor_numero(UUID, TEXT, INT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Borrar la última
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.factura_borrar_ultima(_tipo TEXT, _id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

COMMENT ON FUNCTION public.factura_borrar_ultima(TEXT, UUID) IS
  'Borra del todo la última factura o ticket de su serie (o un borrador) y deja el contador en '
  'la última que queda. Se niega con cualquier otra.';

REVOKE EXECUTE ON FUNCTION public.factura_borrar_ultima(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.factura_borrar_ultima(TEXT, UUID) TO authenticated, service_role;
