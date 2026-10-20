-- ============================================================================
-- REVERSIÓN de 20261029100000_proformas_motivo.sql
-- ============================================================================
-- Va después de la reversión de 20261029100100_proformas_compras.sql. Solo con
-- autorización expresa de Javier.
--
-- PostgreSQL no quita un valor de un enum: 'ajuste_coste' se queda en
-- stock_motivo. Sin 20261029100100 nadie lo usa (sus CHECK y funciones se
-- quitan con aquella reversión, que además se niega si queda algún
-- movimiento 'ajuste_coste'). Esta reversión no hace nada.
-- ============================================================================

SELECT 1;
