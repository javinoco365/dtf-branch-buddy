-- ============================================================================
-- PROFORMAS (2 de 2) · Proformas de proveedor, casado con su factura,
-- regularización del stock y líneas por talla
-- ============================================================================
--
-- SE APLICA EN UNA EJECUCIÓN APARTE, DESPUÉS DE 20261029100000_proformas_motivo.sql
--   Aquella añade 'ajuste_coste' al enum stock_motivo, y PostgreSQL no deja
--   usar un valor de enum nuevo en la transacción que lo añade. Si las dos se
--   pegan juntas en el editor SQL de Supabase, esta falla («unsafe use of new
--   value»). Por eso su primera sentencia es una guarda que lo dice.
--   Este fichero no lleva BEGIN/COMMIT propios: la prueba C19 lo aplica dentro
--   de su transacción. Se puede aplicar dos veces: cada CHECK, índice, trigger
--   y función que toca se borra y se crea de nuevo (es la versión que manda).
--
-- QUÉ RESUELVE (docs/proformas/decisiones.md y contrato.md)
--   - Los proveedores textiles mandan una proforma, se paga por adelantado y la
--     mercancía llega con ella; la factura llega después. Hoy la proforma solo
--     se puede registrar como una factura más: cuenta en el IVA y, al llegar la
--     factura, el género entra dos veces en el stock y el pago queda en el
--     documento equivocado.
--   - Las líneas del papel con varias tallas se parten en una línea por talla
--     y se perdía de qué línea del papel salían.
--
-- QUÉ CAMBIA, EN ESTE ORDEN
--   1. Columnas: textil_compras.tipo_documento ('factura' | 'proforma', por
--      defecto 'factura': las de antes quedan facturas), proforma_id (en la
--      FACTURA: su proforma; 1:1 por índice único) y casado_resumen (lo que
--      hizo el casado); textil_compra_lineas.linea_papel;
--      textil_stock_movimientos.importe_ajuste. Sus CHECK. El único de factura
--      duplicada (textil_compras_factura_unica) lleva el tipo en la clave: una
--      proforma y su factura con el mismo número no chocan.
--   2. compra_registrada_cabecera(): tipo_documento, proforma_id y
--      casado_resumen son inmutables en una registrada; una compra casada (la
--      factura o la proforma) no admite borrado lógico.
--   3. compra_proforma_solo_por_registro(): authenticated y anon no ponen ni
--      cambian proforma_id ni casado_resumen, ni el pago de una proforma ya
--      casada (el pago vive en la factura).
--   4. stock_aplicar_movimiento(): el motivo nuevo 'ajuste_coste' (cantidad 0,
--      con importe) revaloriza las existencias de la variante sin mover
--      unidades; nunca deja el coste medio en negativo ni se anota sin
--      existencias. stock_compra_solo_por_registro(): solo lo anota el
--      registro de la factura casada.
--   5. Funciones nuevas de lectura: textil_stock_destino() (la variante donde
--      acabó una fusionada), proforma_entradas() (lo que metió una proforma en
--      el libro, por variante) y compras_proformas_pendientes() (proformas sin
--      factura: el aviso y los anticipos).
--   6. textil_compra_guardar_y_registrar(): registra también proformas (meten
--      el stock como una factura) y, con proforma_id, casa la factura con su
--      proforma en la misma transacción: no vuelve a meter el stock, regulariza
--      la diferencia por variante (entran, salen y ajuste de coste), pasa los
--      enlaces del banco de la proforma a la factura y hereda su pago (salvo
--      una proforma pagada a mano, sin enlace, y una factura por más: la
--      factura queda pendiente). Bloquea las filas del banco antes que las compras,
--      como el motor de conciliación.
--   7. textil_compra_registrar() (camino viejo): rechaza proformas y facturas
--      casadas.
--   8. Conciliación: banco_documentos() y banco_documentos_por_conciliar() se
--      recrean con una última columna tipo_documento, y la proforma casada
--      deja de ser conciliable; banco_enlaces() la lleva en sus documentos;
--      banco_enlazar_como() no concilia una proforma casada.
--      banco_aplicar_efectos() no borra marco_pagada de un enlace que ya marcó
--      pagada su compra (el de la proforma, movido a la factura casada).
--   9. proformas_version(): si existe, las dos migraciones están puestas.
--
-- NO HAY TABLAS NUEVAS: RLS, políticas por operación y auditoría ya existen en
-- las tablas que se tocan. Ninguna columna nueva es sensible.
--
-- SIN ESTA MIGRACIÓN
--   La aplicación oculta todo lo de proformas y avisa en ámbar
--   (AVISO_MIGRACION_PROFORMAS). El servidor nunca manda una proforma ni un
--   proforma_id a una base sin ella. Registrar facturas sigue igual que hoy.
--
-- REVERSIBLE
--   Sí, mientras no se haya registrado ninguna proforma ni ajuste de coste:
--   supabase/reversiones/20261029100100_proformas_compras.sql (se niega si
--   los hay). Repone las funciones de antes tal cual y quita columnas, CHECK,
--   índices y funciones nuevas. Se pierde linea_papel de las líneas ya
--   registradas (los importes y unidades no cambian).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Guarda: el valor 'ajuste_coste' tiene que estar ya en el enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'stock_motivo' AND e.enumlabel = 'ajuste_coste') THEN
    RAISE EXCEPTION 'Aplica antes 20261029100000_proformas_motivo.sql, en una ejecución aparte.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columnas, CHECK e índices
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT 'factura',
  ADD COLUMN IF NOT EXISTS proforma_id UUID
    REFERENCES public.textil_compras(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS casado_resumen JSONB;

ALTER TABLE public.textil_compras
  DROP CONSTRAINT IF EXISTS compra_tipo_documento,
  DROP CONSTRAINT IF EXISTS compra_proforma_solo_factura,
  DROP CONSTRAINT IF EXISTS compra_proforma_no_ella_misma,
  DROP CONSTRAINT IF EXISTS compra_casado_con_proforma;
ALTER TABLE public.textil_compras
  ADD CONSTRAINT compra_tipo_documento CHECK (tipo_documento IN ('factura', 'proforma')),
  ADD CONSTRAINT compra_proforma_solo_factura
    CHECK (proforma_id IS NULL OR tipo_documento = 'factura'),
  ADD CONSTRAINT compra_proforma_no_ella_misma CHECK (proforma_id IS NULL OR proforma_id <> id),
  ADD CONSTRAINT compra_casado_con_proforma CHECK ((casado_resumen IS NULL) = (proforma_id IS NULL));

COMMENT ON COLUMN public.textil_compras.tipo_documento IS
  'factura (documento fiscal) o proforma (no fiscal: mete el stock y se paga por adelantado, '
  'pero no cuenta en IVA, Gerencia ni archivo).';
COMMENT ON COLUMN public.textil_compras.proforma_id IS
  'En la factura: la proforma con la que se casó al registrarla (1:1). Solo lo escribe '
  'textil_compra_guardar_y_registrar().';
COMMENT ON COLUMN public.textil_compras.casado_resumen IS
  'En la factura casada: lo que hizo el casado (regularización del stock y pago traspasado), '
  'forma ResumenCasado. Nulo en el resto.';

-- Una proforma, una factura (P2). Sin condición de borrada_en: una casada no
-- se borra.
DROP INDEX IF EXISTS public.textil_compras_proforma_casada_unica;
CREATE UNIQUE INDEX textil_compras_proforma_casada_unica
  ON public.textil_compras (proforma_id) WHERE proforma_id IS NOT NULL;

DROP INDEX IF EXISTS public.textil_compras_proformas_abiertas;
CREATE INDEX textil_compras_proformas_abiertas
  ON public.textil_compras (empresa_id, fecha)
  WHERE tipo_documento = 'proforma' AND estado = 'registrada' AND borrada_en IS NULL;

-- La misma factura no se registra dos veces; una proforma y su factura con el
-- mismo número, sí (el tipo va en la clave).
DROP INDEX IF EXISTS public.textil_compras_factura_unica;
CREATE UNIQUE INDEX textil_compras_factura_unica
  ON public.textil_compras (empresa_id, tipo_documento, proveedor_clave, numero_clave)
  WHERE estado = 'registrada' AND borrada_en IS NULL
    AND proveedor_clave <> '' AND numero_clave <> '';

ALTER TABLE public.textil_compra_lineas
  ADD COLUMN IF NOT EXISTS linea_papel INT;
ALTER TABLE public.textil_compra_lineas DROP CONSTRAINT IF EXISTS compra_linea_papel;
ALTER TABLE public.textil_compra_lineas
  ADD CONSTRAINT compra_linea_papel CHECK (linea_papel IS NULL OR linea_papel > 0);
COMMENT ON COLUMN public.textil_compra_lineas.linea_papel IS
  'Número (1…n) de la línea del papel de la que sale esta, cuando la IA partió una línea con '
  'varias tallas.';

ALTER TABLE public.textil_stock_movimientos
  ADD COLUMN IF NOT EXISTS importe_ajuste NUMERIC(14,2);
COMMENT ON COLUMN public.textil_stock_movimientos.importe_ajuste IS
  'Solo en ajuste_coste: lo que sube (+) o baja (−) el valor del stock que queda de la variante. '
  'Es el valor del movimiento.';

ALTER TABLE public.textil_stock_movimientos
  DROP CONSTRAINT IF EXISTS stock_movimiento_no_cero,
  DROP CONSTRAINT IF EXISTS stock_movimiento_signo,
  DROP CONSTRAINT IF EXISTS stock_compra_id_motivo,
  DROP CONSTRAINT IF EXISTS stock_ajuste_coste_completo;
ALTER TABLE public.textil_stock_movimientos
  ADD CONSTRAINT stock_movimiento_no_cero CHECK (cantidad <> 0 OR motivo = 'ajuste_coste'),
  ADD CONSTRAINT stock_movimiento_signo CHECK (
    (motivo IN ('compra', 'devolucion_cliente', 'inicial') AND cantidad > 0)
    OR (motivo IN ('venta', 'devolucion_proveedor', 'merma') AND cantidad < 0)
    OR motivo = 'ajuste_inventario'   -- el recuento puede ir en los dos sentidos
    OR (motivo = 'ajuste_coste' AND cantidad = 0)
  ),
  ADD CONSTRAINT stock_compra_id_motivo
    CHECK (compra_id IS NULL OR motivo IN ('compra', 'devolucion_proveedor', 'ajuste_coste')),
  ADD CONSTRAINT stock_ajuste_coste_completo CHECK (
    (motivo = 'ajuste_coste' AND importe_ajuste IS NOT NULL AND importe_ajuste <> 0
                             AND compra_id IS NOT NULL)
    OR (motivo <> 'ajuste_coste' AND importe_ajuste IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. Cabecera de compra registrada: el casado también es inmutable
-- ---------------------------------------------------------------------------
-- Copia de 20261028100200 con dos cambios: tipo_documento, proforma_id y
-- casado_resumen en la lista de inmutables, y el borrado lógico de una compra
-- casada (E-PRO-11). Los triggers textil_compras_registrada_inmutable y
-- textil_compras_registrada_no_se_borra siguen como están.
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
                           'cuota_irpf', 'liquido', 'tipo_documento', 'proforma_id',
                           'casado_resumen']
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
    -- Una compra casada con su proforma (la factura o la proforma) no se
    -- borra: deshacer un casado queda fuera de alcance (E-PRO-11).
    IF (v_viejo ->> 'proforma_id') IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.textil_compras f WHERE f.proforma_id = OLD.id) THEN
      RAISE EXCEPTION 'La compra % está casada con una proforma y no se borra.', v_numero
        USING ERRCODE = 'restrict_violation';
    END IF;
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

-- ---------------------------------------------------------------------------
-- 3. El casado y el pago de una proforma casada, solo por el registro
-- ---------------------------------------------------------------------------
-- Sin SECURITY DEFINER a propósito: mira current_user (dentro de las funciones
-- de registro es su dueño). Compara con to_jsonb() y nunca con NEW.columna:
-- las pruebas revierten migraciones que quitan estado_pago o fecha_pago con
-- este trigger puesto, y NEW.estado_pago daría «record "new" has no field».
-- Una clave que falta cuenta como igual.
CREATE OR REPLACE FUNCTION public.compra_proforma_solo_por_registro()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_n JSONB;
  v_o JSONB;
  v_num TEXT;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_n := to_jsonb(NEW);

  IF TG_OP = 'INSERT' THEN
    IF NULLIF(v_n -> 'proforma_id', 'null'::JSONB) IS NOT NULL
       OR NULLIF(v_n -> 'casado_resumen', 'null'::JSONB) IS NOT NULL THEN
      RAISE EXCEPTION 'La proforma y su factura solo se casan al registrar la factura, desde su revisión.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  v_o := to_jsonb(OLD);

  IF (v_o -> 'proforma_id') IS DISTINCT FROM (v_n -> 'proforma_id')
     OR (v_o -> 'casado_resumen') IS DISTINCT FROM (v_n -> 'casado_resumen') THEN
    RAISE EXCEPTION 'La proforma y su factura solo se casan al registrar la factura, desde su revisión.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF ((v_o -> 'estado_pago') IS DISTINCT FROM (v_n -> 'estado_pago')
      OR (v_o -> 'fecha_pago') IS DISTINCT FROM (v_n -> 'fecha_pago'))
     AND (v_o ->> 'tipo_documento') = 'proforma' THEN
    SELECT f.numero INTO v_num FROM public.textil_compras f
     WHERE f.proforma_id = OLD.id ORDER BY f.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Esta proforma ya tiene factura (n.º %): el pago se marca en la factura.',
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compra_proforma_solo_por_registro() IS
  'authenticated y anon no ponen ni cambian proforma_id ni casado_resumen (solo los escribe el '
  'registro de la factura casada), ni el pago de una proforma que ya tiene factura.';

