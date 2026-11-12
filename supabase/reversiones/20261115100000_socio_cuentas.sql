-- ============================================================================
-- REVERSIÓN de 20261115100000_socio_cuentas.sql
-- ============================================================================
-- Quita la tabla de quién usa cada cuenta y su función. Se pierde qué socio
-- entra con qué cuenta (nada de negocio): el CRM deja de preguntar
-- «¿Quién eres?». Las filas que haya escrito en auditoria se quedan (es
-- append-only). Pídelo antes: son DROP.
-- ============================================================================

DROP FUNCTION IF EXISTS public.socio_cuentas_fijar(UUID, UUID, UUID[]);
DROP TABLE IF EXISTS public.socio_cuentas;
DROP FUNCTION IF EXISTS public.socio_cuentas_empresa_del_socio();

NOTIFY pgrst, 'reload schema';
