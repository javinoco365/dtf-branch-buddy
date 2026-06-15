
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TYPE public.pedido_estado AS ENUM (
  'pendiente', 'en_produccion', 'imprimiendo', 'listo', 'enviado', 'entregado', 'cancelado'
);

CREATE TYPE public.factura_estado AS ENUM (
  'borrador', 'emitida', 'pagada', 'vencida', 'anulada'
);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- USER_ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "user_roles select own or admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles select own or admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles update own or admin" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- TIENDAS
CREATE TABLE public.tiendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  razon_social TEXT,
  cif TEXT,
  direccion TEXT,
  codigo_postal TEXT,
  ciudad TEXT,
  provincia TEXT,
  pais TEXT DEFAULT 'España',
  email_fiscal TEXT,
  telefono TEXT,
  woo_url TEXT,
  sync_enabled BOOLEAN NOT NULL DEFAULT false,
  serie_factura TEXT NOT NULL DEFAULT 'A',
  siguiente_numero_factura INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#3b82f6',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiendas TO authenticated;
GRANT ALL ON public.tiendas TO service_role;
ALTER TABLE public.tiendas ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER tiendas_touch BEFORE UPDATE ON public.tiendas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- TIENDA_USUARIOS
CREATE TABLE public.tienda_usuarios (
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tienda_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.tienda_usuarios TO authenticated;
GRANT ALL ON public.tienda_usuarios TO service_role;
ALTER TABLE public.tienda_usuarios ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tienda_member(_user_id UUID, _tienda_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tienda_usuarios WHERE user_id = _user_id AND tienda_id = _tienda_id
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE POLICY "tienda_usuarios select" ON public.tienda_usuarios FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "tienda_usuarios admin write" ON public.tienda_usuarios FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tiendas select members" ON public.tiendas FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), id));
CREATE POLICY "tiendas admin write" ON public.tiendas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- CREDENCIALES (service_role only)
CREATE TABLE public.tienda_credenciales (
  tienda_id UUID PRIMARY KEY REFERENCES public.tiendas(id) ON DELETE CASCADE,
  consumer_key TEXT NOT NULL,
  consumer_secret TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.tienda_credenciales TO service_role;
ALTER TABLE public.tienda_credenciales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no direct access creds" ON public.tienda_credenciales FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER tienda_credenciales_touch BEFORE UPDATE ON public.tienda_credenciales FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- CLIENTES
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  woo_customer_id BIGINT,
  nombre TEXT NOT NULL,
  email TEXT, telefono TEXT, nif TEXT, empresa TEXT,
  direccion TEXT, codigo_postal TEXT, ciudad TEXT, provincia TEXT,
  pais TEXT DEFAULT 'España', notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, woo_customer_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT ALL ON public.clientes TO service_role;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE INDEX clientes_tienda_idx ON public.clientes(tienda_id);
CREATE TRIGGER clientes_touch BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE POLICY "clientes member access" ON public.clientes FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

-- PRODUCTOS
CREATE TABLE public.productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  woo_product_id BIGINT,
  sku TEXT, nombre TEXT NOT NULL, descripcion TEXT,
  unidad TEXT NOT NULL DEFAULT 'm',
  precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, woo_product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.productos TO authenticated;
GRANT ALL ON public.productos TO service_role;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
CREATE INDEX productos_tienda_idx ON public.productos(tienda_id);
CREATE TRIGGER productos_touch BEFORE UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE POLICY "productos member access" ON public.productos FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

-- PEDIDOS
CREATE TABLE public.pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  woo_order_id BIGINT,
  numero TEXT NOT NULL,
  estado public.pedido_estado NOT NULL DEFAULT 'pendiente',
  metros_total NUMERIC(12,3) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_pedido TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_entrega TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, woo_order_id),
  UNIQUE (tienda_id, numero)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos TO authenticated;
GRANT ALL ON public.pedidos TO service_role;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
CREATE INDEX pedidos_tienda_idx ON public.pedidos(tienda_id);
CREATE INDEX pedidos_fecha_idx ON public.pedidos(fecha_pedido DESC);
CREATE TRIGGER pedidos_touch BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE POLICY "pedidos member access" ON public.pedidos FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

-- PEDIDO_ITEMS
CREATE TABLE public.pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
  unidad TEXT NOT NULL DEFAULT 'm',
  precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedido_items TO authenticated;
GRANT ALL ON public.pedido_items TO service_role;
ALTER TABLE public.pedido_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX pedido_items_pedido_idx ON public.pedido_items(pedido_id);
CREATE POLICY "pedido_items member access" ON public.pedido_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

-- FACTURAS
CREATE TABLE public.facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  pedido_id UUID REFERENCES public.pedidos(id) ON DELETE SET NULL,
  serie TEXT NOT NULL DEFAULT 'A',
  numero INTEGER NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  base_imponible NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado public.factura_estado NOT NULL DEFAULT 'borrador',
  pdf_url TEXT,
  notas TEXT,
  cliente_nombre TEXT, cliente_nif TEXT, cliente_direccion TEXT,
  emisor_nombre TEXT, emisor_cif TEXT, emisor_direccion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, serie, numero)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facturas TO authenticated;
GRANT ALL ON public.facturas TO service_role;
ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;
CREATE INDEX facturas_tienda_idx ON public.facturas(tienda_id);
CREATE INDEX facturas_fecha_idx ON public.facturas(fecha DESC);
CREATE TRIGGER facturas_touch BEFORE UPDATE ON public.facturas FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE POLICY "facturas member access" ON public.facturas FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

-- FACTURA_ITEMS
CREATE TABLE public.factura_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
  unidad TEXT NOT NULL DEFAULT 'm',
  precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.factura_items TO authenticated;
GRANT ALL ON public.factura_items TO service_role;
ALTER TABLE public.factura_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX factura_items_factura_idx ON public.factura_items(factura_id);
CREATE POLICY "factura_items member access" ON public.factura_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.facturas f WHERE f.id = factura_items.factura_id AND public.is_tienda_member(auth.uid(), f.tienda_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.facturas f WHERE f.id = factura_items.factura_id AND public.is_tienda_member(auth.uid(), f.tienda_id)));