DROP TRIGGER IF EXISTS textil_compras_proforma_solo_por_registro ON public.textil_compras;
CREATE TRIGGER textil_compras_proforma_solo_por_registro
  BEFORE INSERT OR UPDATE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.compra_proforma_solo_por_registro();

-- ---------------------------------------------------------------------------
-- 4. El ajuste de coste en el libro de stock
-- ---------------------------------------------------------------------------
-- Copia de 20261028100200 con la rama nueva 1b ('ajuste_coste'). El trigger
-- textil_stock_mov_aplicar no cambia.
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

  -- 1b. Ajuste de coste (factura casada con su proforma): no mueve unidades;
  --     reparte su importe entre las existencias que quedan y cambia el
  --     coste medio. Su valor en el libro es importe_ajuste.
  IF NEW.motivo = 'ajuste_coste' THEN
    IF NEW.cantidad <> 0 OR NEW.importe_ajuste IS NULL OR NEW.importe_ajuste = 0 THEN
      RAISE EXCEPTION 'Un ajuste de coste no mueve unidades: lleva cantidad 0 y un importe distinto de 0.'
        USING ERRCODE = '22023';
    END IF;
    IF v_saldo <= 0 THEN
      RAISE EXCEPTION 'No hay existencias de esta variante a las que llevar el ajuste de coste.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    v_nuevo_coste := (v_saldo * v_coste + NEW.importe_ajuste) / v_saldo;
    IF v_nuevo_coste < 0 THEN
      RAISE EXCEPTION 'El ajuste de coste dejaría el coste medio de la variante en negativo.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.coste_unitario := 0;
    PERFORM set_config('app.stock_via_movimiento', '1', true);
    UPDATE public.textil_stock
       SET coste_unitario = round(v_nuevo_coste, 4), updated_at = now()
     WHERE id = NEW.stock_id;                 -- la cantidad no cambia
    PERFORM set_config('app.stock_via_movimiento', '', true);
    RETURN NEW;
  END IF;

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
  IF NEW.motivo = 'ajuste_coste' AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Los ajustes de coste solo los anota el registro de la factura casada con su proforma (Compras).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Funciones de lectura nuevas
