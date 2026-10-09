-- ============================================================================
-- ¿Qué migraciones de octubre están aplicadas en esta base?
-- ============================================================================
-- Solo lee. Pégalo en el editor SQL de Supabase: una fila por migración, con
-- «sí» o «no». Sirve después de aplicar cada una, para comprobar que entró.

SELECT migracion, CASE WHEN aplicada THEN 'sí' ELSE 'no' END AS aplicada
FROM (VALUES
  ('20261021100000_fecha_del_pedido',
   coalesce(obj_description('public.factura_comprobar_fecha(uuid,text,integer,date)'::regprocedure, 'pg_proc'), '')
     LIKE 'Sin efecto desde 20261021100000%'),
  ('20261022100000_facturas_numero_por_ejercicio',
   EXISTS (SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.facturas'::regclass
              AND conname = 'facturas_tienda_id_serie_ejercicio_numero_key')),
  ('20261023100000_politicas_por_operacion',
   NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL')),
  ('20261023110000_auditoria_tablas_pendientes',
   EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'public.series_facturacion'::regclass
              AND tgname = 'series_facturacion_auditoria')),
  ('20261023120000_facturas_ejercicio_obligatorio',
   (SELECT attnotnull FROM pg_attribute
     WHERE attrelid = 'public.facturas'::regclass AND attname = 'ejercicio')),
  ('20261024100000_woo_sincronizacion',
   to_regclass('public.woo_sincronizacion') IS NOT NULL),
  ('20261024110000_woo_sincronizacion_turno',
   EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'woo_sincronizacion_tomar')),
  ('20261025100000_conciliacion_pendientes',
   EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'banco_documentos_por_conciliar'))
) AS m(migracion, aplicada)
ORDER BY migracion;
