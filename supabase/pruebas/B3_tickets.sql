-- ============================================================================
-- Tickets: factura simplificada, límites, un documento por pedido y canje
-- ============================================================================
-- Usa el usuario administrador y la tienda DTF Culture de 10_motor_facturacion.

INSERT INTO public.pedidos (id, tienda_id, numero, total)
VALUES ('b3b3b3b3-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'P-TICKET-1', 36.30),
       ('b3b3b3b3-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'P-TICKET-2', 60.50);

INSERT INTO public.clientes (id, tienda_id, nombre, email, tipo_fiscal)
VALUES ('b3b3b3b3-0000-4000-8000-0000000000c1', '22222222-2222-4222-8222-222222222222',
        'Vecina particular', 'vecina@example.com', 'particular');

INSERT INTO public.textil_pedidos (id, numero, estado)
VALUES ('b3b3b3b3-0000-4000-8000-0000000000d1', 'TPD-TICKET-1', 'pendiente');

-- 1. La serie de tickets es T y serie_estado la enseña.
SELECT CASE WHEN public.empresa_serie(public.empresa_por_defecto(), 'simplificada') = 'T'
             AND EXISTS (SELECT 1 FROM public.serie_estado(public.empresa_por_defecto())
                          WHERE tipo = 'simplificada' AND serie = 'T')
            THEN 'BIEN  1. la serie de tickets es T y aparece en serie_estado'
            ELSE 'MAL   1. serie de tickets' END;

-- 2. Un ticket sin datos del cliente: T<año>/0001, pagado, sin receptor.
SELECT set_config('prueba.t1', (public.emitir_factura(
  _usuario_id   => '11111111-1111-4111-8111-111111111111',
  _tienda_id    => '22222222-2222-4222-8222-222222222222',
  _receptor     => NULL,
  _lineas       => '[{"descripcion":"Metro DTF","cantidad":2,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
  _simplificada => true
) ->> 'id'), false) \g /dev/null

SELECT CASE WHEN tipo = 'simplificada' AND estado = 'pagada' AND total = 36.30
             AND public.factura_referencia(serie, ejercicio, numero)
                 = 'T' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT || '/0001'
             AND cliente_nombre IS NULL AND cliente_nif IS NULL
            THEN 'BIEN  2. el ticket sale T' || ejercicio || '/0001, pagado y sin datos del cliente'
            ELSE 'MAL   2. ticket: ' || tipo || ' ' || serie || numero || ' ' || estado END
FROM public.facturas WHERE id = current_setting('prueba.t1')::UUID;

-- 3. Más de 400 € sin saber quién es: rechazado.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => '22222222-2222-4222-8222-222222222222',
    _receptor     => '{}'::jsonb,
    _lineas       => '[{"descripcion":"Rollo","cantidad":1,"unidad":"ud","precio_unitario":400,"iva_rate":21}]'::jsonb,
    _simplificada => true);
  RAISE WARNING 'MAL   3. ticket de 484 € sin tipo fiscal aceptado';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%400,00%' THEN
    RAISE NOTICE 'BIEN  3. más de 400 € sin saber si es particular: rechazado';
  ELSE
    RAISE WARNING 'MAL   3. rechazado por otra cosa: %', SQLERRM;
  END IF;
END $$;

-- 4. El mismo importe a un particular: sale, y el tipo fiscal queda congelado.
--    (En dos sentencias: la consulta que llama a la función no ve lo que esta
--    inserta.)
SELECT set_config('prueba.t4', (public.emitir_factura(
  _usuario_id   => '11111111-1111-4111-8111-111111111111',
  _tienda_id    => '22222222-2222-4222-8222-222222222222',
  _receptor     => '{"tipo_fiscal":"particular"}'::jsonb,
  _lineas       => '[{"descripcion":"Rollo","cantidad":1,"unidad":"ud","precio_unitario":400,"iva_rate":21}]'::jsonb,
  _simplificada => true) ->> 'id'), false) \g /dev/null
SELECT CASE WHEN tipo = 'simplificada' AND numero = 2 AND total = 484
             AND receptor_snapshot ->> 'tipo_fiscal' = 'particular'
            THEN 'BIEN  4. a un particular llega a 484 €, y queda escrito por qué'
            ELSE 'MAL   4. ' || numero || ' ' || receptor_snapshot::TEXT END
FROM public.facturas WHERE id = current_setting('prueba.t4')::UUID;

-- 5. Ni a un particular por encima de 3000 €.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => '22222222-2222-4222-8222-222222222222',
    _receptor     => '{"tipo_fiscal":"particular"}'::jsonb,
    _lineas       => '[{"descripcion":"Pedido grande","cantidad":1,"unidad":"ud","precio_unitario":2500,"iva_rate":21}]'::jsonb,
    _simplificada => true);
  RAISE WARNING 'MAL   5. ticket de 3025 € a un particular aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN  5. a un particular, no más de 3000 €';
