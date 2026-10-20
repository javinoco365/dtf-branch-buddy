-- ============================================================================
-- ESCÁNER TEXTIL (3 de 3) · Reglas: que no se pierda nada
-- ============================================================================
--
-- QUÉ RESUELVE
--   Con el esquema (20261028100000) y los datos (20261028100100) en su sitio,
--   faltan las reglas que hacen que lo registrado no se pueda deshacer por un
--   lado ni descuadrar por otro:
--     - Una compra registrada podía cambiar de importes, de fecha o de
--       proveedor, volver a borrador o borrarse (la cabecera no estaba
--       protegida; solo las líneas). Y cualquiera con sesión podía ponerla
--       «registrada» con un UPDATE, sin que entrara su stock.
--     - Guardar y registrar eran dos llamadas: si la segunda fallaba, quedaba
--       la primera a medias.
--     - El coste medio de una variante se podía escribir a mano, sin rastro en
--       el libro de movimientos.
--     - Una devolución de cliente entraba a coste 0 (y una merma escrita a
--       mano, al coste que se escribiera): el valor del libro y el de la caché
--       se separaban sin explicación.
--     - Una entrada «compra» no estaba enlazada a su factura más que por la nota.
--
-- QUÉ CAMBIA, EN ESTE ORDEN
--   1. textil_stock_producto_auto: una variante dada de alta sin producto toma
--      (o crea) el producto de su nombre. Así el código viejo sigue
--      funcionando. Después, producto_id NOT NULL y los únicos:
--      textil_stock_variante_unica (producto, color, talla entre las activas no
--      repetidas) y textil_stock_ean_unico (EAN por empresa).
--   2. compra_registrada_cabecera(): una compra registrada no cambia proveedor,
--      NIF, número, fecha, importes, categoría, gasto (salvo a nulo, al borrar
--      el gasto fijo), lectura de la IA ni cuotas; no vuelve a borrador y no se
--      borra (las no textil admiten borrado lógico). proveedor_id, fichero_ruta
--      y fichero_huella solo pasan de nulo a un valor. Y solo pasa a
--      registrada dentro de las funciones de registro (SECURITY DEFINER), nunca
--      con un UPDATE de authenticated o anon.
--   3. stock_cantidad_solo_por_movimiento(): además de la cantidad, protege el
--      coste medio. Solo lo escribe el libro de movimientos. Y
--      stock_alta_sin_existencias(): una variante nace a 0 unidades y coste 0.
--      textil_stock_retirar() ya no desactiva una variante con existencias:
--      antes tienen que salir por el libro (merma, ajuste o fusión).
--   4. stock_aplicar_movimiento() nuevo: fecha contable del movimiento; la
--      devolución de cliente entra al coste al que salió en ese pedido (también
--      si la venta salió de una variante fusionada en esta); el ajuste al alza
--      sin coste entra al coste medio; una compra a coste 0 baja la media; y
--      TODA salida sale al coste medio vigente. La devolución de cliente
--      recalcula la media al coste resuelto (aunque sea 0). Y el trigger
--      textil_stock_mov_compra_solo_registro: las entradas «compra» solo las
--      anotan las funciones de registro.
--   5. Entradas por compra, siempre con su línea de factura (CHECK NOT VALID:
--      las antiguas se quedan como están).
--   6. textil_item_coste_congelado(): las líneas de presupuesto y pedido textil
--      congelan el coste medio de su variante al crearse (y conservan el nulo
--      al reescribirse, si la aplicación lo pide con -1).
--   7. textil_compra_guardar_y_registrar(): guarda y registra una compra (de
--      cualquier categoría) en una sola transacción. En textil valida el
--      reparto (Σ coste de entrada = base, al céntimo), crea las variantes
--      nuevas, aprende la memoria del escáner y anota las entradas enlazadas a
--      su línea. Si algo falla, no queda nada.
--   8. textil_compra_registrar() nueva: el camino viejo, ahora con control de
--      empresa, packs y enlace a la línea; rechaza las que tienen portes o
--      descuentos (eso es de la función anterior, que los reparte).
--   9. textil_stock_fusionar(): fusiona una variante repetida en la buena.
--  10. escaner_textil_version(): si existe, las tres migraciones están puestas.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261028100200_escaner_textil_reglas.sql (la
--   primera de las tres, en orden inverso). Repone las funciones de antes tal
--   cual. No toca datos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Producto automático, NOT NULL e índices únicos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_stock_producto_auto()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre TEXT := COALESCE(NULLIF(btrim(NEW.nombre), ''), '(sin nombre)');
  v_id UUID;
