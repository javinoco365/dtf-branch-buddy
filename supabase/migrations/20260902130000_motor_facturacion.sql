-- ============================================================================
-- FACTURACIÓN 1/2 · El motor: numeración con bloqueo, inmutabilidad, snapshots
-- ============================================================================
--
-- QUÉ HACE
--   1. series_facturacion: el contador correlativo, por serie y ejercicio.
--   2. emitir_factura(): asigna número dentro de una transacción con bloqueo,
--      congela los snapshots y escribe factura y líneas de una vez.
--   3. Inmutabilidad: una factura emitida no se puede editar ni borrar. Lo
--      impiden los permisos y, además, un trigger que enumera qué campos son
--      fiscales.
--   4. Rectificativas y anulaciones como registros nuevos.
--
-- POR QUÉ
--   Hoy el número de factura se asigna EN EL NAVEGADOR
--   (routes/panel/tiendas/$tiendaId/facturas.tsx): lee siguiente_numero_factura
--   de la tienda, inserta la factura y después incrementa el contador. Dos
--   pestañas a la vez producen un número duplicado o un hueco en la serie. Y la
--   RLS actual es FOR ALL, así que cualquier usuario logueado puede modificar o
--   borrar una factura ya emitida desde la consola del navegador.
--
--   Verifactu exige numeración correlativa sin huecos y registros inalterables.
--   Nada de eso se puede garantizar desde el cliente.
--
-- ESTO NO ES EL SIF DE VERIFACTU
--   Aquí no hay huella SHA-256 encadenada de registros de facturación ni envío
--   a la AEAT. Eso lo hace el proveedor certificado, y DTI no lo implementa para
--   no convertirse en productora de SIF. Lo que hay aquí es el motor interno
--   sobre el que ese proveedor se enganchará: numeración fiable, contenido
--   congelado e inmutabilidad.
--
-- DEPENDE DE
--   20260902120000_empresas.sql (empresa_id, empresa_por_defecto)
--   20260902120100_auditoria.sql (app.usuario_id)
--
-- REVERSIBLE
--   Las columnas y tablas nuevas, sí. Los REVOKE se restauran con los GRANT
--   equivalentes. Ninguna fila existente se borra ni se modifica.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El contador
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series_facturacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  -- Informativo: de qué tienda salen las facturas de esta serie. La serie es de
  -- la empresa, porque el sujeto fiscal es la sociedad, no la tienda.
  tienda_id UUID REFERENCES public.tiendas(id) ON DELETE SET NULL,
  serie TEXT NOT NULL,
  ejercicio INTEGER NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, serie, ejercicio),
  CONSTRAINT series_numero_no_retrocede CHECK (ultimo_numero >= 0)
);

COMMENT ON TABLE public.series_facturacion IS
  'Contador correlativo por serie y ejercicio. Solo lo toca emitir_factura(), dentro de una transacción con bloqueo.';
COMMENT ON COLUMN public.series_facturacion.ultimo_numero IS
  'Último número emitido. Nunca se decrementa: un hueco en la serie no se arregla reutilizando el número.';

CREATE TRIGGER series_facturacion_touch BEFORE UPDATE ON public.series_facturacion
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Solo lectura para la aplicación: el contador no se toca a mano.
GRANT SELECT ON public.series_facturacion TO authenticated;
GRANT ALL ON public.series_facturacion TO service_role;

ALTER TABLE public.series_facturacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "series lectura miembros" ON public.series_facturacion
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- ---------------------------------------------------------------------------
-- 2. Semilla del contador desde lo que ya hay
-- ---------------------------------------------------------------------------
-- El punto de partida es el mayor número REALMENTE emitido en cada serie, no
-- el siguiente_numero_factura de la tienda: si ese contador se desincronizó
-- alguna vez, arrancar de él produciría un número repetido.
DO $$
DECLARE
  r RECORD;
  v_empresa UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;

  FOR r IN
    SELECT
      t.id AS tienda_id,
      COALESCE(NULLIF(TRIM(t.serie_factura), ''), 'A') AS serie,
      EXTRACT(YEAR FROM CURRENT_DATE)::INT AS ejercicio,
      GREATEST(
        COALESCE((
          SELECT max(f.numero) FROM public.facturas f
          WHERE f.tienda_id = t.id
            AND f.serie = COALESCE(NULLIF(TRIM(t.serie_factura), ''), 'A')
            AND EXTRACT(YEAR FROM f.fecha)::INT = EXTRACT(YEAR FROM CURRENT_DATE)::INT
        ), 0),
        COALESCE(t.siguiente_numero_factura - 1, 0),
        0
      ) AS ultimo
    FROM public.tiendas t
  LOOP
    INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
    VALUES (v_empresa, r.tienda_id, r.serie, r.ejercicio, r.ultimo)
    ON CONFLICT (empresa_id, serie, ejercicio) DO UPDATE
      SET ultimo_numero = GREATEST(public.series_facturacion.ultimo_numero, EXCLUDED.ultimo_numero);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Lo que la factura tiene que congelar
