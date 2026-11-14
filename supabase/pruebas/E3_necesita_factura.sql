-- ============================================================================
-- «Quiero factura»: pedidos.necesita_factura
-- ============================================================================
-- Prueba 20261117100000_pedido_necesita_factura.sql:
--   1. la columna existe, es obligatoria y por defecto vale false;
--   2. un ticket de un pedido que pidió factura se rechaza;
--   3. una factura completa del mismo pedido sí entra;
--   4. un ticket de un pedido que no pidió factura sigue entrando;
--   5. un ticket sin pedido sigue entrando.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

DO $$
DECLARE v_emp UUID; v_tienda UUID; v_si UUID; v_no UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tienda FROM public.tiendas WHERE empresa_id = v_emp ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('E3 tienda', v_emp) RETURNING id INTO v_tienda;
  END IF;
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero, necesita_factura)
    VALUES (v_tienda, v_emp, 'E3-1', true) RETURNING id INTO v_si;
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero)
    VALUES (v_tienda, v_emp, 'E3-2') RETURNING id INTO v_no;
  PERFORM set_config('e3.emp', v_emp::TEXT, true);
  PERFORM set_config('e3.tienda', v_tienda::TEXT, true);
  PERFORM set_config('e3.si', v_si::TEXT, true);
  PERFORM set_config('e3.no', v_no::TEXT, true);
END $$;

-- Da de alta un documento y devuelve 'ok' o el error.
CREATE FUNCTION pg_temp.e3_alta(_tipo TEXT, _pedido UUID, _numero INT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.facturas (empresa_id, tienda_id, pedido_id, serie, numero, ejercicio, fecha, tipo, estado, total)
  VALUES (current_setting('e3.emp')::UUID, current_setting('e3.tienda')::UUID, _pedido,
          'E3' || _tipo, _numero, 2026, '2026-11-17', _tipo::public.factura_tipo, 'emitida', 12.10);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'error: ' || SQLERRM;
END $$;

-- 1. La columna.
SELECT CASE WHEN (SELECT is_nullable = 'NO' AND column_default = 'false'
                    FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'pedidos'
                     AND column_name = 'necesita_factura')
             AND (SELECT NOT necesita_factura FROM public.pedidos WHERE id = current_setting('e3.no')::UUID)
            THEN 'BIEN  1. necesita_factura es obligatoria y vale false si no se dice'
            ELSE 'MAL   1. necesita_factura no está como se espera' END;

-- 2. Ticket de un pedido que pidió factura.
SELECT pg_temp.e3_alta('simplificada', current_setting('e3.si')::UUID, 9901) AS r2 \gset
SELECT CASE WHEN :'r2' LIKE 'error:%pidió factura%'
            THEN 'BIEN  2. no se emite un ticket a quien pidió factura'
            ELSE 'MAL   2. se ha emitido un ticket a quien pidió factura: ' || :'r2' END;

-- 3. Factura completa del mismo pedido.
SELECT pg_temp.e3_alta('ordinaria', current_setting('e3.si')::UUID, 9902) AS r3 \gset
SELECT CASE WHEN :'r3' = 'ok'
            THEN 'BIEN  3. la factura completa de ese pedido sí entra'
            ELSE 'MAL   3. la factura completa no ha entrado: ' || :'r3' END;

-- 4. Ticket de un pedido que no pidió factura.
SELECT pg_temp.e3_alta('simplificada', current_setting('e3.no')::UUID, 9903) AS r4 \gset
SELECT CASE WHEN :'r4' = 'ok'
            THEN 'BIEN  4. un pedido sin la casilla sigue admitiendo ticket'
            ELSE 'MAL   4. un ticket normal no ha entrado: ' || :'r4' END;

-- 5. Ticket sin pedido.
SELECT pg_temp.e3_alta('simplificada', NULL, 9904) AS r5 \gset
SELECT CASE WHEN :'r5' = 'ok'
            THEN 'BIEN  5. un ticket sin pedido sigue entrando'
            ELSE 'MAL   5. un ticket sin pedido no ha entrado: ' || :'r5' END;

ROLLBACK;
