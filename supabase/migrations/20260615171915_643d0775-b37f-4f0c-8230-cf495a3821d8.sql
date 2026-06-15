
CREATE TABLE public.pedido_devoluciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  tienda_id uuid NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  woo_refund_id bigint,
  importe numeric(12,2) NOT NULL DEFAULT 0,
  motivo text,
  fecha timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tienda_id, woo_refund_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedido_devoluciones TO authenticated;
GRANT ALL ON public.pedido_devoluciones TO service_role;

ALTER TABLE public.pedido_devoluciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "miembros_tienda_devoluciones"
  ON public.pedido_devoluciones
  FOR ALL
  TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

CREATE INDEX idx_pedido_devoluciones_pedido ON public.pedido_devoluciones(pedido_id);
CREATE INDEX idx_pedido_devoluciones_tienda ON public.pedido_devoluciones(tienda_id);

CREATE TRIGGER trg_pedido_devoluciones_touch
  BEFORE UPDATE ON public.pedido_devoluciones
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies for 'facturas' bucket (privado).
-- Path convention: {tienda_id}/{factura_id}.pdf
CREATE POLICY "facturas_select_miembros"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.is_tienda_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "facturas_insert_miembros"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'facturas'
    AND public.is_tienda_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "facturas_update_miembros"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.is_tienda_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'facturas'
    AND public.is_tienda_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "facturas_delete_miembros"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'facturas'
    AND public.is_tienda_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