-- ---------------------------------------------------------------------------
CREATE TYPE public.factura_tipo AS ENUM ('ordinaria', 'rectificativa');

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS tipo public.factura_tipo NOT NULL DEFAULT 'ordinaria',
  ADD COLUMN IF NOT EXISTS ejercicio INTEGER,
  ADD COLUMN IF NOT EXISTS emitida_en TIMESTAMPTZ,
  -- Códigos de la normativa: R1 a R5.
  ADD COLUMN IF NOT EXISTS motivo_rectificacion TEXT,
  ADD COLUMN IF NOT EXISTS rectifica_a_id UUID REFERENCES public.facturas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS emisor_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS receptor_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS lineas_snapshot JSONB,
  -- Desglose por tipo impositivo: [{"tipo":21,"base":100.00,"cuota":21.00}]
  ADD COLUMN IF NOT EXISTS desglose_iva JSONB;

COMMENT ON COLUMN public.facturas.emisor_snapshot IS
  'Datos del emisor congelados el día de la emisión. No se recalculan nunca leyendo empresas.';
COMMENT ON COLUMN public.facturas.desglose_iva IS
  'Desglose por tipo impositivo. La cuota de cada tipo se calcula sobre la base agregada de ese tipo, no sumando cuotas de línea.';
COMMENT ON COLUMN public.facturas.rectifica_a_id IS
  'Factura que esta rectifica. ON DELETE RESTRICT: la original no se puede borrar, y de todos modos ninguna emitida se borra.';

UPDATE public.facturas
   SET ejercicio = EXTRACT(YEAR FROM fecha)::INT
 WHERE ejercicio IS NULL;

CREATE INDEX IF NOT EXISTS facturas_rectifica_idx ON public.facturas (rectifica_a_id)
  WHERE rectifica_a_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Cálculo de importes, idéntico al de src/dominio/importes.ts
-- ---------------------------------------------------------------------------
-- La cuota se calcula por tipo impositivo sobre la base agregada de ese tipo,
-- no sumando las cuotas de cada línea. Es como lo espera la Agencia Tributaria
-- y es la forma del desglose que exige Verifactu.
--
-- round() sobre numeric en Postgres redondea a la mitad alejándose del cero,
-- igual que redondear() en el módulo de dominio. Si alguna vez difieren, la
-- pantalla y la base dejarán de cuadrar: las pruebas de importes.test.ts son la
-- referencia.
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

