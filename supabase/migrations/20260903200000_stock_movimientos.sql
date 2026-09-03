-- ============================================================================
-- STOCK TEXTIL · Un libro de movimientos, no un contador
-- ============================================================================
--
-- EL PROBLEMA
--   textil_stock.cantidad se actualizaba leyendo, restando y escribiendo:
--
--     const nueva = Number(data.cantidad) - cant;
--     .update({ cantidad: nueva })
--
--   Dos pedidos simultáneos leen el mismo número y ambos escriben: uno de los
--   dos descuentos se pierde y nada avisa. Es la carrera clásica de contador
--   mutable.
--
--   Y aunque no hubiera carrera, un número que se sobrescribe no se puede
--   defender. El día que cuentes 7 camisetas y el sistema diga 9, querrás saber
--   POR QUÉ, no solo CUÁNTO. Con un contador esa pregunta no tiene respuesta.
--
-- CÓMO QUEDA
--   Cada entrada, salida o ajuste es una fila inmutable con su fecha, su motivo
--   y su documento. El stock es la suma. textil_stock.cantidad se conserva como
--   caché para que las pantallas sigan siendo rápidas, pero la mantiene un
--   trigger y NADIE la escribe a mano: hay un trigger que lo impide.
--
--   Es la misma idea que la auditoría, y por la misma razón.
--
-- COSTE MEDIO PONDERADO
--   Cada entrada recalcula el coste medio de la variante. Cada salida se lleva
--   el coste del momento congelado en el movimiento. Sin esto sabes tu precio,
--   pero no tu margen.
--
-- REVERSIBLE
--   Sí. Añade una tabla y triggers. El stock actual se traslada como un
--   movimiento 'inicial', sin perder nada.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.stock_motivo AS ENUM (
    'inicial',            -- el saldo que había al montar el libro
    'compra',             -- entrada por factura de proveedor
    'venta',              -- salida por pedido
    'devolucion_cliente', -- entrada: vuelve del cliente
    'devolucion_proveedor',
    'ajuste_inventario',  -- recuento físico
    'merma'               -- rotura, pérdida, regalo
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.textil_stock_movimientos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  stock_id UUID NOT NULL REFERENCES public.textil_stock(id) ON DELETE CASCADE,
  motivo public.stock_motivo NOT NULL,
  -- Con signo: positivo entra, negativo sale. Sumar la columna da el stock.
  cantidad NUMERIC NOT NULL,
  -- Coste unitario de esta entrada, o el coste medio congelado en esta salida.
  coste_unitario NUMERIC NOT NULL DEFAULT 0,
  -- De dónde viene, si viene de algo.
  textil_pedido_id UUID REFERENCES public.textil_pedidos(id) ON DELETE SET NULL,
  nota TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_movimiento_no_cero CHECK (cantidad <> 0),
  CONSTRAINT stock_movimiento_signo CHECK (
    (motivo IN ('compra', 'devolucion_cliente', 'inicial') AND cantidad > 0)
    OR (motivo IN ('venta', 'devolucion_proveedor', 'merma') AND cantidad < 0)
    OR motivo = 'ajuste_inventario'   -- el recuento puede ir en los dos sentidos
  )
);

COMMENT ON TABLE public.textil_stock_movimientos IS
  'Libro de stock. Inmutable: el saldo es la suma de esta tabla. '
  'textil_stock.cantidad es solo una caché que mantiene un trigger.';
COMMENT ON COLUMN public.textil_stock_movimientos.cantidad IS
  'Con signo. Positivo entra, negativo sale.';

CREATE INDEX IF NOT EXISTS textil_stock_mov_por_variante
  ON public.textil_stock_movimientos (stock_id, created_at DESC);

-- Un movimiento no se edita ni se borra: eso es lo que lo hace un libro.
CREATE OR REPLACE FUNCTION public.stock_movimiento_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION
    'Un movimiento de stock no se modifica ni se borra. Para corregir, anota un '
    'ajuste de inventario con su motivo.';
END;
$$;

