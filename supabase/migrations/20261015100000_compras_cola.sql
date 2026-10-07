-- ============================================================================
-- FACTURAS RECIBIDAS: COLA DE REVISIÓN Y DUPLICADOS
-- ============================================================================
--
-- QUÉ RESUELVE
--   Se pueden subir varios PDFs de golpe. Cada uno lo lee la IA y queda en una
--   cola de revisión: la IA propone, la persona confirma. Y si se sube dos
--   veces la misma factura, se avisa.
--
-- QUÉ CAMBIA EN textil_compras
--   - revision: pendiente | revisada | error. Lo que entra por la IA nace
--     pendiente; al registrarlo una persona, revisada. Si la IA no da una
--     lectura válida tras un reintento: error, visible y con su motivo. Las
--     compras de antes quedan revisadas.
--   - revision_motivo: por qué hay que mirarla (dudas de la IA, cuentas que
--     no cuadran, posible duplicado) o por qué falló.
--   - confianza: la que da la IA a su lectura, de 0 a 1.
--   - fichero_huella: SHA-256 del fichero subido. El mismo PDF dos veces se
--     detecta aunque se llame distinto.
--   - proveedor_clave, numero_clave (generadas): NIF (o, sin NIF, nombre) y
--     número sin espacios, guiones ni minúsculas. «F-0123» y «f 0123» son la
--     misma factura.
--
-- DUPLICADOS (la base los impide; la pantalla además avisa)
--   1. El mismo fichero: no puede haber dos sin borrar.
--   2. La misma factura (proveedor y número): no puede haber dos registradas
--      sin borrar. Sustituye a la restricción compra_unica, que comparaba el
--      nombre del proveedor tal cual y dejaba pasar las que no tienen número.
--   3. Mismo proveedor, fecha e importe: solo aviso (puede ser otra factura).
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261015100000_compras_cola.sql. Se puede
--   aplicar dos veces sin cambiar nada.
-- ============================================================================

ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS revision TEXT NOT NULL DEFAULT 'revisada',
  ADD COLUMN IF NOT EXISTS revision_motivo TEXT,
  ADD COLUMN IF NOT EXISTS confianza NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS fichero_huella TEXT;

ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS proveedor_clave TEXT GENERATED ALWAYS AS (
    CASE WHEN regexp_replace(coalesce(nif_proveedor, ''), '[^A-Za-z0-9]', '', 'g') <> ''
         THEN upper(regexp_replace(nif_proveedor, '[^A-Za-z0-9]', '', 'g'))
         ELSE upper(regexp_replace(coalesce(proveedor, ''), '[^A-Za-z0-9]', '', 'g')) END
  ) STORED,
  ADD COLUMN IF NOT EXISTS numero_clave TEXT GENERATED ALWAYS AS (
    upper(regexp_replace(coalesce(numero, ''), '[^A-Za-z0-9]', '', 'g'))
  ) STORED;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_revision CHECK (revision IN ('pendiente', 'revisada', 'error'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_confianza CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una registrada la ha revisado una persona.
DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_registrada_revisada CHECK (estado <> 'registrada' OR revision = 'revisada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. El mismo fichero, una vez.
CREATE UNIQUE INDEX IF NOT EXISTS textil_compras_fichero_unico
  ON public.textil_compras (empresa_id, fichero_huella)
  WHERE fichero_huella IS NOT NULL AND borrada_en IS NULL;

-- 2. La misma factura, registrada una vez.
CREATE UNIQUE INDEX IF NOT EXISTS textil_compras_factura_unica
  ON public.textil_compras (empresa_id, proveedor_clave, numero_clave)
  WHERE estado = 'registrada' AND borrada_en IS NULL
    AND proveedor_clave <> '' AND numero_clave <> '';

ALTER TABLE public.textil_compras DROP CONSTRAINT IF EXISTS compra_unica;

CREATE INDEX IF NOT EXISTS textil_compras_cola
  ON public.textil_compras (created_at DESC) WHERE revision <> 'revisada';

COMMENT ON COLUMN public.textil_compras.revision IS
  'pendiente (la IA propone), revisada (la confirmó una persona) o error (la IA no la leyó).';
COMMENT ON COLUMN public.textil_compras.revision_motivo IS 'Por qué hay que revisarla, o por qué falló.';
COMMENT ON COLUMN public.textil_compras.confianza IS 'Confianza de la IA en su lectura, de 0 a 1.';
COMMENT ON COLUMN public.textil_compras.fichero_huella IS 'SHA-256 del fichero: el mismo PDF no entra dos veces.';
