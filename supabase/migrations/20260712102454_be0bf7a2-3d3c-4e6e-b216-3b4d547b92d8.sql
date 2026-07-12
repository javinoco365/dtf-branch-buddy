
-- MARCAS COMERCIALES
CREATE TABLE public.textil_marcas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  logo_url TEXT,
  color TEXT DEFAULT '#3b82f6',
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_marcas TO authenticated;
GRANT ALL ON public.textil_marcas TO service_role;
ALTER TABLE public.textil_marcas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read marcas" ON public.textil_marcas FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write marcas" ON public.textil_marcas FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_textil_marcas_updated BEFORE UPDATE ON public.textil_marcas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.empresa_global ADD COLUMN IF NOT EXISTS textil_marca_predeterminada_id UUID REFERENCES public.textil_marcas(id) ON DELETE SET NULL;

-- STOCK
CREATE TABLE public.textil_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT,
  nombre TEXT NOT NULL,
  categoria TEXT,
  color TEXT,
  talla TEXT,
  cantidad NUMERIC NOT NULL DEFAULT 0,
  cantidad_minima NUMERIC NOT NULL DEFAULT 0,
  coste_unitario NUMERIC NOT NULL DEFAULT 0,
  precio_venta NUMERIC NOT NULL DEFAULT 0,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_stock TO authenticated;
GRANT ALL ON public.textil_stock TO service_role;
ALTER TABLE public.textil_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all stock" ON public.textil_stock FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_textil_stock_updated BEFORE UPDATE ON public.textil_stock FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- CLIENTES
CREATE TABLE public.textil_clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  nif TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_clientes TO authenticated;
GRANT ALL ON public.textil_clientes TO service_role;
ALTER TABLE public.textil_clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_clientes" ON public.textil_clientes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_textil_clientes_updated BEFORE UPDATE ON public.textil_clientes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- PRESUPUESTOS
CREATE TYPE public.textil_presupuesto_estado AS ENUM ('borrador','enviado','aceptado','rechazado','facturado');

CREATE TABLE public.textil_presupuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  cliente_id UUID REFERENCES public.textil_clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT,
  cliente_email TEXT,
  cliente_nif TEXT,
  cliente_direccion TEXT,
  marca_id UUID REFERENCES public.textil_marcas(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias INTEGER NOT NULL DEFAULT 30,
  estado public.textil_presupuesto_estado NOT NULL DEFAULT 'borrador',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  iva NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  notas TEXT,
  factura_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_presupuestos TO authenticated;
GRANT ALL ON public.textil_presupuestos TO service_role;
ALTER TABLE public.textil_presupuestos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_presupuestos" ON public.textil_presupuestos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_textil_presupuestos_updated BEFORE UPDATE ON public.textil_presupuestos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.textil_presupuesto_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id UUID NOT NULL REFERENCES public.textil_presupuestos(id) ON DELETE CASCADE,
  stock_id UUID REFERENCES public.textil_stock(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC NOT NULL DEFAULT 1,
  precio_unitario NUMERIC NOT NULL DEFAULT 0,
  iva_pct NUMERIC NOT NULL DEFAULT 21,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_presupuesto_items TO authenticated;
GRANT ALL ON public.textil_presupuesto_items TO service_role;
ALTER TABLE public.textil_presupuesto_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_presupuesto_items" ON public.textil_presupuesto_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PEDIDOS
CREATE TABLE public.textil_pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  cliente_id UUID REFERENCES public.textil_clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT,
  cliente_email TEXT,
  marca_id UUID REFERENCES public.textil_marcas(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  metodo_pago TEXT,
  envio NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  iva NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  tracking_empresa TEXT,
  tracking_numero TEXT,
  tracking_url TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_pedidos TO authenticated;
GRANT ALL ON public.textil_pedidos TO service_role;
ALTER TABLE public.textil_pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_pedidos" ON public.textil_pedidos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_textil_pedidos_updated BEFORE UPDATE ON public.textil_pedidos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.textil_pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES public.textil_pedidos(id) ON DELETE CASCADE,
  stock_id UUID REFERENCES public.textil_stock(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC NOT NULL DEFAULT 1,
  precio_unitario NUMERIC NOT NULL DEFAULT 0,
  iva_pct NUMERIC NOT NULL DEFAULT 21,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_pedido_items TO authenticated;
GRANT ALL ON public.textil_pedido_items TO service_role;
ALTER TABLE public.textil_pedido_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_pedido_items" ON public.textil_pedido_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- FACTURAS
CREATE TABLE public.textil_facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  serie TEXT,
  cliente_id UUID REFERENCES public.textil_clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT,
  cliente_email TEXT,
  cliente_nif TEXT,
  cliente_direccion TEXT,
  marca_id UUID REFERENCES public.textil_marcas(id) ON DELETE SET NULL,
  presupuesto_id UUID REFERENCES public.textil_presupuestos(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  vencimiento DATE,
  estado TEXT NOT NULL DEFAULT 'emitida',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  iva NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  metodo_pago TEXT,
  notas TEXT,
  pdf_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_facturas TO authenticated;
GRANT ALL ON public.textil_facturas TO service_role;
ALTER TABLE public.textil_facturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_facturas" ON public.textil_facturas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_textil_facturas_updated BEFORE UPDATE ON public.textil_facturas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.textil_factura_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID NOT NULL REFERENCES public.textil_facturas(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC NOT NULL DEFAULT 1,
  precio_unitario NUMERIC NOT NULL DEFAULT 0,
  iva_pct NUMERIC NOT NULL DEFAULT 21,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_factura_items TO authenticated;
GRANT ALL ON public.textil_factura_items TO service_role;
ALTER TABLE public.textil_factura_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all textil_factura_items" ON public.textil_factura_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- FK diferida presupuestos.factura_id
ALTER TABLE public.textil_presupuestos
  ADD CONSTRAINT textil_presupuestos_factura_id_fkey
  FOREIGN KEY (factura_id) REFERENCES public.textil_facturas(id) ON DELETE SET NULL;
