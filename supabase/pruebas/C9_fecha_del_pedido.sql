-- ============================================================================
-- Tickets y facturas con la fecha del pedido, aunque la serie vaya por delante
-- ============================================================================
-- Prueba 20261021100000_fecha_del_pedido.sql. B6 vuelve a aplicar la
-- comprobación de fechas: se aplica otra vez aquí, dos veces (tiene que poder
-- repetirse).
\ir ../migrations/20261021100000_fecha_del_pedido.sql
\ir ../migrations/20261021100000_fecha_del_pedido.sql

SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

CREATE OR REPLACE FUNCTION pg_temp.emitir(_tienda UUID, _fecha DATE, _simplificada BOOLEAN)
RETURNS UUID LANGUAGE sql AS $$
  SELECT (public.emitir_factura(
    _usuario_id => '11111111-1111-4111-8111-111111111111',
    _tienda_id  => _tienda,
    _receptor   => '{"nombre":"Cliente C9","nif":"12345678Z"}'::jsonb,
    _lineas     => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha      => _fecha,
    _simplificada => _simplificada) ->> 'id')::UUID
$$;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C9', 'tienda-c9');
SELECT set_config('prueba.tienda', (SELECT id::TEXT FROM public.tiendas WHERE slug = 'tienda-c9'), false);

-- 1. Un ticket con fecha anterior al último de la serie sale con su fecha.
SELECT set_config('prueba.t1', pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2026-10-07', true)::TEXT, false);
DO $$
DECLARE
  v_id UUID;
  v_fecha DATE;
BEGIN
  v_id := pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2026-09-19', true);
  SELECT fecha INTO v_fecha FROM public.facturas WHERE id = v_id;
  IF v_fecha = DATE '2026-09-19' THEN
    RAISE NOTICE 'BIEN  1. el ticket del 19/09 sale con su fecha aunque haya uno del 07/10';
  ELSE
    RAISE WARNING 'MAL   1. el ticket salió con fecha %', v_fecha;
  END IF;
  PERFORM set_config('prueba.t2', v_id::TEXT, false);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   1. rechazado: %', SQLERRM;
END $$;

-- 2. La numeración sigue correlativa: el segundo lleva el número siguiente.
SELECT CASE WHEN (SELECT numero FROM public.facturas WHERE id = current_setting('prueba.t2', true)::UUID)
               = (SELECT numero FROM public.facturas WHERE id = current_setting('prueba.t1')::UUID) + 1
            THEN 'BIEN  2. el número sigue siendo el siguiente de la serie'
            ELSE 'MAL   2. la numeración se ha descolocado' END;

-- 3. Lo mismo con una factura ordinaria.
DO $$
DECLARE
  v_id UUID;
  v_fecha DATE;
BEGIN
  PERFORM pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2026-10-07', false);
  v_id := pg_temp.emitir(current_setting('prueba.tienda')::UUID, DATE '2026-09-19', false);
  SELECT fecha INTO v_fecha FROM public.facturas WHERE id = v_id;
  IF v_fecha = DATE '2026-09-19' THEN
    RAISE NOTICE 'BIEN  3. la factura del 19/09 sale con su fecha aunque haya una del 07/10';
  ELSE
    RAISE WARNING 'MAL   3. la factura salió con fecha %', v_fecha;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   3. rechazada: %', SQLERRM;
END $$;

-- 4. Sigue sin poder llamarla nadie desde fuera.
SELECT CASE WHEN NOT has_function_privilege('authenticated',
                 'public.factura_comprobar_fecha(uuid,text,integer,date)', 'EXECUTE')
            THEN 'BIEN  4. authenticated no puede llamarla'
            ELSE 'MAL   4. authenticated puede llamarla' END;