-- ---------------------------------------------------------------------------
-- La variante donde acabó una variante fusionada (sigue fusionada_en; como
-- mucho 20 saltos). Devuelve la misma si no está fusionada; NULL con NULL.
CREATE OR REPLACE FUNCTION public.textil_stock_destino(_stock_id UUID)
RETURNS UUID
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_id UUID := _stock_id;
  v_sig UUID;
  i INT;
BEGIN
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  FOR i IN 1..20 LOOP
    SELECT fusionada_en INTO v_sig FROM public.textil_stock WHERE id = v_id;
    EXIT WHEN v_sig IS NULL;
    v_id := v_sig;
  END LOOP;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.textil_stock_destino(UUID) IS
  'La variante donde acabó una variante fusionada (sigue fusionada_en, hasta 20 saltos); la '
  'misma si no está fusionada.';

-- Lo que metió una proforma en el libro, por variante de destino (unidades,
-- valor y coste: solo motivo 'compra'), y las unidades devueltas a mano al
-- proveedor enlazadas a ella, solo para avisar (no cambian la comparación).
-- Una variante con devoluciones y sin 'compra' no sale.
-- `posteriores`: las unidades que entraron en esa variante (compra o
-- inicial, de otro documento) DESPUÉS de la última entrada de la proforma. Lo
-- que queda en el almacén se cuenta como lo más nuevo (lo más antiguo sale
-- antes): de la proforma solo sigue ahí saldo − posteriores, y el ajuste de
-- coste no se lleva al género de otra compra (decisión 7). No cuentan las
-- devoluciones de cliente (lo que vuelve es género que ya estaba, a menudo de
-- la propia proforma) ni los ajustes de inventario (la fusión de variantes se
-- anota así y no es género nuevo).
-- (Solo los literales 'compra', 'inicial' y 'devolucion_proveedor': una
-- función LANGUAGE sql se valida al crearla y 'ajuste_coste' no puede salir
-- en ninguna.)
-- Se borra y se crea: cambia el tipo de retorno (la columna posteriores).
DROP FUNCTION IF EXISTS public.proforma_entradas(UUID);
CREATE FUNCTION public.proforma_entradas(_proforma_id UUID)
RETURNS TABLE (stock_id UUID, unidades NUMERIC, valor NUMERIC, coste_unitario NUMERIC,
               devueltas NUMERIC, posteriores NUMERIC)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (
    SELECT public.textil_stock_destino(m.stock_id) AS stock_id,
           sum(m.cantidad) FILTER (WHERE m.motivo = 'compra') AS unidades,
           sum(round(m.cantidad * m.coste_unitario, 2)) FILTER (WHERE m.motivo = 'compra') AS valor,
           round(sum(round(m.cantidad * m.coste_unitario, 2)) FILTER (WHERE m.motivo = 'compra')
                 / NULLIF(sum(m.cantidad) FILTER (WHERE m.motivo = 'compra'), 0), 8) AS coste_unitario,
           COALESCE(-sum(m.cantidad) FILTER (WHERE m.motivo = 'devolucion_proveedor'), 0) AS devueltas,
           max(m.id) FILTER (WHERE m.motivo = 'compra') AS ultima,
           min(m.empresa_id::TEXT)::UUID AS empresa_id
      FROM public.textil_stock_movimientos m
     WHERE m.compra_id = _proforma_id AND m.motivo IN ('compra', 'devolucion_proveedor')
     GROUP BY 1
    HAVING sum(m.cantidad) FILTER (WHERE m.motivo = 'compra') > 0
  )
  SELECT e.stock_id, e.unidades, e.valor, e.coste_unitario, e.devueltas,
         COALESCE((SELECT sum(o.cantidad)
                     FROM public.textil_stock_movimientos o
                    WHERE o.empresa_id = e.empresa_id AND o.id > e.ultima
                      AND o.motivo IN ('compra', 'inicial') AND o.cantidad > 0
                      AND o.compra_id IS DISTINCT FROM _proforma_id
                      AND public.textil_stock_destino(o.stock_id) = e.stock_id), 0)
    FROM e
$$;

COMMENT ON FUNCTION public.proforma_entradas(UUID) IS
  'Lo que metió una proforma en el libro de stock, por variante de destino (fusiones '
  'resueltas): unidades, valor y coste unitario de sus entradas compra, unidades devueltas '
  'a mano al proveedor enlazadas a ella (solo para avisar) y unidades que entraron después '
  'de otros documentos (posteriores). Con la RLS de quien llama.';