END $$;

-- 6. El tipo fiscal sale de la ficha del cliente si no viene en el receptor.
SELECT set_config('prueba.t6', (public.emitir_factura(
  _usuario_id   => '11111111-1111-4111-8111-111111111111',
  _tienda_id    => '22222222-2222-4222-8222-222222222222',
  _receptor     => '{"nombre":"Vecina particular"}'::jsonb,
  _lineas       => '[{"descripcion":"Camisetas","cantidad":10,"unidad":"ud","precio_unitario":80,"iva_rate":21}]'::jsonb,
  _cliente_id   => 'b3b3b3b3-0000-4000-8000-0000000000c1',
  _simplificada => true) ->> 'id'), false) \g /dev/null
SELECT CASE WHEN receptor_snapshot ->> 'tipo_fiscal' = 'particular' AND total = 968
             AND cliente_nombre = 'Vecina particular'
            THEN 'BIEN  6. el cliente marcado como particular llega a 3000 € sin repetirlo'
            ELSE 'MAL   6. ' || receptor_snapshot::TEXT END
FROM public.facturas WHERE id = current_setting('prueba.t6')::UUID;

-- 7. Los rechazos no se comen números: el siguiente ticket es el 4.
SELECT CASE WHEN (r ->> 'referencia') LIKE 'T%/0004'
            THEN 'BIEN  7. los tickets rechazados no dejan hueco en la serie'
            ELSE 'MAL   7. ' || (r ->> 'referencia') END
FROM (SELECT public.emitir_factura(
  _usuario_id   => '11111111-1111-4111-8111-111111111111',
  _tienda_id    => '22222222-2222-4222-8222-222222222222',
  _receptor     => NULL,
  _lineas       => '[{"descripcion":"Metro DTF","cantidad":5,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
  _pedido_id    => 'b3b3b3b3-0000-4000-8000-000000000002',
  _simplificada => true) AS r) x;

-- 8. Un pedido, un documento: ni otro ticket ni una factura para el mismo.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => '22222222-2222-4222-8222-222222222222',
    _receptor     => NULL,
    _lineas       => '[{"descripcion":"Metro DTF","cantidad":5,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _pedido_id    => 'b3b3b3b3-0000-4000-8000-000000000002',
    _simplificada => true);
  RAISE WARNING 'MAL  8a. dos tickets para el mismo pedido';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 8a. el mismo pedido no saca dos tickets';
END $$;
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => '22222222-2222-4222-8222-222222222222',
    _receptor   => '{"nombre":"Talleres","nif":"B11111111"}'::jsonb,
    _lineas     => '[{"descripcion":"Metro DTF","cantidad":5,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _pedido_id  => 'b3b3b3b3-0000-4000-8000-000000000002');
  RAISE WARNING 'MAL  8b. factura además del ticket para el mismo pedido';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 8b. con ticket emitido, el pedido no admite otra factura';
END $$;

-- 9. Anulado el ticket con su rectificativa, el pedido admite documento nuevo.
SELECT public.anular_factura('11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.facturas
    WHERE pedido_id = 'b3b3b3b3-0000-4000-8000-000000000002' AND tipo = 'simplificada')) \g /dev/null
SELECT CASE WHEN (r ->> 'tipo') = 'simplificada'
            THEN 'BIEN  9. rectificado el ticket, el pedido vuelve a admitir uno'
            ELSE 'MAL   9. ' || r::TEXT END
FROM (SELECT public.emitir_factura(
  _usuario_id   => '11111111-1111-4111-8111-111111111111',
  _tienda_id    => '22222222-2222-4222-8222-222222222222',
  _receptor     => NULL,
  _lineas       => '[{"descripcion":"Metro DTF","cantidad":5,"unidad":"m","precio_unitario":10,"iva_rate":21}]'::jsonb,
  _pedido_id    => 'b3b3b3b3-0000-4000-8000-000000000002',
  _simplificada => true) AS r) x;

