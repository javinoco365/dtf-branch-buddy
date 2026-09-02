-- ============================================================================
-- FACTURACIÓN 2/2 · El módulo textil, al mismo motor
-- ============================================================================
--
-- QUÉ HACE
--   Pone textil_facturas sobre el mismo contador con bloqueo y la misma
--   inmutabilidad que public.facturas, y añade emitir_factura_textil().
--
-- POR QUÉ
--   textil_facturas tiene hoy su propio generador de numeración,
--   nextNumero() en src/lib/textil.functions.ts, que hace:
--
--     select numero ... like 'FAC%' order by created_at desc limit 1
--     → parseInt del sufijo → +1
--
--   Tres fallos en cuatro líneas: dos usuarios a la vez obtienen el mismo
--   número; al cambiar de ejercicio la secuencia se reinicia mal porque ordena
--   por fecha de creación y no filtra por año; y a partir de 9999 el relleno de
--   ceros se rompe.
--
--   Además convertirPresupuestoEnFactura crea la factura directamente en estado
--   'emitida', así que cada uno de esos números es ya un documento fiscal.
--
--   Dos sistemas de facturación en la misma sociedad es el doble de superficie
--   legal por el mismo negocio. Este es el segundo, y pasa al motor bueno.
--
-- SOBRE LA SERIE
--   Las facturas textil siguen con su formato de número, FAC-AAAA-NNNN, para no
--   romper las que ya existen. Lo que cambia es de dónde sale NNNN: de
--   series_facturacion con la fila bloqueada, en la serie 'FAC'.
--
-- DEPENDE DE
--   20260902120000_empresas.sql
--   20260902120200_rls_por_empresa.sql (bloqueo de borrado ya añadido allí)
--   20260902130000_motor_facturacion.sql (series_facturacion, factura_calcular)
--
-- REVERSIBLE
--   Sí. Se añaden columnas y funciones; no se borra ni se modifica ninguna fila.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lo que le falta a textil_facturas
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_facturas
  ADD COLUMN IF NOT EXISTS ejercicio INTEGER,
  -- El número como entero, que es lo que se puede comprobar sin huecos.
  -- La columna numero sigue guardando el texto FAC-AAAA-NNNN que se imprime.
  ADD COLUMN IF NOT EXISTS numero_serie INTEGER,
  ADD COLUMN IF NOT EXISTS tipo public.factura_tipo NOT NULL DEFAULT 'ordinaria',
  ADD COLUMN IF NOT EXISTS rectifica_a_id UUID REFERENCES public.textil_facturas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_rectificacion TEXT,
  ADD COLUMN IF NOT EXISTS emitida_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS emisor_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS receptor_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS lineas_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS desglose_iva JSONB;

COMMENT ON COLUMN public.textil_facturas.numero_serie IS
  'El número correlativo como entero. numero guarda su representación impresa, FAC-AAAA-NNNN.';

