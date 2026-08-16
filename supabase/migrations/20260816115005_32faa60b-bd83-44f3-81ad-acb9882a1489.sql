DO $$
DECLARE v_tienda uuid := 'a355e864-2fcd-43ba-947c-5338efb9f311';
        v_pedido uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tiendas WHERE id = v_tienda) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.pedidos WHERE tienda_id = v_tienda AND numero = 'DEMO-1001') THEN RETURN; END IF;

  INSERT INTO public.pedidos (tienda_id, numero, estado, metros_total, subtotal, iva, envio, total, fecha_pedido, cliente_nombre, cliente_email, origen, metodo_pago, notas)
  VALUES (v_tienda, 'DEMO-1001', 'en_produccion', 3.5, 52.50, 11.03, 4.90, 68.43, now(), 'Cliente Demo', 'demo@dtfculture.es', 'manual', 'Tarjeta', 'Pedido de ejemplo para previsualizar el formato.')
  RETURNING id INTO v_pedido;

  INSERT INTO public.pedido_items (pedido_id, descripcion, cantidad, unidad, precio_unitario, subtotal, iva, total)
  VALUES
    (v_pedido, 'DTF Textil por metros', 3.5, 'm', 15.00, 52.50, 11.03, 63.53);

  INSERT INTO public.enlaces_seguimiento (pedido_id, transportista, codigo_seguimiento, url)
  VALUES (v_pedido, 'CTT Express', '0034050034059700104370', 'https://www.cttexpress.com/localizador-de-envios/?sc=0034050034059700104370');
END $$;