-- ============================================================================
-- Reponer factura_comprobar_fecha(): sin ella no se emite ninguna factura
-- ============================================================================
--
-- EL PROBLEMA
--   En producción, al crear una factura o un ticket sale:
--     function public.factura_comprobar_fecha(uuid, text, integer, date)
--     does not exist
--
--   La función la creó 20260903140000_facturas_orden_cronologico.sql, que no
--   llegó a aplicarse. La de tickets (20261004100100) sí, y su
--   emitir_factura() y emitir_factura_textil() la llaman antes de numerar.
--   Sin ella, toda emisión falla.
--
-- POR QUÉ NO VOLVER A APLICAR LA MIGRACIÓN VIEJA
--   Además de crear la función, reescribe emitir_factura() y
--   emitir_factura_textil() con su versión de entonces, sin tickets. Aplicarla
--   ahora pisaría las de 20261004100100 y rompería los tickets. Esta solo
--   crea la función que falta, idéntica a la original.
--
-- QUÉ HACE
--   Impide emitir con fecha anterior a la de la última factura de la misma
--   serie y año, mirando las dos tablas que comparten numeración. Mismo día,
--   sí. Hacia atrás, no: el número y la fecha tienen que contar la misma
--   historia.
--
-- REVERSIBLE
--   Sí, pero no hay que revertirla: sin ella no se puede facturar.
--   Se puede aplicar más de una vez sin cambiar nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.factura_comprobar_fecha(
  _empresa_id UUID, _serie TEXT, _ejercicio INT, _fecha DATE
) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ultima DATE;
BEGIN
  SELECT max(f.fecha) INTO v_ultima FROM (
    SELECT fecha, empresa_id, serie, ejercicio FROM public.facturas
    UNION ALL
    SELECT fecha, empresa_id, serie, ejercicio FROM public.textil_facturas
  ) f
  WHERE f.empresa_id = _empresa_id AND f.serie = _serie AND f.ejercicio = _ejercicio;

  IF v_ultima IS NOT NULL AND _fecha < v_ultima THEN
    RAISE EXCEPTION
      'No se puede emitir con fecha % : la última factura de la serie es del %. '
      'La numeración es correlativa y las fechas tienen que acompañarla.',
      to_char(_fecha, 'DD/MM/YYYY'), to_char(v_ultima, 'DD/MM/YYYY');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) IS
  'Impide emitir con fecha anterior a la última de la serie. Mira las dos '
  'tablas de factura, que comparten numeración.';

-- Solo la llaman emitir_factura() y emitir_factura_textil(), que son SECURITY
-- DEFINER: nadie tiene que poder llamarla desde fuera.
REVOKE EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factura_comprobar_fecha(UUID, TEXT, INT, DATE) TO service_role;