-- Proformas registradas, sin borrar y sin factura: el aviso y los anticipos.
CREATE OR REPLACE FUNCTION public.compras_proformas_pendientes()
RETURNS TABLE (id UUID, empresa_id UUID, proveedor TEXT, nif_proveedor TEXT, proveedor_id UUID,
               numero TEXT, fecha DATE, categoria TEXT, base NUMERIC, total NUMERIC,
               liquido NUMERIC, estado_pago TEXT, fecha_pago DATE, fichero_ruta TEXT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id, c.empresa_id, c.proveedor, c.nif_proveedor, c.proveedor_id, c.numero, c.fecha,
         c.categoria, c.base::NUMERIC, c.total::NUMERIC, c.liquido::NUMERIC, c.estado_pago,
         c.fecha_pago, c.fichero_ruta
    FROM public.textil_compras c
   WHERE c.tipo_documento = 'proforma' AND c.estado = 'registrada' AND c.borrada_en IS NULL
     AND c.id NOT IN (SELECT f.proforma_id FROM public.textil_compras f
                       WHERE f.proforma_id IS NOT NULL)
   ORDER BY c.fecha, c.id
$$;

COMMENT ON FUNCTION public.compras_proformas_pendientes() IS
  'Proformas registradas, sin borrar y todavía sin factura (para el aviso y los anticipos a '
  'proveedor). Sin periodo. Con la RLS de quien llama.';

REVOKE ALL ON FUNCTION public.textil_stock_destino(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proforma_entradas(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compras_proformas_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_stock_destino(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.proforma_entradas(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compras_proformas_pendientes() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Guardar y registrar: proformas y factura casada con su proforma
-- ---------------------------------------------------------------------------
-- Copia de 20261028100200 con: tipo_documento y proforma_id en el JSON (paso
-- 0, con el bloqueo en orden de la factura y la proforma, y las
-- comprobaciones de la proforma), el tipo en la cabecera (1), el mismo
-- proveedor (2), linea_papel en las líneas (3), la regularización 4.8-R en
-- lugar de 4.8 cuando hay proforma, el paso del pago (4b), el casado al
-- registrar (5) y el resultado ampliado (6). Mismos permisos: solo
-- service_role.
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
  -- Proformas (20261029100100)
  v_tipo TEXT := COALESCE(NULLIF(btrim(_compra ->> 'tipo_documento'), ''), 'factura');
  v_proforma_id UUID;
  v_pro RECORD;
  v_pro_numero TEXT;
  v_pro_proveedor TEXT;
  v_clave_factura TEXT;
  v_liquido NUMERIC;
  v_stock_res JSONB;
  v_pago JSONB;
  v_casado JSONB;
  v_num TEXT;
  -- Regularización (4.8-R)
  v_rg RECORD;
  v_saldo0 NUMERIC;
  v_saldo NUMERIC;
  v_cm NUMERIC;
  v_entran NUMERIC;
  v_salen NUMERIC;
  v_m NUMERIC;
  v_d NUMERIC;
  v_teorico NUMERIC;
  v_u NUMERIC;
  v_importe NUMERIC;
  v_valor NUMERIC;
  v_variantes JSONB := '[]'::JSONB;
  v_valor_proforma NUMERIC := 0;
  v_valor_entradas NUMERIC := 0;
  v_valor_devoluciones NUMERIC := 0;
  v_importe_ajustes NUMERIC := 0;
  v_total_entran NUMERIC := 0;
  v_total_salen NUMERIC := 0;
  v_mov_reg INT := 0;
  -- Pago
  v_enlaces INT := 0;
  v_grupos INT := 0;
  v_grupos_revisar INT := 0;
  v_grupo UUID;
  v_grupos_tocados UUID[];
  v_dif NUMERIC;
  v_liquido_pro NUMERIC;
  v_hereda BOOLEAN := false;
BEGIN
  -- 0. Autor y acceso -----------------------------------------------------
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sin usuario: la compra necesita un autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- Tipo de documento y proforma con la que se casa (E-PRO-9, E-PRO-8, E-PRO-3).
  IF v_tipo NOT IN ('factura', 'proforma') THEN
    RAISE EXCEPTION 'Tipo de documento desconocido: %. Tiene que ser factura o proforma.', v_tipo
      USING ERRCODE = '22023';
  END IF;
  v_proforma_id := NULLIF(btrim(_compra ->> 'proforma_id'), '')::UUID;
  IF v_proforma_id IS NOT NULL AND v_tipo = 'proforma' THEN
    RAISE EXCEPTION 'Una proforma no se casa con otra proforma: lo que se casa con la proforma es su factura.'
      USING ERRCODE = '22023';
  END IF;
  IF v_proforma_id IS NOT NULL AND v_proforma_id = v_id THEN
    RAISE EXCEPTION 'El documento elegido no es una proforma.' USING ERRCODE = '22023';
  END IF;

  -- Bloqueo en orden de id (la factura, si ya existe, y su proforma): dos
  -- registros que se cruzan no se bloquean entre sí. Antes, las filas de los
  -- grupos del banco de la proforma: banco_confirmar y banco_desenlazar_como
  -- bloquean primero las filas del grupo y después la compra; con el mismo
  -- orden aquí, casar a la vez que se confirma o se deshace no se interbloquea.
  IF v_proforma_id IS NOT NULL THEN
    PERFORM 1 FROM public.banco_conciliaciones
     WHERE grupo IN (SELECT c.grupo FROM public.banco_conciliaciones c
                      WHERE c.compra_id = v_proforma_id)
     ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.textil_compras
     WHERE id IN (v_id, v_proforma_id) ORDER BY id FOR UPDATE;
  END IF;

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

  -- La proforma: existe, es de la empresa, es una proforma registrada, sin
  -- factura y de la misma familia (textil o no textil). E-PRO-1 a E-PRO-7.
  IF v_proforma_id IS NOT NULL THEN
    SELECT * INTO v_pro FROM public.textil_compras WHERE id = v_proforma_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La proforma elegida no existe.' USING ERRCODE = 'P0002';
    END IF;
    v_pro_numero := COALESCE(v_pro.numero, '(sin número)');
    IF v_pro.empresa_id <> v_empresa THEN
      RAISE EXCEPTION 'La proforma es de otra empresa.' USING ERRCODE = '42501';
    END IF;
    IF v_pro.tipo_documento <> 'proforma' THEN
      RAISE EXCEPTION 'El documento elegido no es una proforma.' USING ERRCODE = '22023';
    END IF;
    IF v_pro.estado <> 'registrada' OR v_pro.borrada_en IS NOT NULL THEN
      RAISE EXCEPTION 'La proforma % todavía no está registrada o está borrada: regístrala antes de casarla.',
        v_pro_numero USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT f.numero INTO v_num FROM public.textil_compras f
     WHERE f.proforma_id = v_pro.id ORDER BY f.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'La proforma % ya tiene factura (n.º %).', v_pro_numero,
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
    END IF;
    IF (v_pro.categoria = 'textil') <> (v_categoria = 'textil') THEN
      RAISE EXCEPTION 'Una proforma textil solo se casa con una factura textil, y una de otra categoría con una factura que no sea textil.'
        USING ERRCODE = '22023';
    END IF;
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
       forma_pago, lectura_ia, estado, tipo_documento)
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
       v_lectura, 'borrador', v_tipo)
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
           tipo_documento = v_tipo,
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

  -- La proforma tiene que ser del mismo proveedor (E-PRO-6): por el
  -- proveedor del catálogo si las dos lo tienen; si no, por la clave del
  -- nombre o NIF (proveedor_clave) de las dos filas.
  IF v_proforma_id IS NOT NULL THEN
    SELECT proveedor_clave INTO v_clave_factura FROM public.textil_compras WHERE id = v_id;
    IF (v_pro.proveedor_id IS NOT NULL AND v_prov_id IS NOT NULL AND v_pro.proveedor_id <> v_prov_id)
       OR ((v_pro.proveedor_id IS NULL OR v_prov_id IS NULL)
           AND COALESCE(v_pro.proveedor_clave, '') <> '' AND COALESCE(v_clave_factura, '') <> ''
           AND v_pro.proveedor_clave <> v_clave_factura) THEN
      SELECT COALESCE(p.nombre, v_pro.proveedor) INTO v_pro_proveedor
        FROM (SELECT 1) x LEFT JOIN public.proveedores p ON p.id = v_pro.proveedor_id;
      RAISE EXCEPTION 'La proforma % es de otro proveedor (%): solo se casa con una factura del mismo proveedor.',
        v_pro_numero, COALESCE(v_pro_proveedor, '(sin nombre)') USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Una proforma que llega cuando su factura ya está registrada (sin casar):
  -- el casado solo se hace al registrar la factura, así que registrarla
  -- volvería a meter el género y a pedir su pago. Mismo proveedor (el del
  -- catálogo o la clave del nombre o NIF) y mismo número. La pantalla avisa
  -- además de la que tiene el mismo importe (duplicadosDe) y pide confirmarlo.
  IF v_tipo = 'proforma' THEN
    SELECT f.numero INTO v_num
      FROM public.textil_compras f, public.textil_compras c
     WHERE c.id = v_id AND f.id <> v_id
       AND f.empresa_id = v_empresa AND f.tipo_documento = 'factura'
       AND f.estado = 'registrada' AND f.borrada_en IS NULL AND f.proforma_id IS NULL
       AND ((v_prov_id IS NOT NULL AND f.proveedor_id = v_prov_id)
            OR (COALESCE(c.proveedor_clave, '') <> '' AND f.proveedor_clave = c.proveedor_clave))
       AND COALESCE(c.numero_clave, '') <> '' AND f.numero_clave = c.numero_clave
     ORDER BY f.id LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Esta proforma parece de la factura %, ya registrada: no la registres (la factura ya cuenta y, si es textil, su género ya entró).',
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- 3. Líneas -------------------------------------------------------------
  -- La variante (stock_id) se escribe en el paso 4.6, después de validarla.
  DELETE FROM public.textil_compra_lineas WHERE compra_id = v_id;

  INSERT INTO public.textil_compra_lineas
    (compra_id, orden, descripcion, cantidad, precio_unitario, importe, unidad, tipo,
     referencia, marca, modelo, color, talla, ean, unidades_por_pack,
     unidades_stock, coste_total_entrada, coste_unitario_entrada, casado_metodo, linea_papel)
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
              THEN NULLIF(btrim(e.l ->> 'casado_metodo'), '') END,
         NULLIF(btrim(e.l ->> 'linea_papel'), '')::INT
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

    IF v_proforma_id IS NULL THEN
      -- 4.8 Movimientos: una entrada por artículo, enlazada a su línea (factura
      --     o proforma: la proforma mete el stock igual que una factura).
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

    ELSE
      -- 4.8-R Regularización (factura textil casada con su proforma). El género
      --       ya lo metió la proforma: aquí solo entra o sale la diferencia de
      --       unidades por variante y se revaloriza lo que queda de la proforma
      --       al coste de la factura. Todos los movimientos llevan compra_id = la
      --       factura y su fecha. Ningún UPDATE ni DELETE de movimientos.
      SELECT COALESCE(sum(pe.valor), 0) INTO v_valor_proforma
        FROM public.proforma_entradas(v_pro.id) pe;

      FOR v_rg IN
        WITH p AS (
          SELECT pe.stock_id, pe.unidades, pe.coste_unitario, pe.posteriores
            FROM public.proforma_entradas(v_pro.id) pe
        ), f AS (
          SELECT l.stock_id,
                 sum(l.unidades_stock) AS unidades,
                 sum(l.coste_total_entrada) AS valor,
                 (array_agg(l.id ORDER BY l.orden))[1] AS linea
            FROM public.textil_compra_lineas l
           WHERE l.compra_id = v_id AND l.tipo = 'articulo'
           GROUP BY l.stock_id
        )
        SELECT COALESCE(p.stock_id, f.stock_id) AS stock_id,
               COALESCE(p.unidades, 0) AS up,
               p.coste_unitario AS cp,
               COALESCE(f.unidades, 0) AS uf,
               round(f.valor / NULLIF(f.unidades, 0), 8) AS cf,
               f.linea,
               COALESCE(p.posteriores, 0) AS posteriores
          FROM p FULL OUTER JOIN f ON f.stock_id = p.stock_id
         ORDER BY 1   -- orden fijo de bloqueo de las variantes
      LOOP
        -- c0. El saldo ANTES de regularizar. Una variante retirada (activa =
        --     false, con 0 unidades) no admite la salida de c2: quedaría en
        --     negativo y fuera del almacén, sin forma de corregirla.
        SELECT cantidad, activa, nombre, color, talla INTO v_var
          FROM public.textil_stock WHERE id = v_rg.stock_id FOR UPDATE;
        v_saldo0 := v_var.cantidad;
        IF NOT v_var.activa AND v_rg.up > v_rg.uf THEN
          RAISE EXCEPTION 'La variante % está retirada y la factura trae menos unidades que la proforma: reactívala en Stock (o fusiónala con la buena) antes de casar.',
            concat_ws(' · ', v_var.nombre, v_var.color, v_var.talla)
            USING ERRCODE = 'restrict_violation';
        END IF;

        -- c1. La factura trae más: entra la diferencia al coste de la factura.
        v_entran := greatest(v_rg.uf - v_rg.up, 0);
        IF v_entran > 0 THEN
          INSERT INTO public.textil_stock_movimientos
            (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, compra_linea_id,
             fecha, nota)
          VALUES
            (v_empresa, v_rg.stock_id, 'compra', v_entran, v_rg.cf, v_id, v_rg.linea, v_fecha,
             'Regularización: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
               || v_pro_numero || ' · entran ' || replace(trim_scale(v_entran)::TEXT, '.', ','))
          RETURNING round(cantidad * coste_unitario, 2) INTO v_valor;
          v_valor_entradas := v_valor_entradas + v_valor;
          v_mov_reg := v_mov_reg + 1;
        END IF;

        -- c2. La factura trae menos: sale la diferencia (al coste medio vigente,
        --     que pone el trigger; el saldo puede quedar negativo).
        v_salen := greatest(v_rg.up - v_rg.uf, 0);
        IF v_salen > 0 THEN
          INSERT INTO public.textil_stock_movimientos
            (empresa_id, stock_id, motivo, cantidad, coste_unitario, compra_id, fecha, nota)
          VALUES
            (v_empresa, v_rg.stock_id, 'devolucion_proveedor', -v_salen, 0, v_id, v_fecha,
             'Regularización: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
               || v_pro_numero || ' · salen ' || replace(trim_scale(v_salen)::TEXT, '.', ','))
          RETURNING round(cantidad * coste_unitario, 2) INTO v_valor;
          v_valor_devoluciones := v_valor_devoluciones + v_valor;
          v_mov_reg := v_mov_reg + 1;
        END IF;

        -- c3. Otro coste: se revaloriza lo que sigue en el almacén de la
        --     proforma. Lo ya vendido no se toca (queda sin aplicar).
        v_m := least(v_rg.up, v_rg.uf);
        v_d := CASE WHEN v_rg.up = 0 OR v_rg.uf = 0 THEN 0 ELSE v_rg.cf - v_rg.cp END;
        v_teorico := round(v_m * v_d, 2);
        v_u := 0;
        v_importe := 0;
        IF v_teorico <> 0 THEN
          -- Saldo y coste medio de después de c1/c2 (para el tope y el trigger).
          SELECT cantidad, coste_unitario INTO v_saldo, v_cm
            FROM public.textil_stock WHERE id = v_rg.stock_id FOR UPDATE;
          -- Unidades de la proforma que siguen en el almacén. No se usa v_saldo:
          -- incluye las que entraron en c1, ya al coste de la factura. Tampoco
          -- cuenta lo que entró de otros documentos después de la proforma
          -- (posteriores): lo que queda es lo más nuevo, y si la proforma ya
          -- se vendió, su diferencia no se carga sobre el género de otra compra.
          v_u := least(v_m, greatest(v_saldo0 - v_rg.posteriores - v_salen, 0));
          v_importe := round(v_u * v_d, 2);
          IF v_saldo > 0 AND v_saldo * v_cm + v_importe < 0 THEN
            v_importe := -floor(v_saldo * v_cm * 100) / 100;
          END IF;
          IF v_saldo > 0 AND v_importe <> 0 THEN
            INSERT INTO public.textil_stock_movimientos
              (empresa_id, stock_id, motivo, cantidad, coste_unitario, importe_ajuste, compra_id,
               fecha, nota)
            VALUES
              (v_empresa, v_rg.stock_id, 'ajuste_coste', 0, 0, v_importe, v_id, v_fecha,
               'Ajuste de coste: factura ' || COALESCE(v_numero, '(sin número)') || ' sobre proforma '
                 || v_pro_numero || ' · ' || replace(trim_scale(v_u)::TEXT, '.', ',') || ' uds');
            v_importe_ajustes := v_importe_ajustes + v_importe;
            v_mov_reg := v_mov_reg + 1;
          ELSE
            v_importe := 0;
            v_u := 0;
          END IF;
        END IF;

        -- c4. La fila de la variante (FilaRegularizacion).
        v_variantes := v_variantes || jsonb_build_object(
          'stock_id', v_rg.stock_id,
          'unidades_proforma', v_rg.up,
          'unidades_factura', v_rg.uf,
          'coste_unitario_proforma', CASE WHEN v_rg.up = 0 THEN NULL ELSE v_rg.cp END,
          'coste_unitario_factura', CASE WHEN v_rg.uf = 0 THEN NULL ELSE v_rg.cf END,
          'entran', v_entran,
          'salen', v_salen,
          'unidades_ajustadas', v_u,
          'importe_ajuste', v_importe,
          'importe_sin_aplicar', v_teorico - v_importe);
        v_total_entran := v_total_entran + v_entran;
        v_total_salen := v_total_salen + v_salen;
      END LOOP;

      -- d/e. Lo que no se pudo llevar al stock (lo ya vendido, las salidas al
      --      coste medio, redondeos) es el residuo: así P7 cuadra al céntimo.
      v_stock_res := jsonb_build_object(
        'variantes', v_variantes,
        'entran', v_total_entran,
        'salen', v_total_salen,
        'valor_proforma', v_valor_proforma,
        'valor_entradas', v_valor_entradas,
        'valor_devoluciones', v_valor_devoluciones,
        'importe_ajustes', v_importe_ajustes,
        'diferencia_sin_aplicar', round(v_base - (v_valor_proforma + v_valor_entradas
                                                  + v_valor_devoluciones + v_importe_ajustes), 2),
        'movimientos', v_mov_reg);
      v_movidas := v_movidas + v_mov_reg;
    END IF;

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

  -- 4b. Pago (solo la factura casada, de cualquier categoría) -------------
  -- Los enlaces del banco de la proforma pasan a la factura: UPDATE en su
  -- sitio (conserva grupo, estado, motivo, conciliado_por y marco_pagada; lo
  -- audita banco_conciliaciones_auditoria con app.usuario_id ya fijado), con
  -- lo que la factura espera ver en el banco (−líquido), y la diferencia de
  -- cada grupo se recalcula: si no cuadra, el grupo queda en «revisar». La
  -- proforma no se toca: conserva su pago como historia y deja de contar
  -- porque está casada. estado_pago y fecha_pago pasan en el paso 5.
  -- La factura hereda «pagada» si el pago está enlazado en el banco (si el
  -- líquido difiere, su grupo queda en «revisar» con la diferencia) o si su
  -- líquido no pasa del que se pagó por la proforma (queda cubierta; lo pagado
  -- de más queda en casado_resumen.pago.diferencia, negativa). Una proforma
  -- pagada a mano, sin enlace, y una factura por MÁS: la factura queda
  -- pendiente (nada diría que falta pagar la diferencia) y casado_resumen.pago
  -- lo anota; Tesorería solo cuenta como deuda líquido − liquido_proforma.
  IF v_proforma_id IS NOT NULL THEN
    SELECT liquido INTO v_liquido FROM public.textil_compras WHERE id = v_id;

    -- Ya bloqueadas en el paso 0, antes de la proforma (el orden del motor).
    -- Otra vez por si entre medias se enlazó un grupo nuevo (ya confirmado).
    PERFORM 1 FROM public.banco_conciliaciones
     WHERE grupo IN (SELECT c.grupo FROM public.banco_conciliaciones c WHERE c.compra_id = v_pro.id)
     ORDER BY id FOR UPDATE;

    SELECT COALESCE(array_agg(DISTINCT c.grupo), '{}') INTO v_grupos_tocados
      FROM public.banco_conciliaciones c WHERE c.compra_id = v_pro.id;

    UPDATE public.banco_conciliaciones SET compra_id = v_id, importe = -v_liquido
     WHERE compra_id = v_pro.id;
    GET DIAGNOSTICS v_enlaces = ROW_COUNT;

    FOREACH v_grupo IN ARRAY v_grupos_tocados LOOP
      -- Σ movimientos distintos − Σ documentos distintos (uno por documento).
      SELECT round(
               COALESCE((SELECT sum(m.importe) FROM public.banco_movimientos m
                          WHERE m.id IN (SELECT c.movimiento_id FROM public.banco_conciliaciones c
                                          WHERE c.grupo = v_grupo)), 0)
             - COALESCE((SELECT sum(x.importe)
                           FROM (SELECT DISTINCT ON (COALESCE(c.factura_id, c.compra_id,
                                                              c.textil_factura_id)) c.importe
                                   FROM public.banco_conciliaciones c
                                  WHERE c.grupo = v_grupo
                                  ORDER BY COALESCE(c.factura_id, c.compra_id, c.textil_factura_id),
                                           c.id) x), 0), 2)
        INTO v_dif;
      UPDATE public.banco_conciliaciones
         SET diferencia = v_dif,
             estado = CASE WHEN v_dif <> 0 THEN 'revisar' ELSE estado END
       WHERE grupo = v_grupo;
      v_grupos := v_grupos + 1;
      IF v_dif <> 0 THEN
        v_grupos_revisar := v_grupos_revisar + 1;
      END IF;
    END LOOP;

    v_liquido_pro := round(COALESCE(v_pro.liquido, v_pro.total, 0)::NUMERIC, 2);
    v_hereda := v_pro.estado_pago = 'pagada'
                AND (v_enlaces > 0 OR round(v_liquido, 2) <= v_liquido_pro);

    v_pago := jsonb_build_object(
      'enlaces_movidos', v_enlaces,
      'grupos', v_grupos,
      'grupos_revisar', v_grupos_revisar,
      'estado_pago', CASE WHEN v_hereda THEN 'pagada' ELSE 'pendiente' END,
      'fecha_pago', CASE WHEN v_hereda THEN v_pro.fecha_pago END,
      'proforma_pagada', v_pro.estado_pago = 'pagada',
      'liquido_proforma', v_liquido_pro,
      'diferencia', round(v_liquido - v_liquido_pro, 2));
    v_casado := jsonb_build_object(
      'proforma_id', v_proforma_id,
      'stock', v_stock_res,
      'pago', v_pago);
  END IF;

  -- 5. Registrar ----------------------------------------------------------
  -- En su propio bloque: solo el único de factura duplicada (y el de la
  -- proforma ya casada) se traducen; un único de EAN, variante o memoria no
  -- puede salir como «ya registrada». La factura casada guarda aquí su
  -- proforma, el pago que hereda de ella y lo que hizo el casado.
  BEGIN
    IF v_proforma_id IS NULL THEN
      UPDATE public.textil_compras
         SET estado = 'registrada', revision = 'revisada', revision_motivo = NULL,
             proveedor_id = v_prov_id
       WHERE id = v_id;
    ELSE
      UPDATE public.textil_compras
         SET estado = 'registrada', revision = 'revisada', revision_motivo = NULL,
             proveedor_id = v_prov_id,
             proforma_id = v_proforma_id,
             estado_pago = CASE WHEN v_hereda THEN 'pagada' ELSE 'pendiente' END,
             fecha_pago = CASE WHEN v_hereda THEN v_pro.fecha_pago END,
             casado_resumen = v_casado
       WHERE id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'textil_compras_factura_unica' THEN
      IF v_tipo = 'proforma' THEN
        RAISE EXCEPTION 'Esta proforma (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.'
          USING ERRCODE = 'unique_violation';
      END IF;
      RAISE EXCEPTION 'Esta factura (mismo proveedor y número) ya está registrada. Si es un duplicado, bórrala.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_restriccion = 'textil_compras_proforma_casada_unica' THEN
      -- Carrera: otra factura la casó a la vez (E-PRO-5).
      SELECT f.numero INTO v_num FROM public.textil_compras f
       WHERE f.proforma_id = v_proforma_id AND f.id <> v_id ORDER BY f.id LIMIT 1;
      RAISE EXCEPTION 'La proforma % ya tiene factura (n.º %).', v_pro_numero,
        COALESCE(v_num, '(sin número)') USING ERRCODE = 'unique_violation';
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
    'proveedor_nuevo', v_prov_nuevo,
    'tipo_documento', v_tipo,
    'proforma_id', v_proforma_id,
    'casado', v_casado);
END;
$$;

COMMENT ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) IS
  'Guarda y registra una compra (factura o proforma) en una sola transacción. En textil valida '
  'el reparto de costes (Σ coste de entrada = base), crea las variantes nuevas, aprende la '
  'memoria del escáner y anota las entradas de stock enlazadas a su línea. Con proforma_id, '
  'casa la factura con su proforma: regulariza el stock (solo la diferencia), le pasa el pago '
  'y guarda casado_resumen. Si algo falla, no queda nada.';

REVOKE ALL ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.textil_compra_guardar_y_registrar(JSONB, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. textil_compra_registrar(): el camino viejo no registra proformas
-- ---------------------------------------------------------------------------
-- Copia exacta de 20261028100200 con la guarda E-PRO-10 tras «ya estaba
-- registrada».
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

  -- Las proformas y las facturas casadas van por textil_compra_guardar_y_registrar:
  -- por aquí, la proforma no regularizaría y su pago no pasaría (E-PRO-10).
  IF v_compra.proforma_id IS NOT NULL OR v_compra.tipo_documento = 'proforma' THEN
    RAISE EXCEPTION 'Las proformas y las facturas casadas con una proforma se registran desde la revisión de Compras.'
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
-- 8. Conciliación: la etiqueta «Proforma» y la proforma casada fuera
-- ---------------------------------------------------------------------------
-- banco_documentos() y banco_documentos_por_conciliar() cambian de tipo de
-- retorno (una columna final tipo_documento): CREATE OR REPLACE no puede, así
-- que se borran y se crean de nuevo (copia de 20261025100000). Son LANGUAGE
-- sql sin BEGIN ATOMIC: banco_enlaces() y banco_conciliacion_cuantos(), que
-- las llaman, no dependen de ellas en el catálogo.
DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos();

CREATE FUNCTION public.banco_documentos()
RETURNS TABLE (
  tipo TEXT,
  id UUID,
  empresa_id UUID,
  fecha DATE,
  importe NUMERIC,
  contraparte TEXT,
  nif TEXT,
  serie TEXT,
  ejercicio INTEGER,
  numero TEXT,
  conciliable BOOLEAN,
  tipo_documento TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT 'compra'::TEXT, c.id, c.empresa_id, c.fecha, c.liquido::NUMERIC,
         c.proveedor, c.nif_proveedor, NULL::TEXT, NULL::INTEGER, c.numero,
         c.estado = 'registrada' AND c.borrada_en IS NULL
         -- La proforma ya casada: su pago lo concilia la factura.
         AND c.id NOT IN (SELECT f.proforma_id FROM public.textil_compras f
                           WHERE f.proforma_id IS NOT NULL),
         c.tipo_documento
    FROM public.textil_compras c
  UNION ALL
  SELECT 'factura'::TEXT, f.id, f.empresa_id, f.fecha, f.total::NUMERIC,
         f.cliente_nombre, f.cliente_nif, f.serie, f.ejercicio, f.numero::TEXT,
         f.estado IN ('emitida', 'vencida')
         -- La factura que canjea un ticket ya cobrado.
         AND f.id NOT IN (
           SELECT s.id
             FROM public.facturas s
             JOIN public.facturas k ON k.id = s.sustituye_a_id
            WHERE s.sustituye_a_id IS NOT NULL
              AND (k.estado = 'pagada'
                   OR EXISTS (SELECT 1 FROM public.banco_conciliaciones b WHERE b.factura_id = k.id)))
         -- El ticket ya canjeado.
         AND f.id NOT IN (
           SELECT s.sustituye_a_id FROM public.facturas s WHERE s.sustituye_a_id IS NOT NULL)
         -- La anulada entera, o la rectificativa que la anula: la original y
         -- sus rectificativas suman cero y ninguna ha pasado por el banco.
         AND COALESCE(f.rectifica_a_id, f.id) NOT IN (
           SELECT o.id
             FROM public.facturas o
             JOIN public.facturas r ON r.rectifica_a_id = o.id
            WHERE r.rectifica_a_id IS NOT NULL
              AND r.estado NOT IN ('borrador', 'anulada')
            GROUP BY o.id, o.total
           HAVING o.total + sum(r.total) = 0
              AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones b WHERE b.factura_id = o.id)
              AND NOT bool_or(EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                                       WHERE b.factura_id = r.id))),
         NULL::TEXT
    FROM public.facturas f
  UNION ALL
  SELECT 'textil'::TEXT, t.id, t.empresa_id, t.fecha, t.total::NUMERIC,
         t.cliente_nombre, t.cliente_nif, t.serie, NULL::INTEGER, t.numero,
         t.estado NOT IN ('borrador', 'anulada', 'pagada')
         AND t.id NOT IN (
           SELECT s.id
             FROM public.textil_facturas s
             JOIN public.textil_facturas k ON k.id = s.sustituye_a_id
            WHERE s.sustituye_a_id IS NOT NULL
              AND (k.estado = 'pagada'
                   OR EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                               WHERE b.textil_factura_id = k.id)))
         AND t.id NOT IN (
           SELECT s.sustituye_a_id FROM public.textil_facturas s WHERE s.sustituye_a_id IS NOT NULL)
         AND COALESCE(t.rectifica_a_id, t.id) NOT IN (
           SELECT o.id
             FROM public.textil_facturas o
             JOIN public.textil_facturas r ON r.rectifica_a_id = o.id
            WHERE r.rectifica_a_id IS NOT NULL
              AND r.estado NOT IN ('borrador', 'anulada')
            GROUP BY o.id, o.total
           HAVING o.total + sum(r.total) = 0
              AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                               WHERE b.textil_factura_id = o.id)
              AND NOT bool_or(EXISTS (SELECT 1 FROM public.banco_conciliaciones b
                                       WHERE b.textil_factura_id = r.id))),
         NULL::TEXT
    FROM public.textil_facturas t
