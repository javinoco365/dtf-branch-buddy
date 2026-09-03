-- ============================================================================
-- CONCILIACIÓN BANCARIA · Casar el extracto con las facturas
-- ============================================================================
--
-- QUÉ RESUELVE
--   Marcar facturas como cobradas a mano, mirando el banco en otra pestaña. Con
--   pocas facturas se hace; con cien al mes, se dejan de marcar y la pantalla de
--   cobros pendientes deja de servir para nada.
--
-- CÓMO FUNCIONA
--   Se sube el Excel del banco, cada línea entra como movimiento, y la
--   aplicación propone a qué factura corresponde cada ingreso. Se revisa y se
--   aplica. Al aplicar, la factura pasa a 'pagada' por la función de siempre.
--
-- LO QUE NO SE TOCA
--   El importe, las líneas y el número de una factura emitida siguen siendo
--   inmutables. Aquí solo se cambia el ESTADO DE COBRO, que es lo único que
--   factura_inmutable() deja cambiar, y se hace llamando a
--   factura_cambiar_estado_cobro() en vez de escribiendo el estado a pelo.
--
-- IMPORTAR DOS VECES EL MISMO MES
--   Pasa constantemente: se descarga el extracto el día 20 y otra vez el 31, y
--   los veinte primeros días vienen repetidos. La huella (fecha + concepto +
--   importe) los detecta y no los duplica.
--
-- REVERSIBLE
--   Sí. Dos tablas nuevas y dos funciones. No toca nada existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.banco_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  concepto TEXT NOT NULL DEFAULT '',
  importe NUMERIC(12,2) NOT NULL,
  -- fecha + concepto normalizado + importe. Es lo único que identifica una
  -- línea de extracto: el banco no da un identificador por movimiento.
  huella TEXT NOT NULL,
  origen TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT banco_movimiento_no_cero CHECK (importe <> 0),
  CONSTRAINT banco_movimiento_unico UNIQUE (empresa_id, huella)
);

COMMENT ON TABLE public.banco_movimientos IS
  'Líneas del extracto bancario. La huella impide que reimportar un periodo '
  'solapado duplique movimientos.';

CREATE INDEX IF NOT EXISTS banco_movimientos_por_fecha
  ON public.banco_movimientos (fecha DESC);

-- ---------------------------------------------------------------------------
-- El enlace entre un ingreso y la factura que paga
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.banco_conciliaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT y no CASCADE: si borrar el movimiento se llevara el enlace por
  -- delante, la factura se quedaría marcada como pagada sin nada que lo
  -- respalde. Para borrarlo hay que deshacer la conciliación antes, que es lo
  -- que devuelve la factura a 'emitida'.
  movimiento_id UUID NOT NULL REFERENCES public.banco_movimientos(id) ON DELETE RESTRICT,
  factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  -- Por qué se casaron: referencia, cliente_e_importe o importe. Sirve para
  -- saber después cuáles se aceptaron a ojo y cuáles no admitían duda.
  motivo TEXT NOT NULL,
  diferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
  conciliado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un ingreso paga una factura y una factura se cobra una vez. Sin esto, dos
  -- clics seguidos dejarían la misma factura cobrada dos veces.
  CONSTRAINT conciliacion_movimiento_unico UNIQUE (movimiento_id),
  CONSTRAINT conciliacion_factura_unica UNIQUE (factura_id)
);

COMMENT ON TABLE public.banco_conciliaciones IS
  'Qué ingreso paga qué factura. Uno a uno por construcción.';

-- ---------------------------------------------------------------------------
-- Conciliar
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
  v_mov RECORD;
  v_fac RECORD;
  v_id UUID;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = _movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El movimiento no existe'; END IF;

  SELECT * INTO v_fac FROM public.facturas WHERE id = _factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;

  IF v_fac.estado = 'borrador' THEN
    RAISE EXCEPTION 'La factura todavía es un borrador: emítela antes de darla por cobrada.';
  END IF;
  IF v_mov.importe <= 0 THEN
    RAISE EXCEPTION 'Un cargo no paga una factura.';
  END IF;

  INSERT INTO public.banco_conciliaciones
    (movimiento_id, factura_id, motivo, diferencia, conciliado_por)
  VALUES (_movimiento_id, _factura_id, _motivo,
          round(v_mov.importe - v_fac.total, 2), _usuario_id)
  RETURNING id INTO v_id;

  -- Por la función de siempre, no escribiendo el estado a pelo: es la que sabe
  -- qué estados de cobro son legítimos y deja el cambio auditado.
  PERFORM public.factura_cambiar_estado_cobro(_usuario_id, _factura_id, 'pagada');

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.banco_conciliar(UUID, UUID, UUID, TEXT) IS
  'Enlaza un ingreso con la factura que paga y la marca como pagada. Falla si '
  'el movimiento o la factura ya estaban conciliados.';

REVOKE EXECUTE ON FUNCTION public.banco_conciliar(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_conciliar(UUID, UUID, UUID, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Deshacer
-- ---------------------------------------------------------------------------
-- Casar mal es fácil y no es grave mientras se pueda deshacer. La factura
-- vuelve a 'emitida', que es un estado de cobro y por tanto reversible; el
-- documento fiscal no se ha tocado en ningún momento.
CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id UUID, _movimiento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_factura UUID;
BEGIN
  DELETE FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id
   RETURNING factura_id INTO v_factura;

  IF v_factura IS NULL THEN RETURN false; END IF;

  PERFORM public.factura_cambiar_estado_cobro(_usuario_id, v_factura, 'emitida');
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_desconciliar(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_desconciliar(UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banco_movimientos TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.banco_conciliaciones TO authenticated;
GRANT ALL ON public.banco_movimientos TO service_role;
GRANT ALL ON public.banco_conciliaciones TO service_role;

ALTER TABLE public.banco_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banco_conciliaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banco lectura" ON public.banco_movimientos;
CREATE POLICY "banco lectura" ON public.banco_movimientos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "banco alta" ON public.banco_movimientos;
CREATE POLICY "banco alta" ON public.banco_movimientos
  FOR INSERT TO authenticated WITH CHECK (true);

-- Un movimiento del banco es lo que dice el banco: no se edita. Se puede
-- borrar uno importado por error, y solo si no está conciliado.
DROP POLICY IF EXISTS "banco baja" ON public.banco_movimientos;
CREATE POLICY "banco baja" ON public.banco_movimientos
  FOR DELETE TO authenticated
  USING (NOT EXISTS (
    SELECT 1 FROM public.banco_conciliaciones c WHERE c.movimiento_id = banco_movimientos.id
  ));

DROP POLICY IF EXISTS "conciliaciones lectura" ON public.banco_conciliaciones;
CREATE POLICY "conciliaciones lectura" ON public.banco_conciliaciones
  FOR SELECT TO authenticated USING (true);

-- Se crean y se deshacen por las funciones de arriba, que son las que además
-- cambian el estado de cobro. Sin política de INSERT directo a propósito:
-- enlazar sin marcar la factura dejaría las dos cosas contando historias
-- distintas.
DROP POLICY IF EXISTS "conciliaciones baja" ON public.banco_conciliaciones;
CREATE POLICY "conciliaciones baja" ON public.banco_conciliaciones
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS banco_movimientos_auditoria ON public.banco_movimientos;
CREATE TRIGGER banco_movimientos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.banco_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS banco_conciliaciones_auditoria ON public.banco_conciliaciones;
CREATE TRIGGER banco_conciliaciones_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.banco_conciliaciones
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
