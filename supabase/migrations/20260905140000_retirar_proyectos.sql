-- ============================================================================
-- PROYECTOS · Retirar la funcionalidad
-- ============================================================================
--
-- POR QUÉ
--   Javier: «no voy a usar nada de proyectos». Las pantallas ya no existen
--   (esta misma rama borra la global y la de cada tienda), así que la tabla se
--   queda sin nadie que la lea ni la escriba.
--
-- ============================================================================
-- ESTO BORRA DATOS Y NO SE PUEDE DESHACER
-- ============================================================================
--   Un DROP TABLE se lleva las filas por delante. No hay papelera, no hay
--   vuelta atrás, y esta migración no la aplico yo.
--
--   ANTES DE EJECUTARLA, mira qué hay dentro:
--
--     SELECT count(*) AS filas,
--            min(created_at) AS primera,
--            max(created_at) AS ultima
--       FROM public.proyectos;
--
--     SELECT nombre, cliente_nombre, estado, fecha_prevista
--       FROM public.proyectos ORDER BY created_at DESC LIMIT 20;
--
--   Si sale 0 filas, adelante sin más. Si sale contenido que reconoces y
--   quieres conservarlo, exporta antes desde el editor de Supabase, o dilo y
--   te preparo la exportación.
--
-- QUÉ SE LLEVA
--   La tabla public.proyectos y el tipo public.proyecto_estado, que solo la
--   usaba ella. El resumen de borrado de tiendas deja de contar proyectos, en
--   la misma migración, porque si no seguiría consultando una tabla que ya no
--   existe y romperia el borrado de cualquier tienda.
--
-- REVERSIBLE
--   La estructura sí: está en las migraciones de Lovable. Los datos NO.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El resumen de borrado deja de mirar proyectos
-- ---------------------------------------------------------------------------
-- Va primero: si se dropeara la tabla antes, esta función quedaría rota entre
-- las dos sentencias y cualquier intento de borrar una tienda fallaría.
-- Es el cuerpo de 20260903240000 tal cual, sin la línea de proyectos. El
-- resto, «nombre» incluido, se conserva: la pantalla de borrado lo lee.
CREATE OR REPLACE FUNCTION public.tienda_resumen_borrado(_tienda_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'nombre',            (SELECT nombre FROM public.tiendas WHERE id = _tienda_id),
    'facturas_emitidas', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado <> 'borrador'),
    'facturas_borrador', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado = 'borrador'),
    'pedidos',           (SELECT count(*) FROM public.pedidos WHERE tienda_id = _tienda_id),
    'clientes',          (SELECT count(*) FROM public.clientes WHERE tienda_id = _tienda_id),
    'productos',         (SELECT count(*) FROM public.productos WHERE tienda_id = _tienda_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Fuera la tabla
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.proyectos;
DROP TYPE IF EXISTS public.proyecto_estado;