$$;

COMMENT ON FUNCTION public.banco_documentos() IS
  'Documentos que se concilian con el banco, con la misma forma: compra (importe = líquido), '
  'factura (total) y textil (total). conciliable: si el motor puede proponerlo (queda algo que '
  'cobrar o pagar por el banco: ni pagada, ni ticket canjeado o canje de un ticket cobrado, ni '
  'anulada entera sin pasar por el banco, ni proforma ya casada con su factura). '
  'tipo_documento: factura o proforma en las compras; nulo en las demás. Solo lectura, con '
  'la RLS de quien llama.';

-- Lo que todavía se puede conciliar.
CREATE FUNCTION public.banco_documentos_por_conciliar()
RETURNS TABLE (
  tipo TEXT,
  id UUID,
  empresa_id UUID,
  fecha DATE,
  importe NUMERIC,
  contraparte TEXT,
  nif TEXT,
  serie TEXT,
  ejercicio INTEGER,
  numero TEXT,
  tipo_documento TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT d.tipo, d.id, d.empresa_id, d.fecha, d.importe, d.contraparte, d.nif,
         d.serie, d.ejercicio, d.numero, d.tipo_documento
    FROM public.banco_documentos() d
   WHERE d.conciliable
     -- Los id son UUID: no se repiten entre las tres tablas. Una comprobación
     -- por columna, para que cada una use su índice.
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.factura_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.compra_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.textil_factura_id = d.id)
$$;

