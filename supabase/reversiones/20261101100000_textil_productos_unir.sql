-- ============================================================================
-- REVERSIÓN de 20261101100000_textil_productos_unir.sql
-- ============================================================================
-- Quita textil_productos_unir(). No toca datos: las uniones que ya se hayan
-- hecho se quedan. Si hiciera falta deshacer una, cada variante guarda en su
-- SKU la referencia de su producto de antes, y ese producto sigue en
-- textil_productos, desactivado y con la misma referencia.
-- ============================================================================

DROP FUNCTION IF EXISTS public.textil_productos_unir(UUID, UUID, UUID[]);
