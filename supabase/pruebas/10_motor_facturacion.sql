\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- ---- Datos mínimos ---------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'javier@dtfculture.com');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin');
INSERT INTO public.tiendas (id, nombre, serie_factura, siguiente_numero_factura)
  VALUES ('22222222-2222-4222-8222-222222222222', 'DTF Culture', 'A', 1);

\echo '--- 1. Numeración correlativa: tres emisiones seguidas'
SELECT 'factura ' || (public.emitir_factura(
  _usuario_id => '11111111-1111-4111-8111-111111111111',
  _tienda_id  => '22222222-2222-4222-8222-222222222222',
  _receptor   => '{"nombre":"Cliente B2B","nif":"B12345678"}'::jsonb,
  _lineas     => '[{"descripcion":"DTF Textil por metros","cantidad":3.5,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb
) ->> 'numero') FROM generate_series(1,3);

\echo '--- 2. Desglose de IVA y totales de la primera'
SELECT 'referencia ' || public.factura_referencia(serie, ejercicio, numero)
    || ' | base ' || base_imponible || ' | iva ' || iva_total || ' | total ' || total
    || ' | desglose ' || desglose_iva::text
  FROM public.facturas WHERE numero = 1;

\echo '--- 3. El cálculo de siete líneas de 0,15 (debe dar base 1.05 / iva 0.22)'
SELECT 'base ' || (public.factura_calcular((
    SELECT jsonb_agg('{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":0.15,"iva_rate":21}'::jsonb)
    FROM generate_series(1,7))) ->> 'base_imponible')
  || ' | iva ' || (public.factura_calcular((
    SELECT jsonb_agg('{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":0.15,"iva_rate":21}'::jsonb)
    FROM generate_series(1,7))) ->> 'iva_total');

\echo '--- 4. Modificar una factura emitida (debe FALLAR)'
DO $$ BEGIN
  UPDATE public.facturas SET total = 1 WHERE numero = 1;
  RAISE WARNING 'MAL: se ha podido modificar una factura emitida';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN, rechazado: %', SQLERRM;
END $$;

\echo '--- 5. Borrar una factura emitida (debe FALLAR)'
DO $$ BEGIN
  DELETE FROM public.facturas WHERE numero = 1;
  RAISE WARNING 'MAL: se ha podido borrar una factura emitida';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN, rechazado: %', SQLERRM;
END $$;

\echo '--- 6. Anular cambiando el estado (debe FALLAR)'
DO $$ BEGIN
  UPDATE public.facturas SET estado = 'anulada' WHERE numero = 1;
  RAISE WARNING 'MAL: se ha podido anular mutando la fila';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN, rechazado: %', SQLERRM;
END $$;

\echo '--- 7. Marcar como pagada (debe FUNCIONAR)'
SELECT public.factura_cambiar_estado_cobro(
  '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.facturas WHERE numero = 1), 'pagada');
SELECT 'estado ahora: ' || estado FROM public.facturas WHERE numero = 1;

\echo '--- 8. Anular con rectificativa'
SELECT 'rectificativa ' || (public.anular_factura(
  '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.facturas WHERE numero = 2)) ->> 'numero');
SELECT 'la rectificativa: numero ' || numero || ' tipo ' || tipo
    || ' total ' || total || ' rectifica_a ' || (rectifica_a_id IS NOT NULL)::text
  FROM public.facturas WHERE tipo = 'rectificativa';
SELECT 'la original sigue intacta: total ' || total || ' estado ' || estado
  FROM public.facturas WHERE numero = 2;

\echo '--- 9. Huecos en la serie (debe salir vacío)'
SELECT 'HUECO: ' || serie || '-' || numero_ausente FROM public.facturas_huecos_en_serie();

\echo '--- 10. Cadena de auditoría (debe salir vacío)'
SELECT 'ROTA en id ' || id || ': ' || motivo FROM public.auditoria_verificar();

\echo '--- 11. La auditoría registró y con autor'
SELECT 'filas de auditoria: ' || count(*)
    || ' | con autor: ' || count(*) FILTER (WHERE usuario_id IS NOT NULL)
  FROM public.auditoria;

\echo '--- 12. Tres estados del pedido: relleno desde el enum viejo'
INSERT INTO public.pedidos (tienda_id, numero, estado, total)
  VALUES ('22222222-2222-4222-8222-222222222222', 'P-1', 'imprimiendo', 100);
SELECT 'estado=' || estado || ' pago=' || estado_pago
    || ' produccion=' || estado_produccion || ' envio=' || estado_envio
  FROM public.pedidos WHERE numero = 'P-1';

\echo '--- 13. Escribir por la vía nueva deriva el enum viejo'
UPDATE public.pedidos SET estado_envio = 'entregado' WHERE numero = 'P-1';
SELECT 'estado derivado: ' || estado FROM public.pedidos WHERE numero = 'P-1';

\echo '--- 14. Alta con estado cancelado'
INSERT INTO public.pedidos (tienda_id, numero, estado, total)
  VALUES ('22222222-2222-4222-8222-222222222222', 'P-2', 'cancelado', 50);
SELECT 'estado=' || estado || ' cancelado_en=' || (cancelado_en IS NOT NULL)::text
  FROM public.pedidos WHERE numero = 'P-2';

\echo '--- 15. Cancelar por la vía antigua conserva el punto en que estaba'
INSERT INTO public.pedidos (tienda_id, numero, estado, total)
  VALUES ('22222222-2222-4222-8222-222222222222', 'P-3', 'enviado', 70);
UPDATE public.pedidos SET estado = 'cancelado' WHERE numero = 'P-3';
SELECT 'produccion=' || estado_produccion || ' envio=' || estado_envio
    || ' cancelado=' || (cancelado_en IS NOT NULL)::text
  FROM public.pedidos WHERE numero = 'P-3';