-- 10. Canje: sin NIF o con otro importe, no.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id     => '11111111-1111-4111-8111-111111111111',
    _tienda_id      => '22222222-2222-4222-8222-222222222222',
    _receptor       => '{"nombre":"Talleres Perez"}'::jsonb,
    _lineas         => '[{"descripcion":"Metro DTF","cantidad":2,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
    _sustituye_a_id => current_setting('prueba.t1')::UUID);
  RAISE WARNING 'MAL 10a. canje sin NIF aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 10a. el canje pide el NIF del cliente';
END $$;
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id     => '11111111-1111-4111-8111-111111111111',
    _tienda_id      => '22222222-2222-4222-8222-222222222222',
    _receptor       => '{"nombre":"Talleres Perez","nif":"B22222222"}'::jsonb,
    _lineas         => '[{"descripcion":"Metro DTF","cantidad":3,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
    _sustituye_a_id => current_setting('prueba.t1')::UUID);
  RAISE WARNING 'MAL 10b. canje por otro importe aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 10b. el canje tiene que sumar lo mismo que el ticket';
END $$;

-- 11. Canje correcto: factura ordinaria que apunta al ticket; el ticket intacto.
SELECT set_config('prueba.canje', (public.emitir_factura(
  _usuario_id     => '11111111-1111-4111-8111-111111111111',
  _tienda_id      => '22222222-2222-4222-8222-222222222222',
  _receptor       => '{"nombre":"Talleres Perez","nif":"B22222222","direccion":"C/ Mayor 1"}'::jsonb,
  _lineas         => '[{"descripcion":"Metro DTF","cantidad":2,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
  _sustituye_a_id => current_setting('prueba.t1')::UUID
) ->> 'id'), false) \g /dev/null
SELECT CASE WHEN c.tipo = 'ordinaria' AND c.sustituye_a_id = t.id AND c.total = t.total
             AND c.cliente_nif = 'B22222222' AND t.tipo = 'simplificada' AND t.cliente_nif IS NULL
            THEN 'BIEN 11. el ticket se canjea por una factura nueva y él no cambia'
            ELSE 'MAL  11. canje' END
FROM public.facturas c JOIN public.facturas t ON t.id = current_setting('prueba.t1')::UUID
WHERE c.id = current_setting('prueba.canje')::UUID;

-- 12. Un ticket se canjea una vez, y solo se canjean tickets.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id     => '11111111-1111-4111-8111-111111111111',
    _tienda_id      => '22222222-2222-4222-8222-222222222222',
    _receptor       => '{"nombre":"Talleres Perez","nif":"B22222222"}'::jsonb,
    _lineas         => '[{"descripcion":"Metro DTF","cantidad":2,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
    _sustituye_a_id => current_setting('prueba.t1')::UUID);
  RAISE WARNING 'MAL 12a. ticket canjeado dos veces';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 12a. un ticket se canjea una sola vez';
END $$;
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id     => '11111111-1111-4111-8111-111111111111',
    _tienda_id      => '22222222-2222-4222-8222-222222222222',
    _receptor       => '{"nombre":"Talleres Perez","nif":"B22222222"}'::jsonb,
    _lineas         => '[{"descripcion":"Metro DTF","cantidad":2,"unidad":"m","precio_unitario":15,"iva_rate":21}]'::jsonb,
    _sustituye_a_id => current_setting('prueba.canje')::UUID);
  RAISE WARNING 'MAL 12b. se ha canjeado una factura ordinaria';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 12b. solo se canjean tickets';
END $$;

-- 13. Combinaciones sin sentido: rechazadas.
DO $$ BEGIN
  PERFORM public.emitir_factura(
    _usuario_id     => '11111111-1111-4111-8111-111111111111',
    _tienda_id      => '22222222-2222-4222-8222-222222222222',
    _receptor       => NULL,
    _lineas         => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":1,"iva_rate":21}]'::jsonb,
    _simplificada   => true,
    _sustituye_a_id => current_setting('prueba.t1')::UUID);
  RAISE WARNING 'MAL  13. ticket que sustituye a un ticket';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 13. un ticket no sustituye a otro ticket';
END $$;

-- 14. El canje es contenido fiscal: no se cambia después.
DO $$ BEGIN
  UPDATE public.facturas SET sustituye_a_id = NULL
   WHERE id = current_setting('prueba.canje')::UUID;
  RAISE WARNING 'MAL  14. se ha podido deshacer el canje con un UPDATE';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 14. el canje no se modifica';
END $$;

-- 15. Textil comparte la serie T y respeta el pedido.
SELECT set_config('prueba.tt', (public.emitir_factura_textil(
  _usuario_id       => '11111111-1111-4111-8111-111111111111',
  _receptor         => NULL,
  _lineas           => '[{"descripcion":"Camiseta","cantidad":3,"precio_unitario":10,"iva_rate":21}]'::jsonb,
  _simplificada     => true,
  _textil_pedido_id => 'b3b3b3b3-0000-4000-8000-0000000000d1') ->> 'id'), false) \g /dev/null
