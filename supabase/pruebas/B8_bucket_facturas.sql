-- ============================================================================
-- El bucket de los PDF de facturas
-- ============================================================================
-- Prueba 20261011100000_bucket_facturas.sql: reproduce producción (sin el
-- bucket) y comprueba que la migración lo crea privado y solo para PDF.

DELETE FROM storage.buckets WHERE id = 'facturas';
\ir ../migrations/20261011100000_bucket_facturas.sql
\ir ../migrations/20261011100000_bucket_facturas.sql

SELECT CASE WHEN count(*) = 1 THEN 'BIEN  1. el bucket facturas existe (y aplicarla dos veces no lo duplica)'
            ELSE 'MAL   1. buckets facturas: ' || count(*) END
FROM storage.buckets WHERE id = 'facturas';

SELECT CASE WHEN NOT public AND allowed_mime_types = ARRAY['application/pdf']
                 AND file_size_limit = 10485760
            THEN 'BIEN  2. privado, solo PDF y hasta 10 MB'
            ELSE 'MAL   2. el bucket no está como debe' END
FROM storage.buckets WHERE id = 'facturas';
