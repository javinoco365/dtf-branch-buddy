ALTER TABLE public.empresa_global
  ADD COLUMN IF NOT EXISTS coste_consumibles_metro numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coste_packaging_metro numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coste_electricidad_metro numeric NOT NULL DEFAULT 0;

ALTER TABLE public.tiendas
  DROP COLUMN IF EXISTS coste_consumibles_metro,
  DROP COLUMN IF EXISTS coste_packaging_metro,
  DROP COLUMN IF EXISTS coste_electricidad_metro;