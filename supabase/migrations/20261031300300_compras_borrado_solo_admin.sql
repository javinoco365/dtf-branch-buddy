-- ============================================================================
-- Borrar una factura recibida ya registrada: solo un admin (hallazgo R2)
-- ============================================================================
--
-- EL FALLO
--   Una compra registrada no se borra de verdad: se marca con
--   UPDATE textil_compras SET borrada_en = now(). Para la base eso es un
--   UPDATE, y la política «compras edicion» solo exige rol_puede_escribir():
--   un editor podía «borrar» la factura con su sesión desde el navegador,
--   saltándose la regla «un editor no borra» (borrarCompra la reserva al admin
--   con exigeBorrar, pero esa comprobación solo vive en el servidor). La
--   factura dejaba de contar en Gerencia, en Fiscal y en la conciliación.
--
--   Una política no ve el valor de antes (OLD), así que no puede distinguir
--   «poner borrada_en» de cualquier otra edición.
--
-- QUÉ HACE
--   Un trigger BEFORE UPDATE en textil_compras: si borrada_en cambia, exige
--   'borrar' a quien lo hace con rol_exigir_quien(NULL, 'borrar') (el
--   usuario del JWT y el autor de auditoria_autor()). Sin nadie
--   identificado (sistema, migración) deja pasar, como la guardia.
--   Cubre los dos sentidos: poner la fecha (borrar) y quitarla (restaurar).
--   Quitarla ya lo impide compra_registrada_cabecera() para las registradas;
--   aquí cuenta además para los borradores.
--
--   No cambia ninguna política ni el borrado de los borradores, que es un
--   DELETE y ya exige rol_puede_borrar().
--
-- DEPENDE DE 20261031200100 (rol_exigir_quien).
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031300300_compras_borrado_solo_admin.sql
-- (quita el trigger y su función).
-- ============================================================================

-- Compara con to_jsonb() y no con NEW.borrada_en, y el trigger no es
-- «UPDATE OF borrada_en»: así no depende de la columna, y revertir
-- 20261014100000 (que la quita) no choca con él. Sin la columna no hace nada.
CREATE OR REPLACE FUNCTION public.textil_compras_borrado_solo_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (to_jsonb(NEW) -> 'borrada_en') IS DISTINCT FROM (to_jsonb(OLD) -> 'borrada_en') THEN
    -- rol_exigir_quien() es SECURITY DEFINER: mira el JWT y el autor aunque
    -- quien escribe no pueda leer user_roles.
    PERFORM public.rol_exigir_quien(NULL, 'borrar');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.textil_compras_borrado_solo_admin() IS
  'Marcar (o desmarcar) una compra como borrada es borrar: solo un admin.';

DROP TRIGGER IF EXISTS textil_compras_borrado_solo_admin ON public.textil_compras;
CREATE TRIGGER textil_compras_borrado_solo_admin
  BEFORE UPDATE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.textil_compras_borrado_solo_admin();

REVOKE EXECUTE ON FUNCTION public.textil_compras_borrado_solo_admin() FROM PUBLIC, anon;
