-- ============================================================================
-- REVERSIÓN de 20261028100200_escaner_textil_reglas.sql
-- ============================================================================
-- La primera de las tres reversiones del escáner textil (después, la de
-- 20261028100100 y la de 20261028100000). Solo con autorización expresa de
-- Javier.
--
-- Quita escaner_textil_version(), textil_compra_guardar_y_registrar(),
-- textil_stock_fusionar(), el producto automático, la cabecera inmutable de
-- las compras registradas, el coste congelado de las líneas de presupuesto y
-- pedido, el freno a las entradas «compra» a mano, los índices
-- textil_stock_variante_unica y textil_stock_ean_unico, el NOT NULL de
-- producto_id y las tres CHECK de las entradas por compra.
--
-- Quita también el freno a dar de alta una variante con existencias
-- (stock_alta_sin_existencias). Repone, copiadas tal cual,
-- stock_aplicar_movimiento(), stock_cantidad_solo_por_movimiento() y
-- textil_stock_retirar() de 20260903200000_stock_movimientos.sql y
-- textil_compra_registrar(uuid) de 20261013100000_compras_generales.sql.
--
-- No toca ninguna fila. Lo que se pierde es la protección: las compras
-- registradas vuelven a poder cambiarse por la cabecera y el coste medio a
-- poder escribirse a mano.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.escaner_textil_version();
DROP FUNCTION IF EXISTS public.textil_compra_guardar_y_registrar(JSONB, UUID);
DROP FUNCTION IF EXISTS public.textil_stock_fusionar(UUID, UUID, UUID);

DROP TRIGGER IF EXISTS textil_stock_producto_auto ON public.textil_stock;
DROP FUNCTION IF EXISTS public.textil_stock_producto_auto();

DROP TRIGGER IF EXISTS textil_compras_registrada_inmutable ON public.textil_compras;
DROP TRIGGER IF EXISTS textil_compras_registrada_no_se_borra ON public.textil_compras;
DROP FUNCTION IF EXISTS public.compra_registrada_cabecera();

DROP TRIGGER IF EXISTS textil_presupuesto_items_coste_congelado ON public.textil_presupuesto_items;
DROP TRIGGER IF EXISTS textil_pedido_items_coste_congelado ON public.textil_pedido_items;
DROP FUNCTION IF EXISTS public.textil_item_coste_congelado();

DROP TRIGGER IF EXISTS textil_stock_mov_compra_solo_registro ON public.textil_stock_movimientos;
DROP FUNCTION IF EXISTS public.stock_compra_solo_por_registro();

DROP TRIGGER IF EXISTS textil_stock_alta_sin_existencias ON public.textil_stock;
DROP FUNCTION IF EXISTS public.stock_alta_sin_existencias();

DROP INDEX IF EXISTS public.textil_stock_variante_unica;
DROP INDEX IF EXISTS public.textil_stock_ean_unico;

ALTER TABLE public.textil_stock ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE public.textil_stock_movimientos
  DROP CONSTRAINT IF EXISTS stock_compra_con_factura,
  DROP CONSTRAINT IF EXISTS stock_linea_solo_compra,
  DROP CONSTRAINT IF EXISTS stock_compra_id_motivo;

-- ---------------------------------------------------------------------------
-- Copiadas tal cual de 20260903200000_stock_movimientos.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Copiada tal cual de 20261013100000_compras_generales.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_compra_registrar(_compra_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_compra RECORD;
  v_sin_casar INT;
  r RECORD;
  v_n INT := 0;
BEGIN
  SELECT * INTO v_compra FROM public.textil_compras WHERE id = _compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La compra no existe';
  END IF;
  IF v_compra.estado = 'registrada' THEN
    RAISE EXCEPTION 'La compra % ya estaba registrada', COALESCE(v_compra.numero, '(sin número)')
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_compra.categoria = 'textil' THEN
    SELECT count(*) INTO v_sin_casar
      FROM public.textil_compra_lineas WHERE compra_id = _compra_id AND stock_id IS NULL;
    IF v_sin_casar > 0 THEN
      RAISE EXCEPTION
        'Hay % línea(s) sin asignar a una variante del catálogo. Asígnalas o '
        'bórralas antes de registrar.', v_sin_casar
        USING ERRCODE = 'restrict_violation';
    END IF;

    FOR r IN
      SELECT stock_id, cantidad, precio_unitario
        FROM public.textil_compra_lineas WHERE compra_id = _compra_id ORDER BY orden
    LOOP
      INSERT INTO public.textil_stock_movimientos
        (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
      VALUES (v_compra.empresa_id, r.stock_id, 'compra', r.cantidad, r.precio_unitario,
              'Compra ' || COALESCE(v_compra.numero, '(sin número)') ||
              COALESCE(' de ' || v_compra.proveedor, ''));
      v_n := v_n + 1;
    END LOOP;
  END IF;

  UPDATE public.textil_compras SET estado = 'registrada' WHERE id = _compra_id;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.textil_compra_registrar(UUID) IS
  'Registra una compra. Si es de textil, convierte sus líneas en entradas de stock al coste de '
  'la factura y falla si alguna no está casada con una variante. Falla si la compra ya estaba '
  'registrada: la misma factura no entra dos veces.';

REVOKE EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
