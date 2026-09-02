-- ============================================================================
-- CIMIENTOS 1/6 · La empresa como entidad de primer nivel
-- ============================================================================
--
-- QUÉ HACE
--   Crea public.empresas y añade empresa_id a las tablas raíz del negocio,
--   rellenándolo con la empresa única que ya existe.
--
-- POR QUÉ
--   Hoy no hay ninguna columna empresa_id en las 25 tablas del esquema, y los
--   datos de la sociedad viven en empresa_global: una tabla con clave primaria
--   BOOLEAN y CHECK (id = true), es decir, una tabla que por construcción no
--   puede tener más de una fila. Hoy DTI es una sola sociedad, pero el modelo
--   tiene que soportar varias sin migración, y la factura, el cliente y el
--   pedido cuelgan todos de este concepto.
--
-- QUÉ NO HACE
--   No toca empresa_global ni la elimina. Las dos tablas conviven durante la
--   transición y un trigger replica en empresas lo que se escriba en
--   empresa_global, para que no puedan divergir mientras la aplicación siga
--   leyendo la vieja. La retirada de empresa_global va en una migración
--   posterior, cuando ninguna consulta la lea.
--
-- REVERSIBLE
--   Sí. Basta con eliminar las columnas empresa_id, el trigger de réplica y la
--   tabla empresas. Ninguna columna existente se modifica ni se borra.
--
-- SOBRE EL IDIOMA DE LAS COLUMNAS
--   created_at / updated_at se mantienen en inglés para no partir en dos la
--   convención: las 25 tablas existentes las llaman así. Unificarlo al español
--   es una decisión aparte, y renombrarlas ahora rompería todo el código.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social TEXT NOT NULL,
  cif TEXT,
  direccion TEXT,
  codigo_postal TEXT,
  ciudad TEXT,
  provincia TEXT,
  pais TEXT DEFAULT 'España',
  email_fiscal TEXT,
  telefono TEXT,
  -- Costes de producción por metro lineal. Se congelan en la línea cuando se
  -- vende; estos son solo el valor vigente.
  coste_consumibles_metro NUMERIC NOT NULL DEFAULT 0,
  coste_packaging_metro NUMERIC NOT NULL DEFAULT 0,
  coste_electricidad_metro NUMERIC NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.empresas IS
  'Sociedades del grupo. Hoy solo hay una (DTI S.L.); el modelo admite varias.';

GRANT SELECT ON public.empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER empresas_touch BEFORE UPDATE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Semilla desde empresa_global
-- ---------------------------------------------------------------------------
-- Copia la fila única que ya existe. Si empresa_global estuviera vacía o sin
-- razón social, se crea igualmente una empresa con un nombre provisional para
-- que las claves foráneas de más abajo tengan a qué apuntar.
INSERT INTO public.empresas (
  razon_social, cif, direccion, codigo_postal, ciudad, provincia, pais,
  email_fiscal, telefono,
  coste_consumibles_metro, coste_packaging_metro, coste_electricidad_metro
)
SELECT
  COALESCE(NULLIF(TRIM(eg.razon_social), ''), 'Empresa sin nombre'),
  eg.cif, eg.direccion, eg.codigo_postal, eg.ciudad, eg.provincia,
  COALESCE(eg.pais, 'España'), eg.email_fiscal, eg.telefono,
  COALESCE(eg.coste_consumibles_metro, 0),
  COALESCE(eg.coste_packaging_metro, 0),
  COALESCE(eg.coste_electricidad_metro, 0)
FROM public.empresa_global eg
WHERE NOT EXISTS (SELECT 1 FROM public.empresas);

-- Red de seguridad: si empresa_global no tenía ninguna fila.
INSERT INTO public.empresas (razon_social)
SELECT 'Empresa sin nombre'
WHERE NOT EXISTS (SELECT 1 FROM public.empresas);

-- ---------------------------------------------------------------------------
-- 3. La empresa por defecto, mientras solo haya una
-- ---------------------------------------------------------------------------
-- Devuelve la única empresa activa. En cuanto haya más de una, esta función
-- deja de servir y hay que resolver la empresa por pertenencia del usuario:
-- por eso lanza una excepción en vez de elegir una en silencio.
CREATE OR REPLACE FUNCTION public.empresa_por_defecto()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_total INT;
BEGIN
  SELECT count(*) INTO v_total FROM public.empresas WHERE activa;
  IF v_total > 1 THEN
    RAISE EXCEPTION
      'Hay % empresas activas: la empresa ya no se puede deducir, hay que resolverla por pertenencia del usuario', v_total;
  END IF;
  SELECT id INTO v_id FROM public.empresas WHERE activa LIMIT 1;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.empresa_por_defecto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empresa_por_defecto() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. empresa_id en las tablas raíz
