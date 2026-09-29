-- ============================================================================
-- TICKETS (1 de 2) · El tipo de documento «simplificada»
-- ============================================================================
--
-- Va sola en su fichero porque Postgres no deja USAR un valor nuevo de un enum
-- en la misma transacción que lo crea. La segunda parte
-- (20261004100100_tickets.sql) lo usa, así que hay que aplicar esta primero y
-- por separado.
--
-- Tipos de factura después de esto:
--   ordinaria      2026/0001    factura completa
--   rectificativa  R2026/0001   corrige una ordinaria o un ticket
--   simplificada   T2026/0001   ticket (RD 1619/2012 art. 4)
--
-- REVERSIBLE
--   No de forma sencilla: Postgres no quita valores de un enum. Mientras no
--   haya ningún ticket emitido, el valor sobrante no molesta a nadie.
-- ============================================================================

ALTER TYPE public.factura_tipo ADD VALUE IF NOT EXISTS 'simplificada';