COMMENT ON FUNCTION public.banco_documentos_por_conciliar() IS
  'Documentos que el motor puede proponer: conciliables y sin enlazar con ningún movimiento '
  '(ni conciliados ni por revisar).';

-- banco_enlaces(): misma firma, con tipo_documento en el JSON de documentos.
CREATE OR REPLACE FUNCTION public.banco_enlaces()
RETURNS TABLE (
  grupo UUID,
  empresa_id UUID,
  estado TEXT,
  motivo TEXT,
  diferencia NUMERIC,
  fecha DATE,
  movimientos JSONB,
  documentos JSONB
)
LANGUAGE sql STABLE AS $$
  SELECT g.grupo, g.empresa_id, g.estado, g.motivo, g.diferencia, g.fecha,
         (SELECT jsonb_agg(jsonb_build_object(
                   'id', m.id, 'fecha', m.fecha, 'concepto', m.concepto,
                   'importe', m.importe, 'cuenta_id', m.cuenta_id)
                   ORDER BY m.fecha, m.id)
            FROM public.banco_movimientos m
           WHERE m.id IN (SELECT c.movimiento_id FROM public.banco_conciliaciones c
                           WHERE c.grupo = g.grupo)),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'tipo', d.tipo, 'id', d.id, 'fecha', d.fecha, 'importe', d.importe,
                   'contraparte', d.contraparte, 'nif', d.nif, 'serie', d.serie,
                   'ejercicio', d.ejercicio, 'numero', d.numero,
                   'tipo_documento', d.tipo_documento)
                   ORDER BY d.fecha, d.id), '[]'::JSONB)
            FROM public.banco_documentos() d
           -- El id del documento sale de su columna tal cual (VALUES) y no
           -- de un COALESCE: con RLS, Postgres solo usa la clave primaria
           -- de facturas si la comparación es «columna = columna».
           WHERE d.id IN (SELECT v.id
                            FROM public.banco_conciliaciones c
                           CROSS JOIN LATERAL (VALUES (c.factura_id), (c.compra_id),
                                                      (c.textil_factura_id)) AS v (id)
                           WHERE c.grupo = g.grupo))
    FROM (
      SELECT c.grupo,
             -- Un enlace no mezcla empresas (banco_enlazar lo impide).
             (array_agg(m.empresa_id))[1] AS empresa_id,
             -- Las filas de un grupo se crean y se confirman juntas: comparten
             -- estado. Si alguna siguiera en «revisar», el grupo entero lo está.
             CASE WHEN bool_or(c.estado = 'revisar') THEN 'revisar' ELSE 'conciliada' END AS estado,
             min(c.motivo) AS motivo,
             min(c.diferencia)::NUMERIC AS diferencia,
             max(m.fecha) AS fecha
        FROM public.banco_conciliaciones c
        JOIN public.banco_movimientos m ON m.id = c.movimiento_id
       GROUP BY c.grupo
    ) g
