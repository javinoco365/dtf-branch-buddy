-- ============================================================================
-- REVERSIÓN de 20261029100100_proformas_compras.sql
-- ============================================================================
-- La primera de las dos reversiones de proformas (después, la de
-- 20261029100000, que no hace nada). Solo con autorización expresa de Javier.
--
-- SE NIEGA si hay alguna compra de tipo proforma, alguna factura casada
-- (proforma_id) o algún movimiento de stock «ajuste_coste»: sin las columnas
-- y las reglas de esta migración, esas filas contarían mal (la proforma como
-- factura en el IVA, el ajuste como un movimiento sin valor). Lo comprueba al
-- principio y se niega al final, en una sola sentencia: así, si se niega,
-- sale un único error y la transacción entera se deshace (no queda nada a
-- medias).
--
-- Repone, copiadas tal cual: compra_registrada_cabecera(),
-- stock_aplicar_movimiento(), stock_compra_solo_por_registro(),
-- textil_compra_guardar_y_registrar() y textil_compra_registrar() de
-- 20261028100200_escaner_textil_reglas.sql; banco_enlazar_como() y
-- banco_aplicar_efectos() de 20261017100000_conciliacion_motor.sql; banco_documentos(),
-- banco_documentos_por_conciliar() (borrar y crear: cambia el tipo de
-- retorno) y banco_enlaces() de 20261025100000_conciliacion_pendientes.sql;
-- con sus permisos. Repone los CHECK stock_movimiento_no_cero,
-- stock_movimiento_signo y stock_compra_id_motivo como estaban y el índice
-- textil_compras_factura_unica con su definición de 20261015100000.
--
-- Quita: el trigger y la función compra_proforma_solo_por_registro,
-- textil_stock_destino(), proforma_entradas(), compras_proformas_pendientes(),
-- proformas_version(), los índices y CHECK nuevos y las columnas
-- tipo_documento, proforma_id, casado_resumen (textil_compras), linea_papel
-- (textil_compra_lineas) e importe_ajuste (textil_stock_movimientos). Se
-- pierde la agrupación por línea del papel de las compras ya registradas; los
-- importes y las unidades no cambian.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ¿Hay algo que solo se entiende con esta migración? (se mira ahora, antes de
-- quitar las columnas; se niega al final)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v BOOLEAN := false;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'textil_compras'
                AND column_name = 'tipo_documento') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.textil_compras
                             WHERE tipo_documento = ''proforma'' OR proforma_id IS NOT NULL)'
       INTO v;
  END IF;
  IF NOT v THEN
    SELECT EXISTS (SELECT 1 FROM public.textil_stock_movimientos
                    WHERE motivo::TEXT = 'ajuste_coste') INTO v;
  END IF;
  PERFORM set_config('proformas.reversion_se_niega', CASE WHEN v THEN '1' ELSE '' END, true);
END $$;

-- ---------------------------------------------------------------------------
-- Lo nuevo, fuera
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.proformas_version();
DROP FUNCTION IF EXISTS public.compras_proformas_pendientes();
DROP FUNCTION IF EXISTS public.proforma_entradas(UUID);
DROP FUNCTION IF EXISTS public.textil_stock_destino(UUID);

DROP TRIGGER IF EXISTS textil_compras_proforma_solo_por_registro ON public.textil_compras;
DROP FUNCTION IF EXISTS public.compra_proforma_solo_por_registro();

DROP INDEX IF EXISTS public.textil_compras_proforma_casada_unica;
DROP INDEX IF EXISTS public.textil_compras_proformas_abiertas;
DROP INDEX IF EXISTS public.textil_compras_factura_unica;

ALTER TABLE public.textil_compras
  DROP CONSTRAINT IF EXISTS compra_tipo_documento,
  DROP CONSTRAINT IF EXISTS compra_proforma_solo_factura,
  DROP CONSTRAINT IF EXISTS compra_proforma_no_ella_misma,
  DROP CONSTRAINT IF EXISTS compra_casado_con_proforma;
