ALTER TABLE public.tiendas
  ADD COLUMN IF NOT EXISTS coste_consumibles_metro numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coste_packaging_metro numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coste_electricidad_metro numeric NOT NULL DEFAULT 0;