BEGIN
  IF NEW.producto_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_id FROM public.textil_productos
   WHERE empresa_id = NEW.empresa_id AND marca_clave = '' AND referencia_clave = ''
     AND nombre_clave = public.textil_clave(v_nombre);

  IF v_id IS NULL THEN
    INSERT INTO public.textil_productos (empresa_id, nombre, categoria, origen)
    VALUES (NEW.empresa_id, v_nombre, NEW.categoria, 'manual')
    ON CONFLICT (empresa_id, marca_clave, nombre_clave) WHERE referencia_clave = '' DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      -- Lo creó otra transacción a la vez: se vuelve a buscar.
      SELECT id INTO v_id FROM public.textil_productos
       WHERE empresa_id = NEW.empresa_id AND marca_clave = '' AND referencia_clave = ''
         AND nombre_clave = public.textil_clave(v_nombre);
    END IF;
  END IF;

  NEW.producto_id := v_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.textil_stock_producto_auto() IS
  'Una variante dada de alta sin producto toma el producto de su nombre (sin marca ni '
  'referencia) o lo crea. Así sigue funcionando todo lo que da de alta stock sin producto.';

DROP TRIGGER IF EXISTS textil_stock_producto_auto ON public.textil_stock;
CREATE TRIGGER textil_stock_producto_auto
  BEFORE INSERT ON public.textil_stock
  FOR EACH ROW EXECUTE FUNCTION public.textil_stock_producto_auto();

DO $$
DECLARE v JSONB;
BEGIN
  v := public.escaner_textil_migrar_datos();
  RAISE NOTICE 'Escáner textil, datos antes de las reglas: %', v;
END $$;

ALTER TABLE public.textil_stock ALTER COLUMN producto_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS textil_stock_variante_unica
  ON public.textil_stock (producto_id, color_clave, talla_clave)
  WHERE activa AND NOT repetida;
CREATE UNIQUE INDEX IF NOT EXISTS textil_stock_ean_unico
  ON public.textil_stock (empresa_id, ean)
  WHERE ean IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Cabecera de compra registrada inmutable
