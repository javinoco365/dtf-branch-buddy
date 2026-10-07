-- ============================================================================
-- FACTURAS RECIBIDAS: IMPORTES CALCULADOS EN LA BASE, PAGO Y BORRADO LÓGICO
-- ============================================================================
--
-- QUÉ RESUELVE
--   Las facturas de compra (textil_compras, que desde 20261013100000 guarda
--   todas las del negocio) guardaban los importes tal como llegaban del
--   navegador. Ahora la base los calcula ella:
--
--     cuota_iva         = redondeo(base × tipo_iva, 2)
--     cuota_irpf        = redondeo(base × tipo_irpf, 2)
--     total_calculado   = base + cuota_iva
--     liquido_calculado = base + cuota_iva − cuota_irpf
--     ejercicio, trimestre: de la fecha
--
--   Son columnas generadas: nadie puede escribirlas, ni la aplicación.
--
--   Si el líquido calculado no coincide con el impreso en la factura, se
--   elige cuál vale (liquido_origen: 'calculado' o 'factura') y, si vale el
--   de la factura, se dice por qué (nota_descuadre, obligatoria). El líquido
--   bueno queda en la columna generada `liquido`.
--
-- QUÉ SIGNIFICAN LAS COLUMNAS DE ANTES
--   base: la base imponible. iva, irpf y total: lo que dice la factura
--   impresa (lo que lee la IA y corrige la persona). `total` es el importe a
--   pagar impreso: el líquido de la factura.
--
-- QUÉ MÁS CAMBIA
--   - concepto, forma_pago.
--   - estado_pago: pendiente | pagada, con fecha_pago (obligatoria si pagada).
--   - borrada_en: borrado lógico. Una factura registrada no se borra: se
--     marca, y deja de contar.
--   - Las compras que ya hubiera toman el tipo de IVA y de IRPF de sus
--     importes (solo al aplicar la migración la primera vez).
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261014100000_compras_recibidas.sql. Borra las
--   columnas nuevas y lo que se haya escrito en ellas. Se puede aplicar dos
--   veces sin cambiar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos de IVA e IRPF. Las compras de antes toman los suyos de sus
--    importes; solo la primera vez, para no pisar lo que se cambie después.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'textil_compras' AND column_name = 'tipo_iva'
  ) THEN
    ALTER TABLE public.textil_compras
      ADD COLUMN tipo_iva NUMERIC(6,4) NOT NULL DEFAULT 0.21,
      ADD COLUMN tipo_irpf NUMERIC(6,4) NOT NULL DEFAULT 0;
    UPDATE public.textil_compras
       SET tipo_iva = round(iva / base, 4),
           tipo_irpf = round(irpf / base, 4)
     WHERE base > 0 AND iva >= 0 AND iva <= base AND irpf >= 0 AND irpf <= base;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Datos de la factura, pago, descuadre y borrado
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS concepto TEXT,
  ADD COLUMN IF NOT EXISTS forma_pago TEXT,
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS fecha_pago DATE,
  ADD COLUMN IF NOT EXISTS liquido_origen TEXT NOT NULL DEFAULT 'calculado',
  ADD COLUMN IF NOT EXISTS nota_descuadre TEXT,
  ADD COLUMN IF NOT EXISTS borrada_en TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. Lo que calcula la base
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS cuota_iva NUMERIC(12,2)
    GENERATED ALWAYS AS (round(base * tipo_iva, 2)) STORED,
  ADD COLUMN IF NOT EXISTS cuota_irpf NUMERIC(12,2)
    GENERATED ALWAYS AS (round(base * tipo_irpf, 2)) STORED,
  ADD COLUMN IF NOT EXISTS total_calculado NUMERIC(12,2)
    GENERATED ALWAYS AS (base + round(base * tipo_iva, 2)) STORED,
  ADD COLUMN IF NOT EXISTS liquido_calculado NUMERIC(12,2)
    GENERATED ALWAYS AS (base + round(base * tipo_iva, 2) - round(base * tipo_irpf, 2)) STORED,
  ADD COLUMN IF NOT EXISTS liquido NUMERIC(12,2)
    GENERATED ALWAYS AS (
      CASE WHEN liquido_origen = 'factura' THEN round(total, 2)
           ELSE base + round(base * tipo_iva, 2) - round(base * tipo_irpf, 2) END
    ) STORED,
  ADD COLUMN IF NOT EXISTS ejercicio INT
    GENERATED ALWAYS AS (extract(year FROM fecha)::int) STORED,
  ADD COLUMN IF NOT EXISTS trimestre INT
    GENERATED ALWAYS AS (extract(quarter FROM fecha)::int) STORED;

-- ---------------------------------------------------------------------------
-- 4. Reglas
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_tipos CHECK (tipo_iva >= 0 AND tipo_iva <= 1
                                       AND tipo_irpf >= 0 AND tipo_irpf <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_forma_pago
      CHECK (forma_pago IS NULL OR forma_pago IN ('transferencia', 'domiciliacion', 'tarjeta',
                                                  'efectivo', 'bizum', 'otro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_estado_pago CHECK (estado_pago IN ('pendiente', 'pagada'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Pagada, con su fecha; pendiente, sin ella.
DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_pago_con_fecha
      CHECK ((estado_pago = 'pagada') = (fecha_pago IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_liquido_origen CHECK (liquido_origen IN ('calculado', 'factura'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Si vale el importe de la factura, hay que decir por qué no cuadra.
DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_descuadre_explicado
      CHECK (liquido_origen = 'calculado' OR length(trim(coalesce(nota_descuadre, ''))) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS textil_compras_por_trimestre
  ON public.textil_compras (ejercicio, trimestre) WHERE borrada_en IS NULL;

COMMENT ON COLUMN public.textil_compras.iva IS 'Cuota de IVA impresa en la factura. La que cuenta es cuota_iva.';
COMMENT ON COLUMN public.textil_compras.irpf IS 'Retención impresa en la factura. La que cuenta es cuota_irpf.';
COMMENT ON COLUMN public.textil_compras.total IS 'Importe a pagar impreso en la factura (líquido impreso).';
COMMENT ON COLUMN public.textil_compras.tipo_iva IS 'Tipo de IVA en tanto por uno: 0,21.';
COMMENT ON COLUMN public.textil_compras.tipo_irpf IS 'Tipo de IRPF en tanto por uno: 0,15.';
COMMENT ON COLUMN public.textil_compras.liquido_origen IS
  'Qué líquido vale: el calculado por la base o el impreso en la factura (con nota_descuadre).';
COMMENT ON COLUMN public.textil_compras.liquido IS 'El líquido que vale: el que se concilia con el banco.';
COMMENT ON COLUMN public.textil_compras.borrada_en IS 'Borrado lógico: desde entonces no cuenta.';
