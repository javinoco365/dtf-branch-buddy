-- ============================================================================
-- Ajustar el importe real de un pedido (rebaja)
-- ============================================================================
-- Prueba 20261119110000_pedido_ajuste_importe.sql:
--   1. un editor fija el importe real: queda una rebaja con su motivo y la
--      fecha del pedido, y lo pendiente baja a lo que falta;
--   2. volver a ajustar actualiza la rebaja (una por pedido);
--   3. con el importe máximo, la rebaja queda a 0 con su rastro;
--   4. sin motivo se rechaza;
--   5. por encima del total se rechaza;
--   6. un visor no puede;
--   7. lo cobrado entero tras la rebaja: el pedido sale de pendientes.
BEGIN;

-- A9 y E5 vuelven a cargar vistas anteriores: se carga la de esta migración.
\ir ../migrations/20261119110000_pedido_ajuste_importe.sql

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e6001', 'e6-editor@prueba.test'),
  ('00000000-0000-0000-0000-0000000e6002', 'e6-visor@prueba.test');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('00000000-0000-0000-0000-0000000e6001', 'editor', true),
  ('00000000-0000-0000-0000-0000000e6002', 'visor', true);

DO $$
DECLARE v_emp UUID; v_tienda UUID; v_ped UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tienda FROM public.tiendas WHERE empresa_id = v_emp ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('E6 tienda', v_emp) RETURNING id INTO v_tienda;
  END IF;
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero, total, fecha_pedido)
    VALUES (v_tienda, v_emp, 'E6-1', 15.72, '2026-11-12 13:35+01') RETURNING id INTO v_ped;
  PERFORM set_config('e6.ped', v_ped::TEXT, true);
END $$;

-- Llama a la función como un usuario con sesión y devuelve el resultado o el error.
CREATE FUNCTION pg_temp.e6_ajustar(_usuario UUID, _importe NUMERIC, _motivo TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE r NUMERIC;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _usuario::TEXT, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    r := public.pedido_ajustar_importe(_usuario, current_setting('e6.ped')::UUID, _importe, _motivo);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'error: ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r::TEXT;
END $$;

CREATE FUNCTION pg_temp.e6_rebajas() RETURNS TABLE (n BIGINT, importe NUMERIC, motivo TEXT, fecha DATE)
LANGUAGE sql AS $$
  SELECT count(*) FILTER (WHERE d.importe > 0), sum(d.importe), max(d.motivo),
         max((d.fecha AT TIME ZONE 'Europe/Madrid')::DATE)
    FROM public.pedido_devoluciones d
   WHERE d.pedido_id = current_setting('e6.ped')::UUID AND d.woo_refund_id IS NULL
$$;

-- 1.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 8.47, 'recogió en el local') AS r1 \gset
SELECT CASE WHEN :'r1' = '7.25'
             AND (SELECT n = 1 AND importe = 7.25 AND motivo = 'Rebaja: recogió en el local'
                         AND fecha = '2026-11-12' FROM pg_temp.e6_rebajas())
             AND (SELECT pendiente = 8.47 FROM public.pedidos_pendientes_cobro
                   WHERE id = current_setting('e6.ped')::UUID)
            THEN 'BIEN  1. la rebaja queda con su motivo y la fecha del pedido, y baja lo pendiente'
            ELSE 'MAL   1. el ajuste no ha quedado bien: ' || :'r1' END;

-- 2.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 7.25, 'precio acordado') AS r2 \gset
SELECT CASE WHEN (SELECT n = 1 AND importe = 8.47 FROM pg_temp.e6_rebajas())
            THEN 'BIEN  2. volver a ajustar sustituye la rebaja'
            ELSE 'MAL   2. se han acumulado rebajas: ' || :'r2' END;

-- 3.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 15.72, 'sin rebaja') AS r3 \gset
SELECT CASE WHEN :'r3' = '0.00'
             AND (SELECT n = 0 AND importe = 0 AND motivo LIKE 'Rebaja quitada:%' FROM pg_temp.e6_rebajas())
            THEN 'BIEN  3. con el importe máximo la rebaja queda a 0, con su rastro'
            ELSE 'MAL   3. la rebaja sigue: ' || :'r3' END;

-- 4.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 8.47, '  ') AS r4 \gset
SELECT CASE WHEN :'r4' LIKE 'error:%por qué%'
            THEN 'BIEN  4. sin motivo no se ajusta'
            ELSE 'MAL   4. se ha ajustado sin motivo: ' || :'r4' END;

-- 5.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 20, 'de más') AS r5 \gset
SELECT CASE WHEN :'r5' LIKE 'error:%entre 0 y%'
            THEN 'BIEN  5. por encima del total no se ajusta'
            ELSE 'MAL   5. se ha ajustado por encima del total: ' || :'r5' END;

-- 6.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6002', 8.47, 'visor') AS r6 \gset
SELECT CASE WHEN :'r6' LIKE 'error:%'
            THEN 'BIEN  6. un visor no ajusta importes'
            ELSE 'MAL   6. un visor ha ajustado un importe: ' || :'r6' END;

-- 7.
SELECT pg_temp.e6_ajustar('00000000-0000-0000-0000-0000000e6001', 7.25, 'recogió en el local') AS r7 \gset
INSERT INTO public.cobros (empresa_id, pedido_id, fecha, importe, metodo)
SELECT p.empresa_id, p.id, '2026-11-12', 7.25, 'transferencia'
  FROM public.pedidos p WHERE p.id = current_setting('e6.ped')::UUID;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.pedidos_pendientes_cobro
                              WHERE id = current_setting('e6.ped')::UUID)
            THEN 'BIEN  7. cobrado lo real, el pedido sale de pendientes'
            ELSE 'MAL   7. el pedido sigue en pendientes tras cobrar lo real' END;

ROLLBACK;