-- ---------------------------------------------------------------------------
-- Sin SECURITY DEFINER a propósito: mira current_user, que dentro de una
-- función SECURITY DEFINER sería su dueño y no quien escribe. Compara con
-- to_jsonb(): una columna que no existe en ese momento (las pruebas revierten
-- y reaplican migraciones viejas) cuenta como igual.
CREATE OR REPLACE FUNCTION public.compra_registrada_cabecera()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_numero TEXT := COALESCE(OLD.numero, '(sin número)');
  v_viejo JSONB;
  v_nuevo JSONB;
  v_antes JSONB;
  v_despues JSONB;
  k TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'registrada' THEN
      RAISE EXCEPTION 'La factura % ya está registrada y no se borra. Si sobra, avisa: se corrige con una rectificativa del proveedor o, si es textil, con un ajuste de inventario.', v_numero
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.estado <> 'registrada' THEN
    IF NEW.estado = 'registrada' AND current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Una compra se registra desde su revisión, no cambiando su estado a mano.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado <> 'registrada' THEN
    RAISE EXCEPTION 'La factura % ya está registrada: no vuelve a borrador.', v_numero
      USING ERRCODE = 'restrict_violation';
  END IF;

  v_viejo := to_jsonb(OLD);
  v_nuevo := to_jsonb(NEW);

  FOREACH k IN ARRAY ARRAY['empresa_id', 'proveedor', 'nif_proveedor', 'numero', 'fecha', 'base',
                           'iva', 'irpf', 'total', 'categoria', 'lectura_ia', 'cuota_iva',
                           'cuota_irpf', 'liquido']
  LOOP
    IF (v_viejo -> k) IS DISTINCT FROM (v_nuevo -> k) THEN
      RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, k
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  -- Solo de nulo a un valor.
  FOREACH k IN ARRAY ARRAY['proveedor_id', 'fichero_ruta', 'fichero_huella']
  LOOP
    v_antes := NULLIF(v_viejo -> k, 'null'::JSONB);
    v_despues := NULLIF(v_nuevo -> k, 'null'::JSONB);
    IF v_antes IS DISTINCT FROM v_despues AND v_antes IS NOT NULL THEN
      RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, k
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  -- Solo de un valor a nulo: es lo que hace la FK ON DELETE SET NULL al
  -- borrar un gasto fijo.
  v_antes := NULLIF(v_viejo -> 'gasto_id', 'null'::JSONB);
  v_despues := NULLIF(v_nuevo -> 'gasto_id', 'null'::JSONB);
  IF v_antes IS DISTINCT FROM v_despues AND v_despues IS NOT NULL THEN
    RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, 'gasto_id'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Borrado lógico: solo de nulo a una fecha, y solo fuera del textil.
  v_antes := NULLIF(v_viejo -> 'borrada_en', 'null'::JSONB);
  v_despues := NULLIF(v_nuevo -> 'borrada_en', 'null'::JSONB);
  IF v_antes IS DISTINCT FROM v_despues THEN
    IF (v_viejo ->> 'categoria') = 'textil' THEN
      RAISE EXCEPTION 'La compra textil % movió stock y no se borra: para corregir, haz un ajuste de inventario.', v_numero
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF v_despues IS NULL THEN
      RAISE EXCEPTION 'Una factura borrada no vuelve a contar.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF v_antes IS NOT NULL THEN
      RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, 'borrada_en'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compra_registrada_cabecera() IS
  'Una compra registrada no cambia sus datos de factura, no vuelve a borrador y no se borra; '
  'y solo pasa a registrada dentro de las funciones de registro.';

-- AFTER, para ver ya calculadas las columnas generadas (cuotas, líquido).
DROP TRIGGER IF EXISTS textil_compras_registrada_inmutable ON public.textil_compras;
CREATE TRIGGER textil_compras_registrada_inmutable
  AFTER UPDATE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.compra_registrada_cabecera();

DROP TRIGGER IF EXISTS textil_compras_registrada_no_se_borra ON public.textil_compras;
CREATE TRIGGER textil_compras_registrada_no_se_borra
  BEFORE DELETE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.compra_registrada_cabecera();

-- ---------------------------------------------------------------------------
-- 3. El coste medio solo por movimientos
-- ---------------------------------------------------------------------------
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
  IF NEW.coste_unitario IS DISTINCT FROM OLD.coste_unitario
     AND COALESCE(current_setting('app.stock_via_movimiento', true), '') <> '1' THEN
    RAISE EXCEPTION
      'El coste medio no se escribe a mano: lo calcula el libro de movimientos. Para corregirlo, anota un ajuste de inventario.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Y al dar de alta: una variante nace sin existencias y sin coste. Sin esto,
