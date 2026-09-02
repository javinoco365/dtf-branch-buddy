-- ============================================================================
-- LIMPIEZA · Borrar el pedido de ejemplo DEMO-1001
-- ============================================================================
--
-- QUÉ HACE
--   BORRA DATOS REALES: elimina el pedido DEMO-1001 de la tienda
--   a355e864-2fcd-43ba-947c-5338efb9f311, con sus líneas y su enlace de
--   seguimiento, que caen por cascada.
--
-- AUTORIZACIÓN
--   Javier lo autorizó expresamente. Sin esa autorización esta migración no
--   existiría: la regla del proyecto es que nada destructivo se ejecuta sin
--   permiso explícito, y una fila en producción es un dato real aunque su
--   contenido sea inventado.
--
-- POR QUÉ
--   La migración 20260816115005 insertó ese pedido para previsualizar el
--   formato: cliente «Cliente Demo», correo demo@dtfculture.es, 3,5 m, 68,43 €,
--   y un seguimiento de CTT Express. Mientras las pantallas mostraban datos
--   sintéticos daba igual. Ahora que leen la base de verdad, esa fila entra en
--   los KPIs, en la facturación consolidada y en cualquier exportación, mezclada
--   con pedidos auténticos.
--
-- QUÉ BORRA EXACTAMENTE
--   Un pedido, identificado por tienda y número. Si no existe, no hace nada.
--   No toca ninguna otra fila.
--
-- QUÉ ARRASTRA POR CASCADA
--   pedido_items       (FK pedido_id ON DELETE CASCADE)
--   enlaces_seguimiento (FK pedido_id ON DELETE CASCADE)
--
-- NO ES REVERSIBLE
--   Los datos borrados no se recuperan. Antes de aplicarla, comprueba qué se
--   va a llevar por delante:
--
--     SELECT p.id, p.numero, p.total, p.fecha_pedido,
--            (SELECT count(*) FROM public.pedido_items i WHERE i.pedido_id = p.id) AS lineas
--     FROM public.pedidos p
--     WHERE p.tienda_id = 'a355e864-2fcd-43ba-947c-5338efb9f311'
--       AND p.numero = 'DEMO-1001';
--
--   Debe devolver exactamente una fila. Si devuelve más de una o ninguna,
--   PARA y revisa antes de continuar.
-- ============================================================================

DO $$
DECLARE
  v_tienda UUID := 'a355e864-2fcd-43ba-947c-5338efb9f311';
  v_cuantos INT;
BEGIN
  SELECT count(*) INTO v_cuantos
    FROM public.pedidos
   WHERE tienda_id = v_tienda AND numero = 'DEMO-1001';

  IF v_cuantos = 0 THEN
    RAISE NOTICE 'No hay ningún pedido DEMO-1001 en esa tienda. No se borra nada.';
    RETURN;
  END IF;

  IF v_cuantos > 1 THEN
    RAISE EXCEPTION
      'Hay % pedidos con número DEMO-1001 en esa tienda. Se esperaba uno: revisa a mano antes de borrar.',
      v_cuantos;
  END IF;

  DELETE FROM public.pedidos
   WHERE tienda_id = v_tienda AND numero = 'DEMO-1001';

  RAISE NOTICE 'Pedido de ejemplo DEMO-1001 eliminado, con sus líneas y su seguimiento.';
END $$;
