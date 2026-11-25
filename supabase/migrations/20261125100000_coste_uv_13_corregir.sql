-- ============================================================================
-- DTF UV: corregir el coste congelado de los pedidos (15 → 13 € el metro)
-- ============================================================================
-- Decisión de Javier (25-11-2026). La subcontrata cobra el metro de DTF UV a
-- 13 €, sin IVA, y en el CRM estaba a 15 € (el valor por defecto de
-- 20261110100000). Ya está cambiado en Configuración de empresa
-- (empresas.coste_uv_metro = 13), pero cada pedido congeló el coste del día
-- en que entró y no lo recalcula: los pedidos con DTF UV de antes siguen
-- contando el UV a 15 € en Gerencia.
--
-- Es una corrección de un dato mal puesto, una sola vez. Los costes congelados
-- no se recalculan nunca a partir del maestro; esto no cambia esa regla.
--
-- Qué hace:
--   1. pedidos.coste_uv_snapshot: de 15 a 13. El disparador
--      pedidos_coste_uv_congelado no deja cambiarlo: se desactiva solo durante
--      esta corrección, dentro de la misma transacción.
--   2. pedido_items.coste_unit_snapshot de las líneas UV: de 15 a 13.
--
-- Solo en empresas que ya tienen el UV a 13 en Configuración, y solo los que
-- están exactamente a 15: no toca pedidos con otro coste puesto a propósito.
-- No cambia importes cobrados, IVA ni documentos emitidos: solo el coste.
--
-- Reversible a mano mientras no entren pedidos nuevos con UV (estos ya nacen
-- a 13): el mismo UPDATE con 13 → 15. Después ya no se distinguen.

BEGIN;

ALTER TABLE public.pedidos DISABLE TRIGGER pedidos_coste_uv_congelado;

UPDATE public.pedidos p
   SET coste_uv_snapshot = 13
  FROM public.empresas e
 WHERE e.id = p.empresa_id
   AND e.coste_uv_metro = 13
   AND p.coste_uv_snapshot = 15;

ALTER TABLE public.pedidos ENABLE TRIGGER pedidos_coste_uv_congelado;

UPDATE public.pedido_items i
   SET coste_unit_snapshot = 13
  FROM public.pedidos p
  JOIN public.empresas e ON e.id = p.empresa_id
 WHERE p.id = i.pedido_id
   AND e.coste_uv_metro = 13
   AND i.linea = 'uv'
   AND i.coste_unit_snapshot = 15;

COMMIT;