-- un INSERT por PostgREST con cantidad y coste dejaba unidades y un coste medio
-- sin ninguna fila en el libro (stock_descuadres solo mira unidades).
CREATE OR REPLACE FUNCTION public.stock_alta_sin_existencias()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (COALESCE(NEW.cantidad, 0) <> 0 OR COALESCE(NEW.coste_unitario, 0) <> 0)
     AND COALESCE(current_setting('app.stock_via_movimiento', true), '') <> '1' THEN
    RAISE EXCEPTION
      'Una variante nace sin existencias y sin coste: las unidades entran con su factura (Textil › Compras) o con un ajuste de inventario.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_stock_alta_sin_existencias ON public.textil_stock;
CREATE TRIGGER textil_stock_alta_sin_existencias
  BEFORE INSERT ON public.textil_stock
  FOR EACH ROW EXECUTE FUNCTION public.stock_alta_sin_existencias();

-- Retirar una variante, solo sin existencias. Antes se desactivaba con sus
-- unidades: dejaban de verse en el almacén pero seguían valiendo en el libro,
-- y su pérdida no pasaba nunca por Resultados. Ahora primero tienen que salir
-- por el libro (una merma o un ajuste de inventario) o pasar a otra variante
-- (fusionar).
CREATE OR REPLACE FUNCTION public.textil_stock_retirar(_stock_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_movimientos INT;
  v_cantidad NUMERIC;
BEGIN
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
$$;

COMMENT ON FUNCTION public.textil_stock_retirar(UUID) IS
  'Borra la variante si nunca tuvo movimientos; si los tuvo, la desactiva, pero solo con 0 '
  'unidades (las que tenga salen antes por el libro). Devuelve "borrada" o "desactivada".';

REVOKE EXECUTE ON FUNCTION public.textil_stock_retirar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_stock_retirar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Nuevo stock_aplicar_movimiento() y entradas «compra» solo por registro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_aplicar_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saldo NUMERIC;
  v_coste NUMERIC;
  v_nuevo_coste NUMERIC;
  v_coste_venta NUMERIC;
  v_fusion BOOLEAN := COALESCE(current_setting('app.fusion_variantes', true), '') = '1';
BEGIN
  SELECT cantidad, coste_unitario INTO v_saldo, v_coste
    FROM public.textil_stock WHERE id = NEW.stock_id
    FOR UPDATE;   -- serializa: sin esto vuelve la carrera del contador

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante de stock % no existe', NEW.stock_id;
  END IF;

  -- 1. Fecha contable: la que traiga (la de la factura) o el día de hoy en Madrid.
  NEW.fecha := COALESCE(NEW.fecha, (now() AT TIME ZONE 'Europe/Madrid')::date);

  -- 2. Entradas sin coste.
  IF NEW.motivo = 'devolucion_cliente' AND NEW.cantidad > 0 AND NEW.coste_unitario = 0 THEN
    -- Vuelve al coste al que salió en ese pedido, también si la venta salió
    -- de una variante que después se fusionó en esta.
    IF NEW.textil_pedido_id IS NOT NULL THEN
      SELECT sum(-m.cantidad * m.coste_unitario) / NULLIF(sum(-m.cantidad), 0)
        INTO v_coste_venta
        FROM public.textil_stock_movimientos m
       WHERE m.motivo = 'venta'
         AND m.textil_pedido_id = NEW.textil_pedido_id
         AND (m.stock_id = NEW.stock_id
              OR m.stock_id IN (SELECT s.id FROM public.textil_stock s
                                 WHERE s.fusionada_en = NEW.stock_id));
    END IF;
    NEW.coste_unitario := COALESCE(v_coste_venta, v_coste);
  ELSIF NEW.motivo = 'ajuste_inventario' AND NEW.cantidad > 0 AND NEW.coste_unitario = 0
        AND NOT v_fusion THEN
    -- Lo que aparece en un recuento entra al coste medio. (En una fusión, la
    -- entrada lleva el coste del origen, aunque sea 0: los dos ajustes suman 0.)
    NEW.coste_unitario := v_coste;
  END IF;

  -- 3. Media ponderada. Una compra a coste 0 (regalo, 100 % de descuento) sí
  --    la baja, y una devolución de cliente también, al coste que se le haya
  --    resuelto (aunque sea 0, si la venta salió a 0): si no, esas unidades
  --    valdrían 0 en el libro y el coste medio en la caché. Con saldo negativo
  --    o cero, la entrada manda.
  IF NEW.cantidad > 0
     AND (NEW.coste_unitario > 0 OR NEW.motivo IN ('compra', 'devolucion_cliente') OR v_fusion) THEN
    IF v_saldo > 0 THEN
      v_nuevo_coste := (v_saldo * v_coste + NEW.cantidad * NEW.coste_unitario)
                       / (v_saldo + NEW.cantidad);
    ELSE
      v_nuevo_coste := NEW.coste_unitario;
    END IF;
  ELSE
    v_nuevo_coste := v_coste;
  END IF;

  -- 4. Toda salida sale al coste medio vigente, traiga el coste que traiga.
  IF NEW.cantidad < 0 THEN
    NEW.coste_unitario := v_coste;
  END IF;

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

CREATE OR REPLACE FUNCTION public.stock_compra_solo_por_registro()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.motivo = 'compra' AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Las entradas por compra solo las anota el registro de su factura (Textil › Compras).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_stock_mov_compra_solo_registro ON public.textil_stock_movimientos;
CREATE TRIGGER textil_stock_mov_compra_solo_registro
  BEFORE INSERT ON public.textil_stock_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.stock_compra_solo_por_registro();

-- ---------------------------------------------------------------------------
-- 5. Entradas por compra, siempre con su factura
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_compra_con_factura
      CHECK (motivo <> 'compra' OR compra_linea_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_linea_solo_compra CHECK (compra_linea_id IS NULL OR motivo = 'compra');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_compra_id_motivo
      CHECK (compra_id IS NULL OR motivo IN ('compra', 'devolucion_proveedor'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Coste congelado en las líneas de presupuesto y pedido textil
-- ---------------------------------------------------------------------------
-- Al crear la línea, el coste medio de su variante (nulo si no tiene). Al
-- cambiarla, se conserva: solo si la persona la pasa a OTRA variante se toma
-- el coste de la nueva. Retirar la variante (FK SET NULL) o fusionarla no
-- reescribe el coste congelado.
--
-- Guardar un presupuesto o un pedido borra y vuelve a insertar sus líneas.
-- Una línea que ya existía SIN coste congelado (anterior a esta migración, o
-- de una variante sin coste) no puede tomar el coste de hoy al reinsertarse:
-- la aplicación la manda con coste_unit_snapshot = -1 (SIN_COSTE_CONGELADO en
-- src/lib/textil.functions.ts), que aquí se queda en nulo. Ningún coste real
-- es negativo.
CREATE OR REPLACE FUNCTION public.textil_item_coste_congelado()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.coste_unit_snapshot < 0 THEN
      NEW.coste_unit_snapshot := NULL;
    ELSIF NEW.coste_unit_snapshot IS NULL AND NEW.stock_id IS NOT NULL THEN
      SELECT NULLIF(s.coste_unitario, 0) INTO NEW.coste_unit_snapshot
        FROM public.textil_stock s WHERE s.id = NEW.stock_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stock_id IS NOT DISTINCT FROM OLD.stock_id
     OR NEW.stock_id IS NULL
     OR COALESCE(current_setting('app.fusion_variantes', true), '') = '1' THEN
    NEW.coste_unit_snapshot := OLD.coste_unit_snapshot;
  ELSE
    SELECT NULLIF(s.coste_unitario, 0) INTO NEW.coste_unit_snapshot
      FROM public.textil_stock s WHERE s.id = NEW.stock_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS textil_presupuesto_items_coste_congelado ON public.textil_presupuesto_items;
CREATE TRIGGER textil_presupuesto_items_coste_congelado
  BEFORE INSERT OR UPDATE ON public.textil_presupuesto_items
  FOR EACH ROW EXECUTE FUNCTION public.textil_item_coste_congelado();

DROP TRIGGER IF EXISTS textil_pedido_items_coste_congelado ON public.textil_pedido_items;
CREATE TRIGGER textil_pedido_items_coste_congelado
  BEFORE INSERT OR UPDATE ON public.textil_pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.textil_item_coste_congelado();

-- ---------------------------------------------------------------------------
-- 7. Guardar y registrar una compra, en una sola transacción
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_compra_guardar_y_registrar(_compra JSONB, _usuario_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  -- 0. Autor y acceso -----------------------------------------------------
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sin usuario: la compra necesita un autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

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
       forma_pago, lectura_ia, estado)
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
       v_lectura, 'borrador')
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

  -- 3. Líneas -------------------------------------------------------------
  -- La variante (stock_id) se escribe en el paso 4.6, después de validarla.
  DELETE FROM public.textil_compra_lineas WHERE compra_id = v_id;

  INSERT INTO public.textil_compra_lineas
    (compra_id, orden, descripcion, cantidad, precio_unitario, importe, unidad, tipo,
     referencia, marca, modelo, color, talla, ean, unidades_por_pack,
     unidades_stock, coste_total_entrada, coste_unitario_entrada, casado_metodo)
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
              THEN NULLIF(btrim(e.l ->> 'casado_metodo'), '') END
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

    -- 4.8 Movimientos: una entrada por artículo, enlazada a su línea.
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

  -- 5. Registrar ----------------------------------------------------------
  -- En su propio bloque: solo el único de factura duplicada se traduce; un
  -- único de EAN, variante o memoria no puede salir como «ya registrada».
  BEGIN
    UPDATE public.textil_compras
       SET estado = 'registrada', revision = 'revisada', revision_motivo = NULL,
           proveedor_id = v_prov_id
     WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'textil_compras_factura_unica' THEN
      RAISE EXCEPTION 'Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.'
        USING ERRCODE = 'unique_violation';
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
    'proveedor_nuevo', v_prov_nuevo);
END;
$$;

COMMENT ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) IS
  'Guarda y registra una compra en una sola transacción. En textil valida el reparto de '
  'costes (Σ coste de entrada = base), crea las variantes nuevas, aprende la memoria del '
  'escáner y anota las entradas de stock enlazadas a su línea. Si algo falla, no queda nada.';

REVOKE ALL ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. textil_compra_registrar(): el camino viejo, con control de empresa
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
$$;

COMMENT ON FUNCTION public.textil_compra_registrar(UUID) IS
  'Registra una compra ya guardada (camino viejo, sin reparto de portes ni descuentos). En '
  'textil, cada línea casada entra en el stock (cantidad × pack) enlazada a su línea. Falla si '
  'alguna línea no está casada o no es un artículo, si la compra ya estaba registrada o si '
  'quien llama no es de su empresa.';

REVOKE EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Fusionar una variante en otra
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_stock_fusionar(_origen UUID, _destino UUID, _usuario_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

COMMENT ON FUNCTION public.textil_stock_fusionar(UUID, UUID, UUID) IS
  'Fusiona una variante (normalmente repetida) en otra: pasa sus unidades al coste medio del '
  'origen (si son negativas, al del destino) con dos ajustes que suman 0, sus reservas, sus líneas de pedido y presupuesto, la memoria y las '
  'compras en borrador; el origen queda desactivado y con fusionada_en.';

REVOKE ALL ON FUNCTION public.textil_stock_fusionar(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.textil_stock_fusionar(UUID, UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Versión: si existe, las tres migraciones del escáner están aplicadas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.escaner_textil_version()
RETURNS INT
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT 1 $$;

REVOKE ALL ON FUNCTION public.escaner_textil_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escaner_textil_version() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