-- Rellenar lo que ya existe a partir del texto del número: FAC-2026-0007 → 7.
UPDATE public.textil_facturas
   SET ejercicio = COALESCE(ejercicio, EXTRACT(YEAR FROM fecha)::INT),
       numero_serie = COALESCE(
         numero_serie,
         NULLIF(regexp_replace(split_part(numero, '-', 3), '\D', '', 'g'), '')::INT
       )
 WHERE ejercicio IS NULL OR numero_serie IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Sembrar el contador de la serie textil
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_empresa UUID;
  r RECORD;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;

  FOR r IN
    SELECT COALESCE(ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS ejercicio,
           COALESCE(max(numero_serie), 0) AS ultimo
      FROM public.textil_facturas
     GROUP BY COALESCE(ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT)
  LOOP
    INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
    VALUES (v_empresa, NULL, 'FAC', r.ejercicio, r.ultimo)
    ON CONFLICT (empresa_id, serie, ejercicio) DO UPDATE
      SET ultimo_numero = GREATEST(public.series_facturacion.ultimo_numero, EXCLUDED.ultimo_numero);
  END LOOP;

  -- Si todavía no hay ninguna factura textil, deja la serie del ejercicio en curso creada.
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (v_empresa, NULL, 'FAC', EXTRACT(YEAR FROM CURRENT_DATE)::INT, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Emitir una factura textil
-- ---------------------------------------------------------------------------
-- Mismo patrón que emitir_factura(): el número se asigna con la fila de la
-- serie bloqueada y el contenido se congela en el momento.
--
-- El emisor es la sociedad. La marca comercial aporta el nombre y el aspecto
-- del documento, no la identidad fiscal: DTI S.L. tiene un solo CIF.
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

  -- ---- El número, bajo bloqueo ----
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (v_empresa, NULL, 'FAC', v_ejercicio, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;

  SELECT s.id, s.ultimo_numero INTO v_serie_id, v_numero
    FROM public.series_facturacion s
   WHERE s.empresa_id = v_empresa AND s.serie = 'FAC' AND s.ejercicio = v_ejercicio
     FOR UPDATE;

  v_numero := v_numero + 1;
  UPDATE public.series_facturacion SET ultimo_numero = v_numero WHERE id = v_serie_id;

  v_numero_texto := format('FAC-%s-%s', v_ejercicio, lpad(v_numero::TEXT, 4, '0'));

  -- ---- Importes, con el mismo cálculo que el resto del proyecto ----
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
    v_empresa, v_numero_texto, 'FAC', v_ejercicio, v_numero,
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

  FOR r IN SELECT * FROM jsonb_array_elements(v_calc -> 'lineas') AS l LOOP
    INSERT INTO public.textil_factura_items (
      factura_id, descripcion, cantidad, precio_unitario, iva_pct, subtotal
    ) VALUES (
      v_factura_id,
      r.l ->> 'descripcion',
      (r.l ->> 'cantidad')::NUMERIC,
      (r.l ->> 'precio_unitario')::NUMERIC,
      (r.l ->> 'iva_rate')::NUMERIC,
      (r.l ->> 'subtotal')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_factura_id,
    'numero', v_numero_texto,
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
  UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura_textil(
  UUID, JSONB, JSONB, UUID, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Inmutabilidad
-- ---------------------------------------------------------------------------
-- La migración 20260902120200 ya impide BORRAR una factura textil emitida.
-- Esto impide además MODIFICARLA. Igual que en public.facturas, el estado de
-- cobro sí se puede cambiar: no forma parte del documento fiscal.
REVOKE INSERT, UPDATE, DELETE ON public.textil_facturas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.textil_factura_items FROM authenticated;
REVOKE DELETE ON public.textil_facturas FROM service_role;
REVOKE DELETE ON public.textil_factura_items FROM service_role;

DROP POLICY IF EXISTS textil_facturas_alta ON public.textil_facturas;
DROP POLICY IF EXISTS textil_facturas_modificacion ON public.textil_facturas;
DROP POLICY IF EXISTS textil_facturas_borrado ON public.textil_facturas;

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
      NEW.rectifica_a_id, NEW.motivo_rectificacion, NEW.emitida_en, NEW.empresa_id)
     IS DISTINCT FROM
     (OLD.numero, OLD.serie, OLD.ejercicio, OLD.numero_serie, OLD.fecha, OLD.tipo,
      OLD.subtotal, OLD.iva, OLD.total,
      OLD.emisor_snapshot, OLD.receptor_snapshot, OLD.lineas_snapshot, OLD.desglose_iva,
      OLD.cliente_nombre, OLD.cliente_nif, OLD.cliente_direccion,
      OLD.rectifica_a_id, OLD.motivo_rectificacion, OLD.emitida_en, OLD.empresa_id)
  THEN
    RAISE EXCEPTION
      'La factura % está emitida: su contenido fiscal no se modifica. Emite una rectificativa.',
      OLD.numero;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_facturas_inmutable ON public.textil_facturas;
CREATE TRIGGER textil_facturas_inmutable
  BEFORE UPDATE ON public.textil_facturas
  FOR EACH ROW EXECUTE FUNCTION public.textil_factura_inmutable();

-- Función propia: factura_item_inmutable() consulta public.facturas, así que
-- reutilizarla aquí no encontraría la factura y dejaría pasar el cambio.
CREATE OR REPLACE FUNCTION public.textil_factura_item_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_estado TEXT;
BEGIN
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

DROP TRIGGER IF EXISTS textil_factura_items_inmutable ON public.textil_factura_items;
CREATE TRIGGER textil_factura_items_inmutable
  BEFORE UPDATE OR DELETE ON public.textil_factura_items
  FOR EACH ROW EXECUTE FUNCTION public.textil_factura_item_inmutable();
