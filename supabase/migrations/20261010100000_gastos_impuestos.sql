-- ============================================================================
-- GASTOS CON IMPUESTOS Y PERIODICIDAD, Y DATOS FISCALES DE LA EMPRESA
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hasta ahora un gasto fijo era un importe al mes sin IVA. No bastaba para
--   saber cuánto se paga cada trimestre a Hacienda:
--
--   - El IVA de un gasto no es coste: se recupera en el 303.
--   - El IRPF que se retiene en algunos gastos tampoco es coste: se descuenta
--     al proveedor y se ingresa en Hacienda cada trimestre. Alquiler del
--     local: 19 %, modelo 115. Profesionales y nóminas: modelo 111.
--   - Hay gastos que se pagan al trimestre, al año o una sola vez.
--
--   Ejemplo, alquiler de 1.000 € de base al 21 % de IVA y 19 % de IRPF:
--     al casero se le pagan 1.000 + 210 − 190 = 1.020 €;
--     a Hacienda, 190 € en el 115 del trimestre;
--     el coste es 1.000 €; los 210 € de IVA se recuperan en el 303.
--
-- QUÉ CAMBIA
--   gerencia_gastos_fijos:
--     - importe_mensual pasa a ser la BASE DE CADA CARGO (sin IVA). Con
--       periodicidad mensual, que es el valor por defecto, significa lo mismo
--       que antes: los gastos ya apuntados no cambian.
--     - periodicidad: mensual | trimestral | anual | puntual.
--     - tipo: qué es el gasto. Decide a qué modelo va su IRPF.
--     - iva_pct, irpf_pct: porcentajes sobre la base.
--   gerencia_ajustes:
--     - tipo_is: el tipo del Impuesto sobre Sociedades. 15 % por defecto: la
--       empresa es de nueva creación (2026) y tributa al 15 % el primer
--       ejercicio con base positiva y el siguiente.
--     - cuota_is_anterior: la cuota íntegra del último modelo 200 presentado,
--       para los pagos fraccionados (modelo 202: 18 % de esa cuota en abril,
--       octubre y diciembre). Vacía: no hay pagos fraccionados.
--     - precio_metro: el precio del metro DTF sin IVA (7 €).
--
-- REVERSIBLE
--   Sí: quitar las columnas nuevas. Los gastos vuelven a leerse como mensuales.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Gastos: periodicidad, tipo e impuestos
-- ---------------------------------------------------------------------------
ALTER TABLE public.gerencia_gastos_fijos
  ADD COLUMN IF NOT EXISTS periodicidad TEXT NOT NULL DEFAULT 'mensual',
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'otros',
  ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irpf_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.gerencia_gastos_fijos
    ADD CONSTRAINT gerencia_gasto_periodicidad
      CHECK (periodicidad IN ('mensual', 'trimestral', 'anual', 'puntual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.gerencia_gastos_fijos
    ADD CONSTRAINT gerencia_gasto_tipo
      CHECK (tipo IN ('alquiler', 'profesional', 'nomina', 'seguridad_social', 'autonomo',
                      'suministro', 'seguro', 'financiero', 'software', 'otros'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.gerencia_gastos_fijos
    ADD CONSTRAINT gerencia_gasto_porcentajes
      CHECK (iva_pct >= 0 AND iva_pct <= 100 AND irpf_pct >= 0 AND irpf_pct <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.gerencia_gastos_fijos.importe_mensual IS
  'Base imponible de cada cargo, sin IVA, según la periodicidad (con mensual, al mes).';
COMMENT ON COLUMN public.gerencia_gastos_fijos.periodicidad IS
  'Cada cuánto se paga: mensual, trimestral, anual o puntual (una vez, en «desde»).';
COMMENT ON COLUMN public.gerencia_gastos_fijos.tipo IS
  'Qué es: decide el modelo del IRPF retenido (alquiler → 115; profesional y nómina → 111).';
COMMENT ON COLUMN public.gerencia_gastos_fijos.iva_pct IS
  'IVA soportado, en % de la base. Se recupera en el 303: no es coste.';
COMMENT ON COLUMN public.gerencia_gastos_fijos.irpf_pct IS
  'IRPF retenido al proveedor, en % de la base. Se ingresa en Hacienda: no es coste aparte.';

-- ---------------------------------------------------------------------------
-- 2. Datos fiscales de la empresa
-- ---------------------------------------------------------------------------
ALTER TABLE public.gerencia_ajustes
  ADD COLUMN IF NOT EXISTS tipo_is NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS cuota_is_anterior NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS precio_metro NUMERIC(10,4) NOT NULL DEFAULT 7;

DO $$ BEGIN
  ALTER TABLE public.gerencia_ajustes
    ADD CONSTRAINT gerencia_ajustes_valores
      CHECK (tipo_is >= 0 AND tipo_is <= 100
             AND (cuota_is_anterior IS NULL OR cuota_is_anterior >= 0)
             AND precio_metro > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.gerencia_ajustes.tipo_is IS
  'Tipo del Impuesto sobre Sociedades, en %. 15 para empresas de nueva creación.';
COMMENT ON COLUMN public.gerencia_ajustes.cuota_is_anterior IS
  'Cuota íntegra del último modelo 200, base de los pagos fraccionados (202). Vacía: no hay.';
COMMENT ON COLUMN public.gerencia_ajustes.precio_metro IS
  'Precio del metro DTF sin IVA.';
