ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente_nombre TEXT;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente_email TEXT;