ALTER TABLE public.textil_compra_lineas DROP CONSTRAINT IF EXISTS compra_linea_papel;
ALTER TABLE public.textil_stock_movimientos
  DROP CONSTRAINT IF EXISTS stock_ajuste_coste_completo,
  DROP CONSTRAINT IF EXISTS stock_movimiento_no_cero,
  DROP CONSTRAINT IF EXISTS stock_movimiento_signo,
  DROP CONSTRAINT IF EXISTS stock_compra_id_motivo;

-- banco_documentos() y banco_documentos_por_conciliar() vuelven a su tipo de
-- retorno de antes: se borran y se crean (más abajo).
DROP FUNCTION IF EXISTS public.banco_documentos_por_conciliar();
DROP FUNCTION IF EXISTS public.banco_documentos();

ALTER TABLE public.textil_compras
  DROP COLUMN IF EXISTS casado_resumen,
  DROP COLUMN IF EXISTS proforma_id,
  DROP COLUMN IF EXISTS tipo_documento;
ALTER TABLE public.textil_compra_lineas DROP COLUMN IF EXISTS linea_papel;
ALTER TABLE public.textil_stock_movimientos DROP COLUMN IF EXISTS importe_ajuste;

-- ---------------------------------------------------------------------------
-- Copiadas tal cual de 20261028100200_escaner_textil_reglas.sql
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
-- Copiadas tal cual de 20261025100000_conciliacion_pendientes.sql
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_documentos()
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
  conciliable BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT 'compra'::TEXT, c.id, c.empresa_id, c.fecha, c.liquido::NUMERIC,
         c.proveedor, c.nif_proveedor, NULL::TEXT, NULL::INTEGER, c.numero,
         c.estado = 'registrada' AND c.borrada_en IS NULL
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
                                       WHERE b.factura_id = r.id)))
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
                                       WHERE b.textil_factura_id = r.id)))
    FROM public.textil_facturas t
$$;

COMMENT ON FUNCTION public.banco_documentos() IS
  'Documentos que se concilian con el banco, con la misma forma: compra (importe = líquido), '
  'factura (total) y textil (total). conciliable: si el motor puede proponerlo (queda algo que '
  'cobrar o pagar por el banco: ni pagada, ni ticket canjeado o canje de un ticket cobrado, ni '
  'anulada entera sin pasar por el banco). Solo lectura, con la RLS de quien llama.';

-- 2. Lo que todavía se puede conciliar
CREATE OR REPLACE FUNCTION public.banco_documentos_por_conciliar()
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
  numero TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT d.tipo, d.id, d.empresa_id, d.fecha, d.importe, d.contraparte, d.nif,
         d.serie, d.ejercicio, d.numero
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
                   'ejercicio', d.ejercicio, 'numero', d.numero)
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

-- ---------------------------------------------------------------------------
-- Copiadas tal cual de 20261017100000_conciliacion_motor.sql
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

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Se niega aquí, o repone los CHECK y el índice de antes. Es la última
-- sentencia antes del COMMIT: si se niega, es el único error y el COMMIT
-- deshace la transacción entera (también el NOTIFY).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('proformas.reversion_se_niega', true) = '1' THEN
    RAISE EXCEPTION 'La reversión de proformas se niega: hay proformas registradas, facturas casadas con una proforma o ajustes de coste en el libro de stock. Sin esta migración contarían mal.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- De 20260903200000_stock_movimientos.sql
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_movimiento_no_cero CHECK (cantidad <> 0),
    ADD CONSTRAINT stock_movimiento_signo CHECK (
      (motivo IN ('compra', 'devolucion_cliente', 'inicial') AND cantidad > 0)
      OR (motivo IN ('venta', 'devolucion_proveedor', 'merma') AND cantidad < 0)
      OR motivo = 'ajuste_inventario'   -- el recuento puede ir en los dos sentidos
    );
  -- De 20261028100200_escaner_textil_reglas.sql
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_compra_id_motivo
      CHECK (compra_id IS NULL OR motivo IN ('compra', 'devolucion_proveedor'));
  -- De 20261015100000_compras_cola.sql
  CREATE UNIQUE INDEX IF NOT EXISTS textil_compras_factura_unica
    ON public.textil_compras (empresa_id, proveedor_clave, numero_clave)
    WHERE estado = 'registrada' AND borrada_en IS NULL
      AND proveedor_clave <> '' AND numero_clave <> '';
END $$;

COMMIT;
