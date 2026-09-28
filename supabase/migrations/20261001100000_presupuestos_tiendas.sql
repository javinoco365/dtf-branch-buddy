-- ============================================================================
-- PRESUPUESTOS EN LAS TIENDAS · y productos genéricos para todas
-- ============================================================================
--
-- QUÉ RESUELVE
--   Solo el textil tenía presupuestos. Una tienda no podía preparar uno para
--   un cliente antes de convertirlo en pedido. Y cada producto era de una
--   tienda: un producto que se vende en todas había que darlo de alta en cada
--   una.
--
-- QUÉ HACE
--   1. Productos genéricos: productos.tienda_id pasa a admitir NULL. Un
--      producto sin tienda es de la empresa y sale en todas las tiendas. Los
--      que trae WooCommerce siguen siendo de su tienda (un genérico no puede
--      llevar woo_product_id).
--   2. La política FOR ALL de productos se sustituye por cuatro, una por
--      operación, que además cubren los genéricos.
--   3. tiendas.prefijo: el código corto de la tienda en sus documentos, p. ej.
--      DCUL en PRES-DCUL-2026-0001. Se rellena a partir del slug o el nombre y
--      se puede cambiar en Ajustes.
--   4. presupuestos y presupuesto_items: presupuestos de una tienda, con su
--      cliente de la ficha única, sus líneas (de un producto o libres) con los
--      importes congelados, su envío y su estado. La numeración va por tienda
--      y ejercicio con siguiente_numero() (ámbito 'presupuesto:<tienda>').
--
-- REGLAS
--   - Los importes de cada línea se congelan: cambiar el precio del producto
--     después no toca presupuestos ya hechos.
--   - Numeración sin carrera posible (siguiente_numero bloquea la fila del
--     contador). Admite huecos, como la de presupuestos textil: no es factura.
--   - RLS por operación. Sin FOR ALL.
--   - pedido_id queda preparado para la fase siguiente (confirmar un
--     presupuesto crea su pedido).
--
-- REVERSIBLE
--   Sí, salvo por los datos que se creen después: DROP de las dos tablas, del
--   tipo y de la columna prefijo; y volver a poner NOT NULL en
--   productos.tienda_id (solo si no se han creado genéricos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Productos genéricos
-- ---------------------------------------------------------------------------
ALTER TABLE public.productos ALTER COLUMN tienda_id DROP NOT NULL;

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS producto_generico_sin_woo;
ALTER TABLE public.productos ADD CONSTRAINT producto_generico_sin_woo
  CHECK (tienda_id IS NOT NULL OR woo_product_id IS NULL);

CREATE INDEX IF NOT EXISTS productos_genericos_idx
  ON public.productos (empresa_id) WHERE tienda_id IS NULL;

COMMENT ON COLUMN public.productos.tienda_id IS
  'La tienda del producto. NULL: genérico, de la empresa, disponible en todas '
  'las tiendas. Los de WooCommerce siempre tienen tienda.';

-- Quien ve un producto: el de una tienda, quien es de esa tienda; el genérico,
-- quien es de la empresa.
CREATE OR REPLACE FUNCTION public.producto_visible(_tienda_id UUID, _empresa_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _tienda_id IS NULL THEN public.es_miembro_empresa(auth.uid(), _empresa_id)
    ELSE public.is_tienda_member(auth.uid(), _tienda_id)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.producto_visible(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_visible(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "productos member access" ON public.productos;

DROP POLICY IF EXISTS "productos lectura" ON public.productos;
CREATE POLICY "productos lectura" ON public.productos
  FOR SELECT TO authenticated
  USING (public.producto_visible(tienda_id, empresa_id));

DROP POLICY IF EXISTS "productos alta" ON public.productos;
CREATE POLICY "productos alta" ON public.productos
  FOR INSERT TO authenticated
  WITH CHECK (public.producto_visible(tienda_id, empresa_id));

DROP POLICY IF EXISTS "productos edicion" ON public.productos;
CREATE POLICY "productos edicion" ON public.productos
  FOR UPDATE TO authenticated
  USING (public.producto_visible(tienda_id, empresa_id))
  WITH CHECK (public.producto_visible(tienda_id, empresa_id));

DROP POLICY IF EXISTS "productos baja" ON public.productos;
CREATE POLICY "productos baja" ON public.productos
  FOR DELETE TO authenticated
  USING (public.producto_visible(tienda_id, empresa_id));

-- ---------------------------------------------------------------------------
-- 2. El prefijo de la tienda en sus documentos
-- ---------------------------------------------------------------------------
ALTER TABLE public.tiendas ADD COLUMN IF NOT EXISTS prefijo TEXT;

-- De «dtf-culture» o «DTF Culture» sale DTFC: letras y números, en mayúsculas,
-- los cuatro primeros. Si no queda nada, TDA.
UPDATE public.tiendas
   SET prefijo = COALESCE(
         NULLIF(upper(left(regexp_replace(COALESCE(NULLIF(slug, ''), nombre), '[^A-Za-z0-9]', '', 'g'), 4)), ''),
         'TDA')
 WHERE prefijo IS NULL;

ALTER TABLE public.tiendas DROP CONSTRAINT IF EXISTS tienda_prefijo_valido;
ALTER TABLE public.tiendas ADD CONSTRAINT tienda_prefijo_valido
  CHECK (prefijo IS NULL OR prefijo ~ '^[A-Z0-9]{1,8}$');

COMMENT ON COLUMN public.tiendas.prefijo IS
  'Código corto de la tienda en sus documentos: PRES-<prefijo>-2026-0001. '
  'Mayúsculas y números, hasta 8.';

-- ---------------------------------------------------------------------------
-- 3. Presupuestos
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.presupuesto_estado AS ENUM ('borrador', 'enviado', 'aceptado', 'rechazado');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.presupuesto_estado ya existe, se omite';
END $$;

CREATE TABLE IF NOT EXISTS public.presupuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  -- Congelados: el presupuesto dice a quién se hizo aunque la ficha cambie.
  cliente_nombre TEXT,
  cliente_email TEXT,
  cliente_telefono TEXT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias INT NOT NULL DEFAULT 30,
  estado public.presupuesto_estado NOT NULL DEFAULT 'borrador',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  envio NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas TEXT,
  -- El pedido que salió de este presupuesto al confirmarlo (fase siguiente).
  pedido_id UUID REFERENCES public.pedidos(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT presupuesto_numero_por_tienda UNIQUE (tienda_id, numero),
  CONSTRAINT presupuesto_validez_positiva CHECK (validez_dias > 0),
  CONSTRAINT presupuesto_importes_no_negativos CHECK (
    subtotal >= 0 AND iva >= 0 AND envio >= 0 AND total >= 0
  )
);

CREATE INDEX IF NOT EXISTS presupuestos_por_tienda
  ON public.presupuestos (tienda_id, fecha DESC);
CREATE INDEX IF NOT EXISTS presupuestos_por_cliente
  ON public.presupuestos (cliente_id) WHERE cliente_id IS NOT NULL;

COMMENT ON TABLE public.presupuestos IS
  'Presupuestos de las tiendas. Numeración por tienda y ejercicio con '
  'siguiente_numero(ámbito presupuesto:<tienda_id>).';

CREATE TABLE IF NOT EXISTS public.presupuesto_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id UUID NOT NULL REFERENCES public.presupuestos(id) ON DELETE CASCADE,
  -- De dónde salió la línea, si salió de un producto. Borrar el producto no
  -- cambia la línea: la descripción y el precio están copiados aquí.
  producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  orden INT NOT NULL DEFAULT 0,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,3) NOT NULL,
  unidad TEXT NOT NULL DEFAULT 'ud',
  precio_unitario NUMERIC(12,4) NOT NULL,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 21,
  subtotal NUMERIC(12,2) NOT NULL,
  iva NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT presupuesto_item_cantidad_positiva CHECK (cantidad > 0),
  CONSTRAINT presupuesto_item_precio_no_negativo CHECK (precio_unitario >= 0),
  CONSTRAINT presupuesto_item_iva_valido CHECK (iva_rate >= 0 AND iva_rate <= 100)
);

CREATE INDEX IF NOT EXISTS presupuesto_items_por_presupuesto
  ON public.presupuesto_items (presupuesto_id, orden);

DROP TRIGGER IF EXISTS presupuestos_touch ON public.presupuestos;
CREATE TRIGGER presupuestos_touch
  BEFORE UPDATE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presupuestos, public.presupuesto_items
  TO authenticated;
GRANT ALL ON public.presupuestos, public.presupuesto_items TO service_role;
REVOKE ALL ON public.presupuestos, public.presupuesto_items FROM anon;

ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presupuesto_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presupuestos lectura" ON public.presupuestos;
CREATE POLICY "presupuestos lectura" ON public.presupuestos
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "presupuestos alta" ON public.presupuestos;
CREATE POLICY "presupuestos alta" ON public.presupuestos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "presupuestos edicion" ON public.presupuestos;
CREATE POLICY "presupuestos edicion" ON public.presupuestos
  FOR UPDATE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "presupuestos baja" ON public.presupuestos;
CREATE POLICY "presupuestos baja" ON public.presupuestos
  FOR DELETE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

-- Las líneas, por la tienda de su presupuesto.
CREATE OR REPLACE FUNCTION public.presupuesto_visible(_presupuesto_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.presupuestos p
     WHERE p.id = _presupuesto_id
       AND public.is_tienda_member(auth.uid(), p.tienda_id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.presupuesto_visible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presupuesto_visible(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "presupuesto_items lectura" ON public.presupuesto_items;
CREATE POLICY "presupuesto_items lectura" ON public.presupuesto_items
  FOR SELECT TO authenticated
  USING (public.presupuesto_visible(presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_items alta" ON public.presupuesto_items;
CREATE POLICY "presupuesto_items alta" ON public.presupuesto_items
  FOR INSERT TO authenticated
  WITH CHECK (public.presupuesto_visible(presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_items edicion" ON public.presupuesto_items;
CREATE POLICY "presupuesto_items edicion" ON public.presupuesto_items
  FOR UPDATE TO authenticated
  USING (public.presupuesto_visible(presupuesto_id))
  WITH CHECK (public.presupuesto_visible(presupuesto_id));

DROP POLICY IF EXISTS "presupuesto_items baja" ON public.presupuesto_items;
CREATE POLICY "presupuesto_items baja" ON public.presupuesto_items
  FOR DELETE TO authenticated
  USING (public.presupuesto_visible(presupuesto_id));

DROP TRIGGER IF EXISTS presupuestos_auditoria ON public.presupuestos;
CREATE TRIGGER presupuestos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS presupuesto_items_auditoria ON public.presupuesto_items;
CREATE TRIGGER presupuesto_items_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.presupuesto_items
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
