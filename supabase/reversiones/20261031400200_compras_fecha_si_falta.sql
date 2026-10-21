-- ============================================================================
-- REVERSIÓN de 20261031400200_compras_fecha_si_falta.sql
-- ============================================================================
-- Repone compra_registrada_cabecera() tal como la dejó 20261029100100: la
-- fecha de una compra registrada vuelve a no poder cambiarse, ni de vacía a
-- una fecha. Las fechas que ya se hayan completado se quedan. No toca datos.
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