DROP TRIGGER IF EXISTS textil_stock_mov_inmutable ON public.textil_stock_movimientos;
CREATE TRIGGER textil_stock_mov_inmutable
  BEFORE UPDATE OR DELETE ON public.textil_stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.stock_movimiento_inmutable();

-- ---------------------------------------------------------------------------
-- La caché y el coste medio, mantenidos por trigger
-- ---------------------------------------------------------------------------
-- Coste medio ponderado: cada entrada lo recalcula sobre el saldo anterior;
-- cada salida se lleva el coste vigente, congelado en el movimiento. Así el
-- margen de una venta es el de verdad, no el del precio de compra de hoy.
CREATE OR REPLACE FUNCTION public.stock_aplicar_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saldo NUMERIC;
  v_coste NUMERIC;
  v_nuevo_coste NUMERIC;
BEGIN
  SELECT cantidad, coste_unitario INTO v_saldo, v_coste
    FROM public.textil_stock WHERE id = NEW.stock_id
    FOR UPDATE;   -- serializa: sin esto vuelve la carrera que veníamos a quitar

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante de stock % no existe', NEW.stock_id;
  END IF;

  IF NEW.cantidad > 0 AND NEW.coste_unitario > 0 THEN
    -- Media ponderada. Con saldo negativo o cero, la entrada manda.
    IF v_saldo > 0 THEN
      v_nuevo_coste := (v_saldo * v_coste + NEW.cantidad * NEW.coste_unitario)
                       / (v_saldo + NEW.cantidad);
    ELSE
      v_nuevo_coste := NEW.coste_unitario;
    END IF;
  ELSE
    v_nuevo_coste := v_coste;
    -- La salida congela el coste vigente: es lo que hace calculable el margen.
    IF NEW.cantidad < 0 AND NEW.coste_unitario = 0 THEN
      NEW.coste_unitario := v_coste;
    END IF;
  END IF;

  -- La caché la escribe este trigger y solo este trigger. La bandera se la
  -- enseña al guardián de más abajo.
  PERFORM set_config('app.stock_via_movimiento', '1', true);
  UPDATE public.textil_stock
     SET cantidad = v_saldo + NEW.cantidad,
         coste_unitario = round(v_nuevo_coste, 4),
         updated_at = now()
   WHERE id = NEW.stock_id;
  PERFORM set_config('app.stock_via_movimiento', '', true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_stock_mov_aplicar ON public.textil_stock_movimientos;
CREATE TRIGGER textil_stock_mov_aplicar
  BEFORE INSERT ON public.textil_stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.stock_aplicar_movimiento();

-- ---------------------------------------------------------------------------
-- Nadie toca la caché a mano
-- ---------------------------------------------------------------------------
-- Sin esto, la tabla de movimientos sería decorativa: bastaría un UPDATE
-- directo sobre textil_stock para descuadrar el libro sin dejar rastro.
CREATE OR REPLACE FUNCTION public.stock_cantidad_solo_por_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cantidad IS DISTINCT FROM OLD.cantidad
     AND COALESCE(current_setting('app.stock_via_movimiento', true), '') <> '1' THEN
    RAISE EXCEPTION
      'La cantidad de stock no se escribe directamente. Anota un movimiento en '
      'textil_stock_movimientos: una entrada, una salida o un ajuste de inventario.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_stock_cantidad_guardian ON public.textil_stock;
CREATE TRIGGER textil_stock_cantidad_guardian
  BEFORE UPDATE ON public.textil_stock
  FOR EACH ROW EXECUTE FUNCTION public.stock_cantidad_solo_por_movimiento();

-- ---------------------------------------------------------------------------
-- Comprobación: la caché tiene que cuadrar con el libro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_descuadres()
RETURNS TABLE (stock_id UUID, nombre TEXT, cache NUMERIC, libro NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.nombre, s.cantidad,
         COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                    WHERE m.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad IS DISTINCT FROM
        COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                   WHERE m.stock_id = s.id), 0);
$$;

COMMENT ON FUNCTION public.stock_descuadres() IS
  'Variantes cuya caché no coincide con la suma de sus movimientos. Sin filas, '
  'el stock cuadra.';

