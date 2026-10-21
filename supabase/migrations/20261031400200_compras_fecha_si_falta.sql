-- ============================================================================
-- Una compra registrada sin fecha puede recibir su fecha (una sola vez)
-- ============================================================================
--
-- EL PROBLEMA
--   Ocho facturas de compra se registraron sin fecha (subidas del 7 al 9 de
--   octubre de 2026, antes de que el registro la exigiera). Sin fecha no caen
--   en ningún trimestre: su IVA (200,19 €) no se deduce en ningún 303 y su
--   gasto no sale en Gerencia. compra_registrada_cabecera() prohíbe cambiar
--   «fecha» en una compra registrada, también de vacía a una fecha, así que no
--   había forma de completarla.
--
-- QUÉ HACE
--   Recrea compra_registrada_cabecera() igual que en 20261029100100, con un
--   solo cambio: «fecha» sale de la lista de campos que no cambian nunca y
--   pasa a la de «solo de nulo a un valor» (como proveedor_id o fichero_ruta).
--   Además, la fecha que se pone no puede ser posterior a hoy (lo mismo que
--   exige el registro). Una fecha ya puesta sigue sin poder cambiarse.
--
-- QUÉ NO CAMBIA
--   Todo lo demás de la función: borrar, volver a borrador, el resto de
--   campos, gasto_id, borrada_en. Ni datos: la fecha de cada factura la pone
--   Javier a mano, una a una, con la del PDF.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031400200_compras_fecha_si_falta.sql
-- (repone la función de 20261029100100). No toca datos.
--
-- PRUEBA: supabase/pruebas/D3_compras_fecha_si_falta.sql
-- ============================================================================

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

  FOREACH k IN ARRAY ARRAY['empresa_id', 'proveedor', 'nif_proveedor', 'numero', 'base',
                           'iva', 'irpf', 'total', 'categoria', 'lectura_ia', 'cuota_iva',
                           'cuota_irpf', 'liquido', 'tipo_documento', 'proforma_id',
                           'casado_resumen']
  LOOP
    IF (v_viejo -> k) IS DISTINCT FROM (v_nuevo -> k) THEN
      RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, k
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  -- Solo de nulo a un valor. «fecha», desde 20261031400200: hubo compras
  -- registradas sin fecha, que no contaban en ningún trimestre.
  FOREACH k IN ARRAY ARRAY['proveedor_id', 'fichero_ruta', 'fichero_huella', 'fecha']
  LOOP
    v_antes := NULLIF(v_viejo -> k, 'null'::JSONB);
    v_despues := NULLIF(v_nuevo -> k, 'null'::JSONB);
    IF v_antes IS DISTINCT FROM v_despues AND v_antes IS NOT NULL THEN
      RAISE EXCEPTION 'La factura % ya está registrada: «%» no se puede cambiar.', v_numero, k
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  -- La fecha que se completa no puede ser posterior a hoy (como al registrar).
  IF (v_viejo -> 'fecha') IS DISTINCT FROM (v_nuevo -> 'fecha')
     AND (v_nuevo ->> 'fecha')::DATE > (now() AT TIME ZONE 'Europe/Madrid')::DATE THEN
    RAISE EXCEPTION 'La fecha de la factura % (%) es posterior a hoy.', v_numero,
      to_char((v_nuevo ->> 'fecha')::DATE, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;

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
  'Una compra registrada no cambia sus datos de factura (la fecha solo se completa si faltaba), '
  'no vuelve a borrador y no se borra; y solo pasa a registrada dentro de las funciones de registro.';
