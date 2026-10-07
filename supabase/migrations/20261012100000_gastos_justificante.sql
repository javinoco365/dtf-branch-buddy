-- ============================================================================
-- GASTOS CON O SIN JUSTIFICANTE (GRUPOS A Y B)
-- ============================================================================
--
-- QUÉ RESUELVE
--   Gerencia separa los números en dos grupos: A, lo que tiene documento y
--   cuenta para Hacienda, y B, lo que no lo tiene y solo cuenta para los
--   números internos. Las ventas ya se separan solas (por si el pedido tiene
--   factura o ticket). Los gastos no: hasta ahora todos iban a A.
--
--   Un gasto sin factura (una ayuda pagada en mano, una compra sin ticket) es
--   un coste real del negocio, pero no se puede deducir: no rebaja Sociedades,
--   no tiene IVA que recuperar y no lleva retenciones que ingresar.
--
-- QUÉ CAMBIA
--   gerencia_gastos_fijos.con_justificante:
--     - verdadero (por defecto): tiene factura o justificante. Va a A: resta
--       en la cuenta de resultados de A, su IVA entra en el 303 y su IRPF en
--       el 111 o el 115.
--     - falso: no lo tiene. Va a B: resta solo en B y en el total, y no entra
--       en ningún impuesto.
--   Los gastos ya apuntados quedan con justificante: se leen igual que antes.
--
-- REVERSIBLE
--   Sí: quitar la columna. Todos los gastos vuelven a contar en A.
--   Se puede aplicar dos veces sin cambiar nada.
-- ============================================================================

ALTER TABLE public.gerencia_gastos_fijos
  ADD COLUMN IF NOT EXISTS con_justificante BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.gerencia_gastos_fijos.con_justificante IS
  'Con factura o justificante (grupo A: cuenta para impuestos). Falso: grupo B, solo números internos.';