SELECT CASE WHEN tipo = 'simplificada' AND numero LIKE 'T%/0006' AND estado = 'pagada'
             AND textil_pedido_id = 'b3b3b3b3-0000-4000-8000-0000000000d1'
            THEN 'BIEN 15. el ticket textil sigue la misma serie T y apunta a su pedido'
            ELSE 'MAL  15. ' || numero || ' ' || estado END
FROM public.textil_facturas WHERE id = current_setting('prueba.tt')::UUID;

DO $$ BEGIN
  PERFORM public.emitir_factura_textil(
    _usuario_id       => '11111111-1111-4111-8111-111111111111',
    _receptor         => NULL,
    _lineas           => '[{"descripcion":"Camiseta","cantidad":3,"precio_unitario":10,"iva_rate":21}]'::jsonb,
    _simplificada     => true,
    _textil_pedido_id => 'b3b3b3b3-0000-4000-8000-0000000000d1');
  RAISE WARNING 'MAL  16. dos tickets para el mismo pedido textil';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 16. el pedido textil tampoco saca dos tickets';
END $$;

-- 17. Canje en textil: la factura hereda el pedido del ticket.
SELECT set_config('prueba.tc', (public.emitir_factura_textil(
  _usuario_id     => '11111111-1111-4111-8111-111111111111',
  _receptor       => '{"nombre":"Club deportivo","nif":"G33333333"}'::jsonb,
  _lineas         => '[{"descripcion":"Camiseta","cantidad":3,"precio_unitario":10,"iva_rate":21}]'::jsonb,
  _sustituye_a_id => current_setting('prueba.tt')::UUID) ->> 'id'), false) \g /dev/null
SELECT CASE WHEN f.tipo = 'ordinaria' AND f.sustituye_a_id = t.id
             AND f.textil_pedido_id = t.textil_pedido_id
            THEN 'BIEN 17. canje textil: factura nueva, mismo pedido'
            ELSE 'MAL  17. canje textil' END
FROM public.textil_facturas f
JOIN public.textil_facturas t ON t.id = current_setting('prueba.tt')::UUID
WHERE f.id = current_setting('prueba.tc')::UUID;

-- 18. Los límites y la serie se configuran, pero con cabeza.
DO $$ BEGIN
  UPDATE public.empresas SET serie_simplificada = serie_rectificativa
   WHERE id = public.empresa_por_defecto();
  RAISE WARNING 'MAL 18a. serie de tickets igual a la de rectificativas';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 18a. la serie de tickets no puede coincidir con otra';
END $$;
DO $$ BEGIN
  UPDATE public.empresas SET limite_simplificada = 5000
   WHERE id = public.empresa_por_defecto();
  RAISE WARNING 'MAL 18b. límite general por encima del de particulares';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 18b. el límite general no pasa del de particulares';
END $$;
DO $$ BEGIN
  UPDATE public.clientes SET tipo_fiscal = 'autonomo'
   WHERE id = 'b3b3b3b3-0000-4000-8000-0000000000c1';
  RAISE WARNING 'MAL 18c. tipo fiscal inventado aceptado';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BIEN 18c. el tipo fiscal es particular o profesional';
END $$;

-- 19. Nadie sin permiso de servicio emite tickets directamente.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.emitir_factura(
    _usuario_id   => '11111111-1111-4111-8111-111111111111',
    _tienda_id    => '22222222-2222-4222-8222-222222222222',
    _receptor     => NULL,
    _lineas       => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":1,"iva_rate":21}]'::jsonb,
    _simplificada => true);
  RAISE WARNING 'MAL  19. authenticated ha emitido sin pasar por el servidor';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'BIEN 19. emitir sigue reservado al servidor';
WHEN OTHERS THEN
  RAISE WARNING 'MAL  19. rechazado, pero por otro motivo: %', SQLERRM;
END $$;
RESET ROLE;

-- 20. La migración se puede aplicar dos veces sin romper nada.
\ir ../migrations/20261004100000_ticket_tipo.sql
\ir ../migrations/20261004100100_tickets.sql
SELECT CASE WHEN count(*) = 3 THEN 'BIEN 20. aplicar la migración otra vez no rompe nada'
            ELSE 'MAL  20. series tras reaplicar: ' || count(*) END
FROM public.serie_estado(public.empresa_por_defecto());