-- ---------------------------------------------------------------------------
-- 5. Emitir
-- ---------------------------------------------------------------------------
-- El número no existe fuera de esta transacción. El bloqueo de la fila de la
-- serie serializa las emisiones concurrentes: sin él, dos peticiones leen el
-- mismo contador y emiten el mismo número.
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

  -- SECURITY DEFINER se salta la RLS, así que la pertenencia se comprueba aquí.
  IF NOT public.is_tienda_member(_usuario_id, _tienda_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta tienda';
  END IF;

  IF jsonb_array_length(COALESCE(_lineas, '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'Una factura sin líneas no se emite';
  END IF;

  IF _rectifica_a_id IS NOT NULL AND COALESCE(TRIM(_motivo_rectificacion), '') = '' THEN
    RAISE EXCEPTION 'Una rectificativa necesita motivo (códigos R1 a R5)';
  END IF;

  -- Deja el autor fijado para los triggers de auditoría de esta transacción.
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  SELECT t.empresa_id, COALESCE(NULLIF(TRIM(t.serie_factura), ''), 'A')
    INTO v_empresa, v_serie
    FROM public.tiendas t WHERE t.id = _tienda_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'La tienda % no existe o no tiene empresa', _tienda_id;
  END IF;

  -- ---- El número, bajo bloqueo ----
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (v_empresa, _tienda_id, v_serie, v_ejercicio, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;

  SELECT s.id, s.ultimo_numero INTO v_serie_id, v_numero
    FROM public.series_facturacion s
   WHERE s.empresa_id = v_empresa AND s.serie = v_serie AND s.ejercicio = v_ejercicio
     FOR UPDATE;                       -- serializa las emisiones concurrentes

  v_numero := v_numero + 1;

  UPDATE public.series_facturacion
     SET ultimo_numero = v_numero
   WHERE id = v_serie_id;

  -- ---- Importes ----
  v_calc := public.factura_calcular(_lineas);

  -- ---- Emisor: la sociedad, no la tienda ----
  -- El sujeto fiscal es DTI S.L., que tiene un solo CIF. La tienda aporta el
  -- nombre comercial, no la identidad fiscal.
  --
  -- OJO, ESTO CAMBIA EL CRITERIO ACTUAL: facturas.tsx daba precedencia a
  -- tiendas.razon_social y tiendas.cif sobre los de la empresa, de modo que una
  -- tienda con datos fiscales propios rellenados emitía a su nombre.
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
           'nombre_comercial', t.nombre
         )
    INTO v_emisor
    FROM public.empresas e
    JOIN public.tiendas t ON t.id = _tienda_id
   WHERE e.id = v_empresa;

  -- ---- La factura ----
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
    -- Las columnas planas se conservan porque el PDF y las pantallas todavía
    -- las leen. La fuente de verdad son los snapshots.
    _receptor ->> 'nombre', _receptor ->> 'nif', _receptor ->> 'direccion',
    v_emisor ->> 'razon_social', v_emisor ->> 'cif', v_emisor ->> 'direccion'
  )
  RETURNING id INTO v_factura_id;

  -- ---- Las líneas ----
  FOR r IN SELECT * FROM jsonb_array_elements(v_calc -> 'lineas') AS l LOOP
    INSERT INTO public.factura_items (
      factura_id, descripcion, cantidad, unidad,
      precio_unitario, iva_rate, subtotal, iva, total
    ) VALUES (
      v_factura_id,
      r.l ->> 'descripcion',
      (r.l ->> 'cantidad')::NUMERIC,
      r.l ->> 'unidad',
      (r.l ->> 'precio_unitario')::NUMERIC,
      (r.l ->> 'iva_rate')::NUMERIC,
      (r.l ->> 'subtotal')::NUMERIC,
      (r.l ->> 'iva')::NUMERIC,
      (r.l ->> 'total')::NUMERIC
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_factura_id,
    'serie', v_serie,
    'numero', v_numero,
    'ejercicio', v_ejercicio,
    'tipo', v_tipo,
    'base_imponible', (v_calc ->> 'base_imponible')::NUMERIC,
    'iva_total', (v_calc ->> 'iva_total')::NUMERIC,
    'total', (v_calc ->> 'total')::NUMERIC
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.emitir_factura(
  UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emitir_factura(
  UUID, UUID, JSONB, JSONB, DATE, DATE, UUID, UUID, TEXT, UUID, TEXT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Una factura emitida no se edita ni se borra
-- ---------------------------------------------------------------------------
-- Dos candados, porque son independientes:
--   permisos  → cierran la puerta al rol del navegador.
--   trigger   → cierra la puerta también a supabaseAdmin, que se salta la RLS
--               por definición y es quien ejecuta las funciones de servidor.

REVOKE INSERT, UPDATE, DELETE ON public.facturas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.factura_items FROM authenticated;
REVOKE DELETE ON public.facturas FROM service_role;
REVOKE DELETE ON public.factura_items FROM service_role;

-- La RLS FOR ALL se sustituye por lectura, y nada más.
DROP POLICY IF EXISTS "facturas member access" ON public.facturas;
CREATE POLICY "facturas lectura miembros" ON public.facturas
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "factura_items member access" ON public.factura_items;
CREATE POLICY "factura_items lectura miembros" ON public.factura_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.facturas f
    WHERE f.id = factura_items.factura_id
      AND public.is_tienda_member(auth.uid(), f.tienda_id)
  ));

-- Qué se puede seguir cambiando de una factura emitida: el estado de cobro y la
-- URL del PDF. Nada más. Marcar una factura como pagada no altera el documento
-- fiscal; cambiarle el importe, sí.
CREATE OR REPLACE FUNCTION public.factura_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_ref TEXT;
BEGIN
  v_ref := COALESCE(OLD.serie, '?') || '-' || COALESCE(OLD.numero::TEXT, '?');

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

DROP TRIGGER IF EXISTS facturas_inmutable ON public.facturas;
CREATE TRIGGER facturas_inmutable
  BEFORE UPDATE OR DELETE ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.factura_inmutable();

-- Las líneas de una factura emitida no se tocan en absoluto.
CREATE OR REPLACE FUNCTION public.factura_item_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_estado TEXT;
  v_factura UUID := COALESCE(NEW.factura_id, OLD.factura_id);
BEGIN
  SELECT f.estado::TEXT INTO v_estado FROM public.facturas f WHERE f.id = v_factura;

  IF v_estado IS NOT NULL AND v_estado <> 'borrador' THEN
    RAISE EXCEPTION
      'Las líneas de una factura emitida no se modifican. Emite una rectificativa.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS factura_items_inmutable ON public.factura_items;
CREATE TRIGGER factura_items_inmutable
  BEFORE UPDATE OR DELETE ON public.factura_items
  FOR EACH ROW EXECUTE FUNCTION public.factura_item_inmutable();

-- ---------------------------------------------------------------------------
-- 7. Comprobación de huecos en la serie
-- ---------------------------------------------------------------------------
-- Verifactu exige numeración sin huecos. Esto los encuentra.
-- Sin filas devueltas, las series están completas.
CREATE OR REPLACE FUNCTION public.facturas_huecos_en_serie()
RETURNS TABLE (empresa_id UUID, serie TEXT, ejercicio INTEGER, numero_ausente INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.empresa_id, s.serie, s.ejercicio, g.n
  FROM public.series_facturacion s
  CROSS JOIN LATERAL generate_series(1, s.ultimo_numero) AS g(n)
  WHERE s.ultimo_numero > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.facturas f
      WHERE f.empresa_id = s.empresa_id
        AND f.serie = s.serie
        AND f.ejercicio = s.ejercicio
        AND f.numero = g.n
    );
$$;

COMMENT ON FUNCTION public.facturas_huecos_en_serie() IS
  'Números emitidos según el contador que no tienen factura. Debe devolver cero filas.';

REVOKE EXECUTE ON FUNCTION public.facturas_huecos_en_serie() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturas_huecos_en_serie() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Cambiar el estado de cobro
-- ---------------------------------------------------------------------------
-- El navegador ha perdido el permiso de UPDATE sobre facturas, así que marcar
-- una factura como pagada pasa por aquí. Va como función y no como un update
-- suelto para poder fijar app.usuario_id en la misma transacción: con
-- supabaseAdmin cada petición es su propia transacción y la auditoría se
-- quedaría sin autor.
CREATE OR REPLACE FUNCTION public.factura_cambiar_estado_cobro(
  _usuario_id UUID,
  _factura_id UUID,
  _estado public.factura_estado
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tienda UUID;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.factura_cambiar_estado_cobro(UUID, UUID, public.factura_estado)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factura_cambiar_estado_cobro(UUID, UUID, public.factura_estado)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Anular: una rectificativa por el importe completo, en negativo
-- ---------------------------------------------------------------------------
-- Anular no borra ni cambia la original. Emite una factura nueva que la
-- rectifica con las mismas líneas en negativo, de modo que las dos juntas suman
-- cero y las dos siguen en el libro.
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
    RAISE EXCEPTION 'La factura %-% ya tiene una rectificativa emitida',
      v_original.serie, v_original.numero;
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
      'La factura %-% no tiene líneas congeladas: se emitió antes de este motor y hay que anularla a mano',
      v_original.serie, v_original.numero;
  END IF;

  RETURN public.emitir_factura(
    _usuario_id            => _usuario_id,
    _tienda_id             => v_original.tienda_id,
    _receptor              => COALESCE(v_original.receptor_snapshot, '{}'::JSONB),
    _lineas                => v_lineas,
    _fecha                 => CURRENT_DATE,
    _cliente_id            => v_original.cliente_id,
    _pedido_id             => v_original.pedido_id,
    _notas                 => format('Anulación de la factura %s-%s', v_original.serie, v_original.numero),
    _rectifica_a_id        => _factura_id,
    _motivo_rectificacion  => COALESCE(NULLIF(TRIM(_motivo), ''), 'R1')
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anular_factura(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_factura(UUID, UUID, TEXT) TO service_role;
