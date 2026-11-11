-- ============================================================================
-- IMPORTES DEL PEDIDO POR LÍNEA DE PRODUCTO (DTF Y DTF UV)
-- ============================================================================
--
-- QUÉ RESUELVE
--   Un pedido solo guardaba sus importes totales. Uno mixto (DTF y DTF UV en
--   el mismo pedido) no se podía partir: cada pantalla tenía que decidir a
--   qué línea iba entero. Con esto el pedido sabe cuánto de su base y de su
--   IVA es de DTF UV; el DTF es el resto (con el envío, que no es de ninguna
--   línea de producto).
--
-- QUÉ CAMBIA
--   pedidos.bruta_uv: suma de la base (sin IVA, sin envío) de sus líneas de
--     DTF UV. 0 si no lleva UV.
--   pedidos.iva_uv: el IVA de esas líneas.
--   Los pedidos que ya tienen líneas de UV se rellenan a partir de ellas; los
--   demás se quedan en 0 (no llevan UV). La sincronización lo calcula en cada
--   pedido que entra o cambia.
--
-- LO QUE NO TOCA
--   Facturas, tickets, cobros, banco, caja e impuestos.
--
-- REVERSIBLE
--   Sí: ALTER TABLE public.pedidos DROP COLUMN bruta_uv, DROP COLUMN iva_uv.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS bruta_uv NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_uv NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.pedidos
    ADD CONSTRAINT pedido_importes_uv_validos CHECK (bruta_uv >= 0 AND iva_uv >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.pedidos.bruta_uv IS
  'Base sin IVA ni envío de las líneas de DTF UV del pedido. El DTF es el resto.';
COMMENT ON COLUMN public.pedidos.iva_uv IS
  'IVA de las líneas de DTF UV del pedido.';

-- Los pedidos que ya llevan UV (desde el 10-11-2026): de sus líneas. Solo se
-- tocan esos, para no escribir una fila de auditoría por cada pedido.
UPDATE public.pedidos p
   SET bruta_uv = s.bruta,
       iva_uv = s.iva
  FROM (
    SELECT pedido_id,
           round(sum(COALESCE(subtotal, 0)), 2) AS bruta,
           round(sum(COALESCE(iva, 0)), 2) AS iva
      FROM public.pedido_items
     WHERE linea = 'uv'
     GROUP BY pedido_id
  ) s
 WHERE s.pedido_id = p.id
   AND (p.bruta_uv IS DISTINCT FROM s.bruta OR p.iva_uv IS DISTINCT FROM s.iva);
