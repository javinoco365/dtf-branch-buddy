-- ============================================================================
-- LA SOCIEDAD NO SE BORRA · Coherencia con lo que ya decidió la fase 2
-- ============================================================================
--
-- QUÉ PASA
--   La fase 2 dejó escrito, y con razón, que las tablas de negocio cuelgan de
--   empresas con ON DELETE RESTRICT:
--
--     «La empresa no se borra en cascada: si alguien intenta eliminar una
--      sociedad que todavía tiene pedidos o facturas, la operación falla.
--      Es exactamente lo que queremos con datos fiscales.»
--
--   Las siete tablas que se han añadido después NO siguen esa regla: las puse
--   con ON DELETE CASCADE. Son el libro de movimientos de stock, las reservas,
--   las compras, los movimientos del banco, los contadores y las plantillas de
--   correo.
--
-- POR QUÉ IMPORTA
--   Hoy el riesgo está tapado: basta una factura o un pedido para que el
--   RESTRICT de esas tablas haga fallar el borrado entero, y las cascadas no
--   llegan a ejecutarse. Pero es una protección prestada, no propia. En una
--   sociedad recién creada, o si algún día se separa el negocio en dos
--   empresas y una queda sin facturas, borrarla se llevaría por delante el
--   libro de stock entero — que es justo el que no se puede reconstruir,
--   porque sus movimientos son inmutables por diseño.
--
--   Un libro que se puede borrar de golpe no es un libro.
--
-- QUÉ MÁS
--   La política de empresas está en FOR ALL, que es lo que permite borrar la
--   fila de la sociedad. Pasa a tres políticas por operación, sin DELETE: la
--   sociedad no se borra desde la aplicación, ni teniendo datos ni sin ellos.
--
-- REVERSIBLE
--   Sí. Cambia siete claves ajenas y reparte una política en tres. No toca
--   ninguna fila.
-- ============================================================================

DO $$
DECLARE
  v_tabla TEXT;
  v_restriccion TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY[
    'tienda_plantillas_correo',
    'pedido_correos_enviados',
    'textil_stock_movimientos',
    'textil_stock_reservas',
    'textil_compras',
    'banco_movimientos',
    'contadores'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = v_tabla
    ) THEN
      RAISE NOTICE 'La tabla % no existe todavía, se omite', v_tabla;
      CONTINUE;
    END IF;

    -- El nombre de la restricción lo puso Postgres al crearla, así que se
    -- busca por lo que es y no por cómo se llama.
    SELECT con.conname INTO v_restriccion
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_class ref ON ref.oid = con.confrelid
     WHERE rel.relname = v_tabla
       AND ref.relname = 'empresas'
       AND con.contype = 'f'
     LIMIT 1;

    IF v_restriccion IS NULL THEN
      RAISE NOTICE 'La tabla % no tiene clave ajena a empresas, se omite', v_tabla;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_tabla, v_restriccion);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (empresa_id) '
      'REFERENCES public.empresas(id) ON DELETE RESTRICT',
      v_tabla, v_tabla || '_empresa_fk');

    RAISE NOTICE 'La tabla % ya no se borra en cascada con la sociedad', v_tabla;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- La sociedad tampoco se borra desde la aplicación
-- ---------------------------------------------------------------------------
-- «empresas escritura admin» estaba en FOR ALL, que incluye DELETE sin decirlo.
-- Un FOR ALL no se lee: no se sabe si borrar estaba permitido a propósito o de
-- rebote. Se reparte en tres, y el borrado no está.
DROP POLICY IF EXISTS "empresas escritura admin" ON public.empresas;

DROP POLICY IF EXISTS "empresas alta" ON public.empresas;
CREATE POLICY "empresas alta" ON public.empresas
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "empresas edicion" ON public.empresas;
CREATE POLICY "empresas edicion" ON public.empresas
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Sin política de DELETE, y sin permiso tampoco: una sociedad que ha emitido
-- facturas no desaparece del sistema. Si algún día hay que dar de baja una,
-- se desactiva.
REVOKE DELETE ON public.empresas FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- El juego de políticas duplicado del bucket de facturas
-- ---------------------------------------------------------------------------
-- Quedó anotado al arreglar el cast que reventaba: el bucket 'facturas' tiene
-- OCHO políticas para cuatro operaciones, dos juegos que dicen lo mismo con
-- nombres distintos. Ahora los dos son correctos, así que quitar uno no cambia
-- el comportamiento — pero dejar duplicados es garantizar que el día que haya
-- que tocarlos se toque solo la mitad, que es exactamente lo que acababa de
-- pasar.
--
-- Se quedan las de nombre en español, que es la convención del proyecto.
DROP POLICY IF EXISTS "Facturas read for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas insert for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas update for tienda members" ON storage.objects;
DROP POLICY IF EXISTS "Facturas delete for tienda members" ON storage.objects;