$$;

COMMENT ON FUNCTION public.banco_enlaces() IS
  'Un enlace de conciliación por fila (las filas de un mismo grupo, juntas), con la fecha de su '
  'último movimiento y, en JSON, sus movimientos y documentos con importe y referencia.';


REVOKE EXECUTE ON FUNCTION public.banco_documentos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.banco_enlaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_documentos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_documentos_por_conciliar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.banco_enlaces() TO authenticated, service_role;

-- banco_enlazar_como(): copia de 20261017100000; una proforma que ya tiene
-- factura no se concilia (E-PRO-14). banco_aplicar_efectos, banco_confirmar y
-- banco_desenlazar_como no cambian.
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
  v_num TEXT;
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
      -- La proforma ya casada: su pago vive en la factura (E-PRO-14).
      SELECT f.numero INTO v_num FROM public.textil_compras f WHERE f.proforma_id = d.id LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Esa proforma ya tiene factura (n.º %): concilia el pago con la factura.',
          COALESCE(v_num, '(sin número)');
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

-- banco_aplicar_efectos(): copia de 20261017100000 con un cambio. Un enlace
-- que ya marcó pagada su compra lo sigue diciendo (marco_pagada OR FOUND).
-- Solo pasa con el casado: el enlace de la proforma, que ya la marcó pagada,
-- pasa a la factura (que hereda el pago) y su grupo puede quedar en
-- «revisar». Al confirmarlo, la factura ya está pagada y FOUND sale false: sin
-- esto, marco_pagada pasaba a false y deshacer el enlace ya no devolvía la
-- factura a pendiente. Un enlace nuevo nace con marco_pagada = false, así que
-- para todo lo demás no cambia nada.
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
    UPDATE public.banco_conciliaciones SET marco_pagada = marco_pagada OR FOUND
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
-- 9. Versión: si existe, las dos migraciones de proformas están puestas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proformas_version()
RETURNS INT
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT 1 $$;

REVOKE ALL ON FUNCTION public.proformas_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proformas_version() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