REVOKE EXECUTE ON FUNCTION public.stock_descuadres() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_descuadres() TO authenticated;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.textil_stock_movimientos TO authenticated;
GRANT SELECT, INSERT ON public.textil_stock_movimientos TO service_role;

ALTER TABLE public.textil_stock_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "movimientos lectura autenticados" ON public.textil_stock_movimientos;
CREATE POLICY "movimientos lectura autenticados" ON public.textil_stock_movimientos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "movimientos alta autenticados" ON public.textil_stock_movimientos;
CREATE POLICY "movimientos alta autenticados" ON public.textil_stock_movimientos
  FOR INSERT TO authenticated WITH CHECK (true);

-- Sin políticas de UPDATE ni DELETE: el trigger ya lo impide, pero que tampoco
-- exista el permiso lo deja dicho dos veces.

DROP TRIGGER IF EXISTS textil_stock_mov_auditoria ON public.textil_stock_movimientos;
CREATE TRIGGER textil_stock_mov_auditoria
  AFTER INSERT ON public.textil_stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- Trasladar el stock que ya hay
-- ---------------------------------------------------------------------------
-- El saldo actual pasa a ser un movimiento 'inicial'. No se pierde nada y a
-- partir de aquí todo cuadra.
DO $traslado$
DECLARE
  v_empresa UUID;
  r RECORD;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa ORDER BY created_at LIMIT 1;
  IF v_empresa IS NULL THEN
    RAISE NOTICE 'No hay empresa activa: no se traslada stock.';
    RETURN;
  END IF;

  FOR r IN
    SELECT s.id, s.cantidad, s.coste_unitario
    FROM public.textil_stock s
    WHERE s.cantidad <> 0
      AND NOT EXISTS (SELECT 1 FROM public.textil_stock_movimientos m WHERE m.stock_id = s.id)
  LOOP
    -- La caché ya vale lo que toca, así que se pone a cero antes para que el
    -- trigger la deje exactamente donde estaba.
    PERFORM set_config('app.stock_via_movimiento', '1', true);
    UPDATE public.textil_stock SET cantidad = 0 WHERE id = r.id;
    PERFORM set_config('app.stock_via_movimiento', '', true);

    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
    VALUES (v_empresa, r.id, 'inicial', r.cantidad, r.coste_unitario,
            'Saldo existente al montar el libro de movimientos');
  END LOOP;
END
$traslado$;

-- ---------------------------------------------------------------------------
-- Borrar una variante: solo si nunca se movió
-- ---------------------------------------------------------------------------
-- Una variante con movimientos no puede desaparecer: sus entradas y salidas
-- son la historia de coste de lo que ya vendiste. Borrarla dejaría el libro
-- cojo y el margen de esas ventas sin explicación.
--
-- Pero una variante que se creó por error y nunca se usó no tiene por qué
-- quedarse ahí molestando. Así que: se borra si nunca se movió, y si se movió
-- se desactiva. La función dice cuál de las dos cosas hizo, para que la
-- pantalla pueda explicárselo a quien pulsó.
ALTER TABLE public.textil_stock
  ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.textil_stock.activa IS
  'A false no aparece para vender, pero conserva su historia de movimientos.';

CREATE OR REPLACE FUNCTION public.textil_stock_retirar(_stock_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_movimientos INT;
BEGIN
  SELECT count(*) INTO v_movimientos
    FROM public.textil_stock_movimientos WHERE stock_id = _stock_id;

  IF v_movimientos = 0 THEN
    DELETE FROM public.textil_stock WHERE id = _stock_id;
    RETURN 'borrada';
  END IF;

  UPDATE public.textil_stock SET activa = false, updated_at = now() WHERE id = _stock_id;
  RETURN 'desactivada';
END;
$$;

COMMENT ON FUNCTION public.textil_stock_retirar(UUID) IS
  'Borra la variante si nunca tuvo movimientos; si los tuvo, la desactiva. '
  'Devuelve "borrada" o "desactivada" para que la pantalla lo explique.';

REVOKE EXECUTE ON FUNCTION public.textil_stock_retirar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_stock_retirar(UUID) TO authenticated, service_role;
