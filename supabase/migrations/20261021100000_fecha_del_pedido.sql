-- ============================================================================
-- Tickets y facturas con la fecha del pedido, aunque la serie vaya por delante
-- ============================================================================
--
-- EL PROBLEMA
--   emitir_factura() y emitir_factura_textil() llaman a
--   factura_comprobar_fecha(), que rechaza una fecha anterior a la del último
--   documento de la serie y año. Al emitir el ticket de un pedido antiguo
--   cuando ya hay otro posterior, salía:
--     No se puede emitir con fecha 19/09/2026 : la última factura de la serie
--     es del 07/10/2026.
--   La aplicación lo esquivaba emitiendo con la fecha de ese último y dejando
--   la del pedido en las notas como fecha de la operación.
--
-- LA DECISIÓN (Javier, 8-10-2026)
--   El ticket y la factura de un pedido salen siempre con la fecha del pedido.
--   Es inamovible. Las facturas que se presentan a Hacienda las hace la
--   gestoría; las del CRM son el control interno de DTI.
--
-- QUÉ HACE
--   Deja factura_comprobar_fecha() sin efecto: ya no rechaza ninguna fecha.
--   Se queda la función, vacía, porque emitir_factura() y
--   emitir_factura_textil() la siguen llamando; así no hay que tocarlas.
--   La numeración no cambia: sigue correlativa por serie, sin huecos y bajo
--   bloqueo. Lo que cambia es que un número posterior puede llevar una fecha
--   anterior (la 2026/0005 del 19/09 después de la 2026/0004 del 07/10).
--
-- OJO A PARTIR DEL 1 DE ENERO DE 2027 (Verifactu)
--   Si estos documentos se envían algún día a la AEAT, hay que revisarlo: en
--   una serie que se declara, el número y la fecha tienen que ir en orden.
--
-- REVERSIBLE
--   Sí: volver a aplicar 20261009100000_reponer_factura_comprobar_fecha.sql
--   repone la comprobación tal cual. No toca datos. Se puede aplicar dos veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.factura_comprobar_fecha(
  _empresa_id UUID, _serie TEXT, _ejercicio INT, _fecha DATE
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sin comprobación: el documento lleva la fecha de su pedido aunque la
  -- serie tenga otro posterior (decisión de Javier, 8-10-2026).
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) IS
  'Sin efecto desde 20261021100000: los documentos llevan la fecha de su pedido aunque la '
  'serie tenga uno posterior. Se mantiene porque emitir_factura() y emitir_factura_textil() la llaman.';

REVOKE EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) TO service_role;
