-- ============================================================================
-- El recargo de equivalencia del pedido, aparte del IVA: pedidos.recargo
-- ============================================================================
-- Prueba 20261121100000_pedido_recargo.sql. Se aplica dos veces, se revierte
-- y se vuelve a aplicar, todo en una transacción que se deshace al final.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261121100000_pedido_recargo.sql
\ir ../migrations/20261121100000_pedido_recargo.sql
RESET client_min_messages;

INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda E8', 'tienda-e8');
INSERT INTO public.pedidos (tienda_id, empresa_id, numero)
  SELECT id, empresa_id, 'E8-1' FROM public.tiendas WHERE slug = 'tienda-e8';

-- 1. La columna: obligatoria y a 0 si no se dice.
SELECT CASE WHEN (SELECT is_nullable = 'NO' AND column_default = '0'
                    FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'pedidos'
                     AND column_name = 'recargo')
             AND (SELECT recargo = 0 FROM public.pedidos WHERE numero = 'E8-1')
            THEN 'BIEN  1. pedidos.recargo es obligatoria y vale 0 si no se dice'
            ELSE 'MAL   1. pedidos.recargo no está como se espera' END;

-- 2. Se puede guardar y no toca el total ni el IVA.
UPDATE public.pedidos SET total = 16.39, iva = 3.40, recargo = 0.67 WHERE numero = 'E8-1';
SELECT CASE WHEN total = 16.39 AND iva = 3.40 AND recargo = 0.67
            THEN 'BIEN  2. el recargo se guarda aparte y el IVA sigue con todos los impuestos'
            ELSE 'MAL   2. total ' || total || ', iva ' || iva || ', recargo ' || recargo END
  FROM public.pedidos WHERE numero = 'E8-1';

-- 3. La reversión se aplica y la migración se puede volver a aplicar.
SET client_min_messages = warning;
\ir ../reversiones/20261121100000_pedido_recargo.sql
RESET client_min_messages;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public' AND table_name = 'pedidos'
                                AND column_name = 'recargo')
            THEN 'BIEN  3a. la reversión quita la columna'
            ELSE 'MAL   3a. la reversión no ha quitado la columna' END;
SET client_min_messages = warning;
\ir ../migrations/20261121100000_pedido_recargo.sql
RESET client_min_messages;
SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'pedidos'
                            AND column_name = 'recargo')
            THEN 'BIEN  3b. y se puede volver a aplicar'
            ELSE 'MAL   3b. no se ha vuelto a aplicar' END;

ROLLBACK;
