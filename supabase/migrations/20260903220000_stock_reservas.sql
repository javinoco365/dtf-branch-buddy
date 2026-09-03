-- ============================================================================
-- STOCK TEXTIL · Reservas: separar lo que hay de lo que puedes prometer
-- ============================================================================
--
-- EL PROBLEMA
--   Un pedido descontaba el stock al crearse. Pero un pedido creado no es
--   mercancía que haya salido: las camisetas siguen en la estantería hasta que
--   se entregan.
--
--   Con 20 camisetas y un pedido de 15, la pantalla decía 5. Si entraba otro
--   cliente pidiendo 8, le decías que no. Y sí podías: las 15 están ahí, solo
--   que comprometidas.
--
--   Peor todavía es el recuento: cuentas 20 en el armario, el sistema dice 5, y
--   parece que te sobran 15 de la nada. Un inventario físico solo puede cuadrar
--   contra lo FÍSICO.
--
-- CÓMO QUEDA
--   Tres números en vez de uno:
--
--     físico      lo que hay si vas y lo cuentas. Solo cambia cuando entra o
--                 sale mercancía de verdad.
--     reservado   lo comprometido en pedidos sin entregar.
--     disponible  físico - reservado. Lo que puedes prometer. Se calcula.
--
--   Una reserva NO es un movimiento de stock: es un compromiso. Por eso vive en
--   su propia tabla y no ensucia el libro. El movimiento de 'venta' se anota al
--   ENTREGAR, que es cuando la mercancía sale de verdad.
--
--   Crear pedido  -> reserva.                      El físico no se toca.
--   Entregar      -> se cierra la reserva y se anota la venta.
--   Cancelar      -> la reserva desaparece. No ha pasado nada.
--
-- REVERSIBLE
--   Sí. Añade una tabla, una columna caché y triggers.
-- ============================================================================

ALTER TABLE public.textil_stock
  ADD COLUMN IF NOT EXISTS cantidad_reservada NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.textil_stock.cantidad IS
  'Existencias FÍSICAS: lo que hay si vas y lo cuentas. Caché de la suma de '
  'textil_stock_movimientos.';
COMMENT ON COLUMN public.textil_stock.cantidad_reservada IS
  'Comprometido en pedidos sin entregar. Caché de textil_stock_reservas. '
  'Disponible para prometer = cantidad - cantidad_reservada.';

CREATE TABLE IF NOT EXISTS public.textil_stock_reservas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  stock_id UUID NOT NULL REFERENCES public.textil_stock(id) ON DELETE CASCADE,
  textil_pedido_id UUID NOT NULL REFERENCES public.textil_pedidos(id) ON DELETE CASCADE,
  cantidad NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reserva_positiva CHECK (cantidad > 0),
  -- Una fila por pedido y variante: editar el pedido actualiza, no acumula.
  UNIQUE (textil_pedido_id, stock_id)
);

COMMENT ON TABLE public.textil_stock_reservas IS
  'Lo comprometido en pedidos sin entregar. No es un movimiento de stock: la '
  'mercancía sigue en la estantería. La venta se anota al entregar.';

CREATE INDEX IF NOT EXISTS textil_reservas_por_variante
  ON public.textil_stock_reservas (stock_id);

DROP TRIGGER IF EXISTS textil_reservas_touch ON public.textil_stock_reservas;
CREATE TRIGGER textil_reservas_touch
  BEFORE UPDATE ON public.textil_stock_reservas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- La caché de reservado, mantenida por trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_recalcular_reservado()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock UUID := COALESCE(NEW.stock_id, OLD.stock_id);
BEGIN
  UPDATE public.textil_stock s
     SET cantidad_reservada = COALESCE((
           SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
            WHERE r.stock_id = v_stock), 0)
   WHERE s.id = v_stock;

  -- Al mover una reserva de variante, hay que recalcular también la de origen.
  IF TG_OP = 'UPDATE' AND NEW.stock_id IS DISTINCT FROM OLD.stock_id THEN
    UPDATE public.textil_stock s
       SET cantidad_reservada = COALESCE((
             SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
              WHERE r.stock_id = OLD.stock_id), 0)
     WHERE s.id = OLD.stock_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS textil_reservas_recalcular ON public.textil_stock_reservas;
CREATE TRIGGER textil_reservas_recalcular
  AFTER INSERT OR UPDATE OR DELETE ON public.textil_stock_reservas
  FOR EACH ROW EXECUTE FUNCTION public.stock_recalcular_reservado();

-- ---------------------------------------------------------------------------
-- Entregar: la reserva se convierte en venta
-- ---------------------------------------------------------------------------
-- Es el momento en que la mercancía sale de verdad, y por tanto el único en
-- que toca anotar el movimiento. Antes de esto, el físico no se toca.
CREATE OR REPLACE FUNCTION public.textil_pedido_entregar(_pedido_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_n INT := 0;
BEGIN
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
$$;

COMMENT ON FUNCTION public.textil_pedido_entregar(UUID) IS
  'Convierte las reservas de un pedido en salidas de stock. Devuelve cuántas '
  'líneas movió. Idempotente por construcción: sin reservas no mueve nada.';

REVOKE EXECUTE ON FUNCTION public.textil_pedido_entregar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_pedido_entregar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_reservas_descuadres()
RETURNS TABLE (stock_id UUID, nombre TEXT, cache NUMERIC, reservas NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.nombre, s.cantidad_reservada,
         COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                    WHERE r.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad_reservada IS DISTINCT FROM
        COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                   WHERE r.stock_id = s.id), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.stock_reservas_descuadres() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_reservas_descuadres() TO authenticated;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_stock_reservas TO authenticated;
GRANT ALL ON public.textil_stock_reservas TO service_role;

ALTER TABLE public.textil_stock_reservas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservas lectura" ON public.textil_stock_reservas;
CREATE POLICY "reservas lectura" ON public.textil_stock_reservas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "reservas alta" ON public.textil_stock_reservas;
CREATE POLICY "reservas alta" ON public.textil_stock_reservas
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "reservas edicion" ON public.textil_stock_reservas;
CREATE POLICY "reservas edicion" ON public.textil_stock_reservas
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Una reserva sí se borra: al cancelar o entregar el pedido deja de existir el
-- compromiso. No es un asiento contable, es una intención.
DROP POLICY IF EXISTS "reservas baja" ON public.textil_stock_reservas;
CREATE POLICY "reservas baja" ON public.textil_stock_reservas
  FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS textil_reservas_auditoria ON public.textil_stock_reservas;
CREATE TRIGGER textil_reservas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.textil_stock_reservas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
