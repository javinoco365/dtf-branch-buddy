-- ============================================================================
-- REPONER · Borrado de tiendas y conciliación bancaria
-- ============================================================================
--
-- POR QUÉ
--   En producción faltan banco_conciliar, banco_desconciliar y
--   tienda_resumen_borrado. Son de tres migraciones de septiembre que no
--   llegaron a aplicarse enteras:
--
--     20260903240000_borrar_con_cabeza       freno y resumen del borrado de tiendas
--     20260903280000_conciliacion_bancaria   extracto y conciliación
--     20260905140000_retirar_proyectos       resumen sin proyectos (+ DROP TABLE)
--
--   Sin ellas, la pantalla de Conciliación no puede casar ni deshacer, borrar
--   una tienda falla antes de preguntar y —lo grave— no hay trigger que impida
--   borrar una tienda con facturas emitidas.
--
-- POR QUÉ NO VOLVER A EJECUTAR AQUELLAS TRES
--   - borrar_con_cabeza redefine tienda_borrado_permitido() con la versión de
--     septiembre, que no mira los cobros. La de la fase 2 (20260929100000) sí:
--     reaplicarla la pisaría. Aquí solo se crea el trigger, con la función que
--     ya hay.
--   - retirar_proyectos hace DROP TABLE proyectos. Borrar datos se pregunta
--     aparte; esta migración no lo hace. El resumen, eso sí, ya no mira esa
--     tabla, exista o no.
--   - conciliacion_bancaria creaba banco_movimientos con ON DELETE CASCADE a
--     la empresa; 20260903340000 lo cambió después a RESTRICT. Aquí se deja
--     directamente como quedó.
--
-- SE PUEDE EJECUTAR AUNQUE PARTE YA EXISTA
--   Todo va con IF NOT EXISTS, CREATE OR REPLACE o DROP ... IF EXISTS antes
--   de crear. Los DROP son de políticas y triggers, no de datos.
--
-- REVERSIBLE
--   Sí. Una columna, dos tablas vacías, tres funciones, un trigger y políticas.
--   No borra ni modifica ninguna fila.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tiendas: desactivar en vez de borrar
-- ---------------------------------------------------------------------------
ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tiendas.activa IS
  'Una tienda desactivada no aparece en el menú ni sincroniza, pero sus '
  'facturas siguen colgando de ella. Es la salida para las que no se pueden '
  'borrar.';

-- El freno. La función es la de la fase 2 (facturas emitidas y cobros); solo
-- faltaba engancharla.
DROP TRIGGER IF EXISTS tiendas_borrado_permitido ON public.tiendas;
CREATE TRIGGER tiendas_borrado_permitido
  BEFORE DELETE ON public.tiendas
  FOR EACH ROW EXECUTE FUNCTION public.tienda_borrado_permitido();

-- Qué se lleva por delante. Es la versión de retirar_proyectos: sin proyectos.
CREATE OR REPLACE FUNCTION public.tienda_resumen_borrado(_tienda_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'nombre',            (SELECT nombre FROM public.tiendas WHERE id = _tienda_id),
    'facturas_emitidas', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado <> 'borrador'),
    'facturas_borrador', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado = 'borrador'),
    'pedidos',           (SELECT count(*) FROM public.pedidos WHERE tienda_id = _tienda_id),
    'clientes',          (SELECT count(*) FROM public.clientes WHERE tienda_id = _tienda_id),
    'productos',         (SELECT count(*) FROM public.productos WHERE tienda_id = _tienda_id)
  );
$$;

COMMENT ON FUNCTION public.tienda_resumen_borrado(UUID) IS
  'Lo que arrastraría borrar una tienda. Si facturas_emitidas > 0 no se puede '
  'borrar: hay que desactivarla.';

REVOKE EXECUTE ON FUNCTION public.tienda_resumen_borrado(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tienda_resumen_borrado(UUID) TO authenticated, service_role;

-- Políticas por operación en vez del FOR ALL original.
DROP POLICY IF EXISTS "tiendas admin write" ON public.tiendas;

DROP POLICY IF EXISTS "tiendas alta" ON public.tiendas;
CREATE POLICY "tiendas alta" ON public.tiendas
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tiendas edicion" ON public.tiendas;
CREATE POLICY "tiendas edicion" ON public.tiendas
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tiendas baja" ON public.tiendas;
CREATE POLICY "tiendas baja" ON public.tiendas
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Conciliación bancaria
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.banco_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  fecha DATE NOT NULL,
  concepto TEXT NOT NULL DEFAULT '',
  importe NUMERIC(12,2) NOT NULL,
  huella TEXT NOT NULL,
  origen TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT banco_movimientos_empresa_fk FOREIGN KEY (empresa_id)
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  CONSTRAINT banco_movimiento_no_cero CHECK (importe <> 0),
  CONSTRAINT banco_movimiento_unico UNIQUE (empresa_id, huella)
);

COMMENT ON TABLE public.banco_movimientos IS
  'Líneas del extracto bancario. La huella impide que reimportar un periodo '
  'solapado duplique movimientos.';

CREATE INDEX IF NOT EXISTS banco_movimientos_por_fecha
  ON public.banco_movimientos (fecha DESC);

CREATE TABLE IF NOT EXISTS public.banco_conciliaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id UUID NOT NULL REFERENCES public.banco_movimientos(id) ON DELETE RESTRICT,
  factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  diferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
  conciliado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conciliacion_movimiento_unico UNIQUE (movimiento_id),
  CONSTRAINT conciliacion_factura_unica UNIQUE (factura_id)
);

COMMENT ON TABLE public.banco_conciliaciones IS
  'Qué ingreso paga qué factura. Uno a uno por construcción.';

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

DROP POLICY IF EXISTS "banco baja" ON public.banco_movimientos;
CREATE POLICY "banco baja" ON public.banco_movimientos
  FOR DELETE TO authenticated
  USING (NOT EXISTS (
    SELECT 1 FROM public.banco_conciliaciones c WHERE c.movimiento_id = banco_movimientos.id
  ));

DROP POLICY IF EXISTS "conciliaciones lectura" ON public.banco_conciliaciones;
CREATE POLICY "conciliaciones lectura" ON public.banco_conciliaciones
  FOR SELECT TO authenticated USING (true);

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

-- Que la API vea las funciones nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
