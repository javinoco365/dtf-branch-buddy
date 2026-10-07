-- ============================================================================
-- CONCILIACIÓN: COMPRAS, VARIAS FACTURAS, «REVISAR» Y TRASPASOS
-- ============================================================================
--
-- QUÉ RESUELVE
--   La conciliación solo sabía casar un ingreso con una factura emitida de la
--   tienda, uno a uno. Faltaba:
--     - Los CARGOS contra las facturas RECIBIDAS (textil_compras), por su
--       líquido, y los abonos contra las facturas de textil.
--     - Un pago que cubre varias facturas, o una factura pagada en varios
--       movimientos.
--     - Distinguir lo seguro (verde) de lo que una persona tiene que mirar
--       (ámbar, «revisar»), sin forzar nunca lo segundo a verde.
--     - Los traspasos entre cuentas propias, que no pagan nada.
--
-- QUÉ CAMBIA (sin tocar ningún documento fiscal)
--   banco_conciliaciones:
--     - factura_id pasa a ser opcional y se añaden compra_id y
--       textil_factura_id: cada fila enlaza un movimiento con UN documento.
--     - estado: 'conciliada' (verde) o 'revisar' (ámbar).
--     - grupo: las filas de un mismo enlace (1 movimiento ↔ N facturas o
--       N movimientos ↔ 1 factura) comparten grupo y se confirman o deshacen
--       juntas.
--     - importe: lo que el documento espera ver en el banco (su líquido, con
--       signo), congelado al enlazar.
--     - marco_pagada: si al conciliar se marcó el documento como pagado, para
--       devolverlo a pendiente al deshacer, y solo entonces.
--     - Se quitan los UNIQUE uno a uno (impedían los grupos). Lo que garantizan
--       —un movimiento o un documento no se concilia dos veces— lo comprueban
--       ahora las funciones con el movimiento y el documento bloqueados.
--     - Se quita la política de borrado directo: deshacer pasa siempre por
--       banco_desenlazar, que devuelve la compra o la factura a pendiente. Un
--       DELETE suelto dejaría la compra pagada sin respaldo.
--   banco_movimientos.traspaso_con: el movimiento espejo en otra cuenta propia.
--
-- FUNCIONES (SECURITY DEFINER, el autor es auth.uid())
--   banco_enlazar(movimientos, documentos, estado, motivo) → grupo
--   banco_confirmar(grupo)        de 'revisar' a 'conciliada'
--   banco_desenlazar(grupo)       deshace el enlace entero
--   banco_marcar_traspaso(a, b) / banco_desmarcar_traspaso(movimiento)
--   banco_conciliar y banco_desconciliar siguen funcionando igual (los usa la
--   pantalla antigua) y ahora pasan por las mismas comprobaciones.
--
--   Al quedar 'conciliada': la compra pasa a pagada con la fecha del
--   movimiento, y la factura de la tienda a pagada (como hasta ahora). La
--   factura de textil no se toca: su cobro se lleva por pedido. En 'revisar'
--   no cambia nada hasta que alguien lo confirma.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261017100000_conciliacion_motor.sql. Se niega
--   a revertir si hay enlaces que el esquema anterior no sabe guardar
--   (compras, textil, grupos o 'revisar'): hay que deshacerlos antes.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. banco_conciliaciones: un movimiento ↔ un documento, en grupos
-- ---------------------------------------------------------------------------
ALTER TABLE public.banco_conciliaciones
  ALTER COLUMN factura_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES public.textil_compras(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS textil_factura_id UUID
    REFERENCES public.textil_facturas(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'conciliada',
  ADD COLUMN IF NOT EXISTS grupo UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS importe NUMERIC(12,2),
  -- Las filas de antes marcaron la factura como pagada: true.
  ADD COLUMN IF NOT EXISTS marco_pagada BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.banco_conciliaciones
    ADD CONSTRAINT conciliacion_estado CHECK (estado IN ('conciliada', 'revisar'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.banco_conciliaciones
    ADD CONSTRAINT conciliacion_un_documento
    CHECK (num_nonnulls(factura_id, compra_id, textil_factura_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.banco_conciliaciones DROP CONSTRAINT IF EXISTS conciliacion_movimiento_unico;
ALTER TABLE public.banco_conciliaciones DROP CONSTRAINT IF EXISTS conciliacion_factura_unica;

-- La misma pareja no se repite.
CREATE UNIQUE INDEX IF NOT EXISTS conciliacion_par_factura
  ON public.banco_conciliaciones (movimiento_id, factura_id) WHERE factura_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conciliacion_par_compra
  ON public.banco_conciliaciones (movimiento_id, compra_id) WHERE compra_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conciliacion_par_textil
  ON public.banco_conciliaciones (movimiento_id, textil_factura_id)
  WHERE textil_factura_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conciliacion_por_movimiento ON public.banco_conciliaciones (movimiento_id);
CREATE INDEX IF NOT EXISTS conciliacion_por_factura ON public.banco_conciliaciones (factura_id);
CREATE INDEX IF NOT EXISTS conciliacion_por_compra ON public.banco_conciliaciones (compra_id);
CREATE INDEX IF NOT EXISTS conciliacion_por_textil ON public.banco_conciliaciones (textil_factura_id);
CREATE INDEX IF NOT EXISTS conciliacion_por_grupo ON public.banco_conciliaciones (grupo);

COMMENT ON TABLE public.banco_conciliaciones IS
  'Qué movimiento del banco paga qué documento. Las filas de un mismo enlace comparten grupo '
  '(1 movimiento ↔ N documentos o N movimientos ↔ 1 documento). Se escribe solo por funciones.';
COMMENT ON COLUMN public.banco_conciliaciones.estado IS
  'conciliada (verde) o revisar (ámbar: solo coincide importe y fecha, o suma de varios).';
COMMENT ON COLUMN public.banco_conciliaciones.importe IS
  'Lo que el documento espera ver en el banco, con signo: −líquido en compras, total en facturas.';
COMMENT ON COLUMN public.banco_conciliaciones.marco_pagada IS
  'Si al conciliar se marcó el documento como pagado: al deshacer se devuelve a pendiente.';

-- Deshacer pasa siempre por banco_desenlazar (devuelve el documento a pendiente).
DROP POLICY IF EXISTS "conciliaciones baja" ON public.banco_conciliaciones;
REVOKE INSERT, UPDATE, DELETE ON public.banco_conciliaciones FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Traspasos entre cuentas propias
-- ---------------------------------------------------------------------------
ALTER TABLE public.banco_movimientos
  ADD COLUMN IF NOT EXISTS traspaso_con UUID REFERENCES public.banco_movimientos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.banco_movimientos.traspaso_con IS
  'El movimiento espejo en otra cuenta propia: es un traspaso, no paga nada.';

-- ---------------------------------------------------------------------------
-- 3. Efectos de un enlace conciliado: marcar pagado lo que estaba pendiente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_aplicar_efectos(_usuario_id UUID, _grupo UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fecha DATE;
  r RECORD;
BEGIN
  SELECT max(m.fecha) INTO v_fecha
    FROM public.banco_conciliaciones c JOIN public.banco_movimientos m ON m.id = c.movimiento_id
   WHERE c.grupo = _grupo;

  FOR r IN SELECT DISTINCT compra_id FROM public.banco_conciliaciones
            WHERE grupo = _grupo AND compra_id IS NOT NULL LOOP
    UPDATE public.textil_compras SET estado_pago = 'pagada', fecha_pago = v_fecha
     WHERE id = r.compra_id AND estado_pago = 'pendiente';
    UPDATE public.banco_conciliaciones SET marco_pagada = FOUND
     WHERE grupo = _grupo AND compra_id = r.compra_id;
  END LOOP;

  FOR r IN SELECT DISTINCT c.factura_id, f.estado
             FROM public.banco_conciliaciones c JOIN public.facturas f ON f.id = c.factura_id
            WHERE c.grupo = _grupo LOOP
    IF r.estado IN ('emitida', 'vencida') THEN
      PERFORM public.factura_cambiar_estado_cobro(_usuario_id, r.factura_id, 'pagada');
    END IF;
    UPDATE public.banco_conciliaciones SET marco_pagada = r.estado IN ('emitida', 'vencida')
     WHERE grupo = _grupo AND factura_id = r.factura_id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_aplicar_efectos(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Enlazar
-- ---------------------------------------------------------------------------
-- _documentos: [{"tipo": "compra" | "factura" | "textil", "id": "…"}]
CREATE OR REPLACE FUNCTION public.banco_enlazar_como(
  _usuario_id UUID,
  _movimientos UUID[],
  _documentos JSONB,
  _estado TEXT,
  _motivo TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.banco_enlazar_como(UUID, UUID[], JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.banco_enlazar(
  _movimientos UUID[],
  _documentos JSONB,
  _estado TEXT DEFAULT 'conciliada',
  _motivo TEXT DEFAULT 'manual'
)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.banco_enlazar_como(auth.uid(), _movimientos, _documentos, _estado, _motivo);
$$;

COMMENT ON FUNCTION public.banco_enlazar(UUID[], JSONB, TEXT, TEXT) IS
  'Enlaza movimientos con documentos (1↔N o N↔1). En conciliada marca pagado lo pendiente; en '
  'revisar no toca nada. Falla si algo ya estaba conciliado, es un traspaso o el signo no casa.';
REVOKE EXECUTE ON FUNCTION public.banco_enlazar(UUID[], JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_enlazar(UUID[], JSONB, TEXT, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Confirmar un ámbar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_confirmar(_grupo UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_usuario UUID := auth.uid();
  v_empresa UUID;
  v_n INT;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.banco_confirmar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_confirmar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Deshacer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_desenlazar_como(_usuario_id UUID, _grupo UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  r RECORD;
  v_n INT;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.banco_desenlazar_como(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.banco_desenlazar(_grupo UUID)
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.banco_desenlazar_como(auth.uid(), _grupo);
$$;

COMMENT ON FUNCTION public.banco_desenlazar(UUID) IS
  'Deshace un enlace entero y devuelve a pendiente lo que él marcó como pagado.';
REVOKE EXECUTE ON FUNCTION public.banco_desenlazar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_desenlazar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Las dos de antes, por el mismo camino
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_conciliar(
  _usuario_id UUID,
  _movimiento_id UUID,
  _factura_id UUID,
  _motivo TEXT DEFAULT 'importe'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grupo UUID;
  v_id UUID;
BEGIN
  v_grupo := public.banco_enlazar_como(
    _usuario_id, ARRAY[_movimiento_id],
    jsonb_build_array(jsonb_build_object('tipo', 'factura', 'id', _factura_id)),
    'conciliada', _motivo);
  SELECT id INTO v_id FROM public.banco_conciliaciones WHERE grupo = v_grupo;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id UUID, _movimiento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grupo UUID;
BEGIN
  SELECT grupo INTO v_grupo FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id LIMIT 1;
  IF v_grupo IS NULL THEN RETURN false; END IF;
  RETURN public.banco_desenlazar_como(_usuario_id, v_grupo) > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Traspasos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_marcar_traspaso(_a UUID, _b UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_usuario UUID := auth.uid();
  a RECORD;
  b RECORD;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.banco_marcar_traspaso(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_marcar_traspaso(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.banco_desmarcar_traspaso(_movimiento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_usuario UUID := auth.uid();
  m RECORD;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.banco_desmarcar_traspaso(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_desmarcar_traspaso(UUID) TO authenticated, service_role;
