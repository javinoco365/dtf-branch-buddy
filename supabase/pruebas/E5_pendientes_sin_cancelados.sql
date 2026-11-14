-- ============================================================================
-- Pendientes de cobro sin pedidos cancelados
-- ============================================================================
-- Prueba 20261119100000_pendientes_sin_cancelados.sql:
--   1. un pedido vivo con saldo sale en pedidos_pendientes_cobro;
--   2. uno con estado «cancelado» y sin cancelado_en (desajustado) no sale;
--   3. uno cancelado por la vía normal tampoco.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

-- A9 vuelve a cargar la vista de 20260930100000: se carga aquí la de esta migración.
\ir ../migrations/20261119100000_pendientes_sin_cancelados.sql

DO $$
DECLARE v_emp UUID; v_tienda UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  SELECT id INTO v_tienda FROM public.tiendas WHERE empresa_id = v_emp ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('E5 tienda', v_emp) RETURNING id INTO v_tienda;
  END IF;
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero, total) VALUES (v_tienda, v_emp, 'E5-VIVO', 50);
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero, total, estado)
    VALUES (v_tienda, v_emp, 'E5-CANCELADO', 50, 'cancelado');
  -- Un cancelado desajustado (como las filas de antes del trigger de estados).
  ALTER TABLE public.pedidos DISABLE TRIGGER USER;
  INSERT INTO public.pedidos (tienda_id, empresa_id, numero, total, estado, cancelado_en)
    VALUES (v_tienda, v_emp, 'E5-DESAJUSTADO', 50, 'cancelado', NULL);
  ALTER TABLE public.pedidos ENABLE TRIGGER USER;
END $$;

SELECT CASE WHEN EXISTS (SELECT 1 FROM public.pedidos_pendientes_cobro WHERE numero = 'E5-VIVO')
            THEN 'BIEN  1. un pedido vivo con saldo sale en pendientes'
            ELSE 'MAL   1. un pedido vivo con saldo no sale en pendientes' END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.pedidos_pendientes_cobro WHERE numero = 'E5-DESAJUSTADO')
            THEN 'BIEN  2. un cancelado sin fecha de cancelación no sale en pendientes'
            ELSE 'MAL   2. un cancelado sin fecha de cancelación sale en pendientes' END;

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.pedidos_pendientes_cobro WHERE numero = 'E5-CANCELADO')
            THEN 'BIEN  3. un cancelado normal no sale en pendientes'
            ELSE 'MAL   3. un cancelado normal sale en pendientes' END;

ROLLBACK;