-- ---------------------------------------------------------------------------
-- Solo en las raíces. Las tablas de línea (pedido_items, factura_items,
-- textil_*_items, enlaces_seguimiento, tienda_credenciales,
-- tienda_seguimiento_config) heredan la empresa por su clave foránea al padre,
-- que es como ya funciona su RLS. Denormalizarla ahí obligaría a mantenerla
-- sincronizada con triggers sin ganar nada.
DO $$
DECLARE
  v_tabla TEXT;
  v_empresa UUID;
  v_raices TEXT[] := ARRAY[
    'tiendas', 'clientes', 'productos', 'pedidos', 'facturas', 'proyectos',
    'pedido_devoluciones',
    'textil_marcas', 'textil_stock', 'textil_clientes',
    'textil_presupuestos', 'textil_pedidos', 'textil_facturas'
  ];
BEGIN
  SELECT id INTO v_empresa FROM public.empresas WHERE activa LIMIT 1;

  FOREACH v_tabla IN ARRAY v_raices LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tabla
    ) THEN
      RAISE NOTICE 'La tabla % no existe, se omite', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS empresa_id UUID', v_tabla);

    EXECUTE format(
      'UPDATE public.%I SET empresa_id = %L WHERE empresa_id IS NULL', v_tabla, v_empresa);

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN empresa_id SET NOT NULL', v_tabla);

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN empresa_id SET DEFAULT public.empresa_por_defecto()',
      v_tabla);

    -- La empresa no se borra en cascada: si alguien intenta eliminar una
    -- sociedad que todavía tiene pedidos o facturas, la operación falla.
    -- Es exactamente lo que queremos con datos fiscales.
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (empresa_id) '
      'REFERENCES public.empresas(id) ON DELETE RESTRICT',
      v_tabla, v_tabla || '_empresa_fk');

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (empresa_id)',
      v_tabla || '_empresa_idx', v_tabla);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Mientras convivan empresa_global y empresas
-- ---------------------------------------------------------------------------
-- La aplicación todavía escribe en empresa_global desde Ajustes › Datos de la
-- empresa. Este trigger replica esos cambios en empresas para que las dos no
-- puedan divergir. Se elimina junto con empresa_global cuando la aplicación
-- deje de leerla.
CREATE OR REPLACE FUNCTION public.empresa_global_replicar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.empresas SET
    razon_social = COALESCE(NULLIF(TRIM(NEW.razon_social), ''), razon_social),
    cif = NEW.cif,
    direccion = NEW.direccion,
    codigo_postal = NEW.codigo_postal,
    ciudad = NEW.ciudad,
    provincia = NEW.provincia,
    pais = COALESCE(NEW.pais, 'España'),
    email_fiscal = NEW.email_fiscal,
    telefono = NEW.telefono,
    coste_consumibles_metro = COALESCE(NEW.coste_consumibles_metro, 0),
    coste_packaging_metro = COALESCE(NEW.coste_packaging_metro, 0),
    coste_electricidad_metro = COALESCE(NEW.coste_electricidad_metro, 0)
  WHERE id = public.empresa_por_defecto();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS empresa_global_replicar_trg ON public.empresa_global;
CREATE TRIGGER empresa_global_replicar_trg
  AFTER INSERT OR UPDATE ON public.empresa_global
  FOR EACH ROW EXECUTE FUNCTION public.empresa_global_replicar();

-- ---------------------------------------------------------------------------
-- 6. RLS de empresas
-- ---------------------------------------------------------------------------
-- Cualquier usuario autenticado puede leer los datos de la sociedad: los
-- necesita para pintar una factura. Solo los administradores escriben.
DROP POLICY IF EXISTS "empresas lectura autenticados" ON public.empresas;
CREATE POLICY "empresas lectura autenticados" ON public.empresas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "empresas escritura admin" ON public.empresas;
CREATE POLICY "empresas escritura admin" ON public.empresas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
