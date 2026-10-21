-- ============================================================================
-- CONSULTAS DE CUADRE · DTI S.L. (RONOCA DESARROLLOS S.L.)
-- ============================================================================
--
-- QUÉ ES
--   Un paquete de consultas de SOLO LECTURA para comprobar en producción que
--   los números del CRM cuadran entre sí: numeración, IVA por trimestre,
--   retenciones, pedidos frente a documentos, cobros, banco, compras,
--   proformas y almacén. Acompaña a 01-contable-fiscal.md (mismo directorio):
--   cada bloque dice qué hallazgo comprueba.
--
-- CÓMO SE USA
--   1. Abre el editor SQL de Supabase (o psql) contra la base de producción.
--   2. Pega el fichero entero o bloque a bloque. Todo va dentro de una
--      transacción READ ONLY que termina en ROLLBACK: aunque alguien añadiera
--      por error una escritura, Postgres la rechazaría y no se guardaría nada.
--      (El editor de Supabase enseña solo el resultado de la ÚLTIMA consulta
--      de lo que pegas: para ver cada una, selecciónala y ejecútala sola,
--      después de ejecutar la línea BEGIN.)
--   3. Cambia las fechas del CTE «p» (al principio de cada consulta) si
--      quieres otro periodo. Por defecto, el año 2026 entero.
--
-- QUÉ NO HACE
--   No escribe, no borra, no llama a ninguna función que escriba. Solo usa
--   SELECT y dos funciones de lectura que ya existen en la base
--   (facturas_huecos_en_serie() y stock_descuadres(), ambas STABLE).
--
-- CÓMO LEER EL RESULTADO
--   Cada consulta lleva «ESPERADO:». Si sale otra cosa, el número del CRM que
--   depende de ella no es fiable hasta que se explique. Las consultas de
--   «cifras» (B1, B3, C1, E1, J1) no tienen un valor esperado fijo: se
--   comparan con lo que enseña la pantalla que se indica.
--
-- Probado sobre el esquema de supabase/migrations (banco de
-- supabase/pruebas/probar-migraciones.sh, PostgreSQL 16). No se ha podido
-- ejecutar contra los datos reales: puede haber columnas de producción que
-- difieran si alguna migración no está aplicada allí. Si una consulta falla
-- con «column ... does not exist», esa migración falta en producción, y eso
-- ya es un hallazgo.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ============================================================================
-- A. NUMERACIÓN DE FACTURAS Y TICKETS
-- ============================================================================

-- A1. Huecos en la numeración (la misma función que usa Gerencia › Fiscal).
--     ESPERADO: 0 filas. Una fila = un número asignado por el contador que no
--     tiene documento: la serie tiene un hueco.
SELECT * FROM public.facturas_huecos_en_serie()
ORDER BY serie, ejercicio, numero_ausente;

-- A2. Números repetidos en una serie y ejercicio, mirando las dos tablas que
--     comparten contador (tiendas y textil).
--     ESPERADO: 0 filas.
WITH docs AS (
  SELECT empresa_id, serie, ejercicio, numero, 'tienda' AS origen, id
    FROM public.facturas WHERE estado <> 'borrador' AND numero IS NOT NULL
  UNION ALL
  SELECT empresa_id, serie, ejercicio, numero_serie, 'textil', id
    FROM public.textil_facturas
   WHERE COALESCE(estado, '') <> 'borrador' AND numero_serie IS NOT NULL
)
SELECT empresa_id, serie, ejercicio, numero, count(*) AS veces,
       string_agg(origen || ':' || id::text, ', ') AS documentos
  FROM docs
 GROUP BY 1, 2, 3, 4
HAVING count(*) > 1;

-- A3. El contador de cada serie frente al número más alto emitido.
--     ESPERADO: diferencia = 0 en todas las filas. Si el contador va por
--     delante, hay un hueco al final (A1 también lo verá); si va por detrás,
--     la próxima emisión chocará.
WITH docs AS (
  SELECT empresa_id, serie, ejercicio, numero FROM public.facturas
   WHERE estado <> 'borrador' AND numero IS NOT NULL
  UNION ALL
  SELECT empresa_id, serie, ejercicio, numero_serie FROM public.textil_facturas
   WHERE COALESCE(estado, '') <> 'borrador' AND numero_serie IS NOT NULL
)
SELECT s.serie, s.ejercicio, s.numero_inicial, s.ultimo_numero,
       max(d.numero) AS mayor_emitido, count(d.numero) AS emitidos,
       s.ultimo_numero - COALESCE(max(d.numero), s.numero_inicial - 1) AS diferencia
  FROM public.series_facturacion s
  LEFT JOIN docs d ON d.empresa_id = s.empresa_id AND d.serie = s.serie
                  AND d.ejercicio = s.ejercicio
 GROUP BY s.id, s.serie, s.ejercicio, s.numero_inicial, s.ultimo_numero
 ORDER BY s.ejercicio, s.serie;

-- A4. Coherencia de cada documento consigo mismo: el ejercicio es el año de
--     su fecha, la serie es la de su tipo y base + IVA = total.
--     ESPERADO: 0 filas.
WITH docs AS (
  SELECT 'tienda' AS origen, f.id, f.empresa_id, f.tipo::text AS tipo, f.serie,
         f.ejercicio, f.numero, f.fecha, f.base_imponible AS base, f.iva_total AS iva, f.total
    FROM public.facturas f WHERE f.estado <> 'borrador'
  UNION ALL
  SELECT 'textil', t.id, t.empresa_id, COALESCE(t.tipo::text, 'ordinaria'), t.serie,
         t.ejercicio, t.numero_serie, t.fecha, t.subtotal, t.iva, t.total
    FROM public.textil_facturas t WHERE COALESCE(t.estado, '') <> 'borrador'
)
SELECT d.*,
       CASE
         WHEN d.ejercicio IS DISTINCT FROM EXTRACT(YEAR FROM d.fecha)::int THEN 'ejercicio distinto del año de la fecha'
         WHEN abs(d.base + d.iva - d.total) > 0.01 THEN 'base + IVA no da el total'
         WHEN d.tipo = 'simplificada' AND d.serie IS DISTINCT FROM e.serie_simplificada THEN 'ticket fuera de la serie de tickets'
         WHEN d.tipo = 'rectificativa' AND d.serie IS DISTINCT FROM e.serie_rectificativa THEN 'rectificativa fuera de su serie'
         WHEN d.tipo = 'ordinaria' AND d.serie IS DISTINCT FROM e.serie_factura THEN 'factura fuera de la serie de facturas'
       END AS problema
  FROM docs d JOIN public.empresas e ON e.id = d.empresa_id
 WHERE d.ejercicio IS DISTINCT FROM EXTRACT(YEAR FROM d.fecha)::int
    OR abs(d.base + d.iva - d.total) > 0.01
    OR (d.tipo = 'simplificada' AND d.serie IS DISTINCT FROM e.serie_simplificada)
    OR (d.tipo = 'rectificativa' AND d.serie IS DISTINCT FROM e.serie_rectificativa)
    OR (d.tipo = 'ordinaria' AND d.serie IS DISTINCT FROM e.serie_factura);
-- Nota: si alguna vez se cambió la serie en Configuración, A4 enseñará los
-- documentos de la serie vieja. Eso no es un error de importes, pero hay que
-- saberlo para la gestoría.

-- A5. Las líneas congeladas de cada factura de tienda suman lo mismo que su
--     cabecera, y el desglose de IVA también.
--     ESPERADO: 0 filas.
WITH lin AS (
  SELECT factura_id, sum(subtotal) AS base, sum(iva) AS iva, sum(total) AS total
    FROM public.factura_items GROUP BY factura_id
), des AS (
  SELECT f.id AS factura_id,
         sum((x ->> 'base')::numeric) AS base, sum((x ->> 'cuota')::numeric) AS iva
    FROM public.facturas f
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(f.desglose_iva, '[]'::jsonb)) x
   GROUP BY f.id
)
SELECT f.id, f.serie, f.ejercicio, f.numero, f.fecha, f.base_imponible, f.iva_total, f.total,
       l.base AS base_lineas, l.iva AS iva_lineas, d.base AS base_desglose, d.iva AS iva_desglose
  FROM public.facturas f
  LEFT JOIN lin l ON l.factura_id = f.id
  LEFT JOIN des d ON d.factura_id = f.id
 WHERE f.estado <> 'borrador'
   AND (abs(COALESCE(d.base, f.base_imponible) - f.base_imponible) > 0.01
     OR abs(COALESCE(d.iva, f.iva_total) - f.iva_total) > 0.01
     -- El IVA de la cabecera es por tipo (base del tipo × tipo); el de las
     -- líneas, línea a línea: pueden diferir en algún céntimo y se tolera.
     OR abs(COALESCE(l.base, f.base_imponible) - f.base_imponible) > 0.01
     OR abs(COALESCE(l.iva, f.iva_total) - f.iva_total) > 0.03);

-- A6. Número y fecha en orden. Desde la decisión del 8-10-2026 un documento
--     lleva la fecha de su pedido, así que un número posterior puede llevar
--     una fecha anterior. Esta consulta cuenta cuántos hay.
--     ESPERADO: hoy, alguna fila es posible y conocida. A partir del
--     1-1-2027 (Verifactu), si el CRM expide, debe ser 0.
WITH docs AS (
  SELECT empresa_id, serie, ejercicio, numero, fecha FROM public.facturas
   WHERE estado <> 'borrador' AND numero IS NOT NULL
  UNION ALL
  SELECT empresa_id, serie, ejercicio, numero_serie, fecha FROM public.textil_facturas
   WHERE COALESCE(estado, '') <> 'borrador' AND numero_serie IS NOT NULL
), ordenados AS (
  SELECT *, max(fecha) OVER (PARTITION BY empresa_id, serie, ejercicio ORDER BY numero
                             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS fecha_max_anterior
    FROM docs
)
SELECT serie, ejercicio, count(*) AS documentos_con_fecha_anterior_a_un_numero_previo,
       min(numero) AS primer_numero, max(fecha_max_anterior - fecha) AS max_dias_hacia_atras
  FROM ordenados
 WHERE fecha < fecha_max_anterior
 GROUP BY serie, ejercicio
 ORDER BY ejercicio, serie;

-- A7. Documentos expedidos tarde: entre la fecha que llevan (la del pedido) y
--     el día en que de verdad se emitieron (emitida_en, hora de Madrid).
--     El art. 11 del RD 1619/2012 pide expedir en el momento de la operación
--     (o antes del día 16 del mes siguiente si el cliente es empresario).
--     ESPERADO: 0 documentos con más de 30 días; y ninguno con la fecha en
--     un trimestre cuyo 303 ya había vencido cuando se emitió (columna
--     «tras_el_303»: esos cambian un trimestre ya presentado por la gestoría).
WITH docs AS (
  SELECT 'tienda' AS origen, tipo::text AS tipo, serie, ejercicio, numero, fecha, emitida_en,
         base_imponible AS base, iva_total AS iva
    FROM public.facturas WHERE estado <> 'borrador'
  UNION ALL
  SELECT 'textil', COALESCE(tipo::text, 'ordinaria'), serie, ejercicio, numero_serie, fecha,
         emitida_en, subtotal, iva
    FROM public.textil_facturas WHERE COALESCE(estado, '') <> 'borrador'
), x AS (
  SELECT d.*, (d.emitida_en AT TIME ZONE 'Europe/Madrid')::date AS dia_emision,
         -- Plazo del 303 del trimestre de la fecha: día 20 del mes siguiente
         -- (30 de enero para el 4.º).
         CASE WHEN EXTRACT(QUARTER FROM d.fecha) = 4
              THEN make_date(EXTRACT(YEAR FROM d.fecha)::int + 1, 1, 30)
              ELSE (date_trunc('quarter', d.fecha) + interval '3 months' + interval '19 days')::date
         END AS plazo_303
    FROM docs d WHERE d.emitida_en IS NOT NULL
)
SELECT origen, tipo,
       count(*) FILTER (WHERE dia_emision - fecha > 30)   AS mas_de_30_dias,
       count(*) FILTER (WHERE dia_emision > plazo_303)     AS tras_el_303,
       sum(iva) FILTER (WHERE dia_emision > plazo_303)     AS iva_tras_el_303,
       max(dia_emision - fecha)                            AS max_dias_de_retraso
  FROM x
 GROUP BY origen, tipo;

-- A8. Tickets por encima del límite. 400 € IVA incluido en general; 3.000 €
--     solo si el receptor congelado es «particular» (RD 1619/2012, art. 4).
--     ESPERADO: 0 filas (la base ya lo impide desde 20261004100100; esto
--     comprueba lo emitido antes o por otra vía).
SELECT f.id, f.serie, f.ejercicio, f.numero, f.fecha, f.total,
       f.receptor_snapshot ->> 'tipo_fiscal' AS tipo_fiscal_congelado
  FROM public.facturas f
  JOIN public.empresas e ON e.id = f.empresa_id
 WHERE f.tipo = 'simplificada' AND f.estado <> 'borrador'
   AND f.total > CASE WHEN f.receptor_snapshot ->> 'tipo_fiscal' = 'particular'
                      THEN e.limite_simplificada_particular ELSE e.limite_simplificada END;

-- A9. Facturas completas (no tickets) sin NIF del destinatario. El NIF del
--     receptor es contenido obligatorio de la factura completa (art. 6.1.d
--     RD 1619/2012).
--     ESPERADO: 0 filas.
SELECT 'tienda' AS origen, id, serie, ejercicio, numero, fecha, total, cliente_nombre
  FROM public.facturas
 WHERE tipo = 'ordinaria' AND estado <> 'borrador' AND COALESCE(trim(cliente_nif), '') = ''
UNION ALL
SELECT 'textil', id, serie, ejercicio, numero_serie, fecha, total, cliente_nombre
  FROM public.textil_facturas
 WHERE COALESCE(tipo::text, 'ordinaria') = 'ordinaria' AND COALESCE(estado, '') <> 'borrador'
   AND COALESCE(trim(cliente_nif), '') = '';

-- A10. Rectificativas raras: más de una sobre el mismo documento, de signo
--      positivo, o que rectifican más de lo que tenía el original.
--      ESPERADO: 0 filas.
WITH docs AS (
  SELECT id, tipo::text AS tipo, estado::text AS estado, serie, ejercicio, numero, fecha,
         total, rectifica_a_id FROM public.facturas
  UNION ALL
  SELECT id, COALESCE(tipo::text, 'ordinaria'), estado, serie, ejercicio, numero_serie, fecha,
         total, rectifica_a_id FROM public.textil_facturas
), rect AS (
  SELECT r.rectifica_a_id, count(*) AS rectificativas, sum(r.total) AS total_rectificado,
         bool_or(r.total > 0) AS alguna_positiva
    FROM docs r
   WHERE r.tipo = 'rectificativa' AND r.estado <> 'borrador' AND r.rectifica_a_id IS NOT NULL
   GROUP BY r.rectifica_a_id
)
SELECT o.serie, o.ejercicio, o.numero, o.fecha, o.total AS total_original,
       r.rectificativas, r.total_rectificado, r.alguna_positiva
  FROM rect r JOIN docs o ON o.id = r.rectifica_a_id
 WHERE r.rectificativas > 1 OR r.alguna_positiva OR o.total + r.total_rectificado < -0.01;

-- A11. Canjes de ticket por factura que no suman lo mismo que su ticket, o
--      cuyo ticket además tiene rectificativa.
--      ESPERADO: 0 filas.
SELECT f.serie || f.ejercicio || '/' || f.numero AS factura_canje, f.total AS total_factura,
       t.serie || t.ejercicio || '/' || t.numero AS ticket, t.total AS total_ticket,
       EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = t.id) AS ticket_rectificado
  FROM public.facturas f JOIN public.facturas t ON t.id = f.sustituye_a_id
 WHERE f.estado <> 'borrador'
   AND (abs(f.total - t.total) > 0.005
        OR EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = t.id));

-- ============================================================================
-- B. IVA REPERCUTIDO Y SOPORTADO POR TRIMESTRE (303)
-- ============================================================================

-- B1. IVA repercutido por trimestre, desde los documentos, con la misma regla
--     que Gerencia (fiscal.ts / canjes.ts): cada documento emitido suma en su
--     fecha; la factura de canje resta lo de su ticket en su fecha; la primera
--     rectificativa de una factura de canje lo vuelve a sumar.
--     ESPERADO: igual, trimestre a trimestre, que «IVA repercutido» de
--     Gerencia › Resultados (tabla de impuestos) y que Gerencia › Fiscal con
--     el trimestre elegido y «Todas las tiendas». Si no coincide, uno de los
--     dos está mal.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
docs AS (
  SELECT id, empresa_id, tipo::text AS tipo, estado::text AS estado, fecha,
         base_imponible AS base, iva_total AS iva, total, rectifica_a_id, sustituye_a_id
    FROM public.facturas
  UNION ALL
  SELECT id, empresa_id, COALESCE(tipo::text, 'ordinaria'), estado, fecha,
         subtotal, iva, total, rectifica_a_id, sustituye_a_id
    FROM public.textil_facturas
), emitidos AS (SELECT * FROM docs WHERE COALESCE(estado, '') <> 'borrador'),
primera_rect AS (
  SELECT DISTINCT ON (rectifica_a_id) rectifica_a_id, id, fecha
    FROM emitidos WHERE rectifica_a_id IS NOT NULL
   ORDER BY rectifica_a_id, fecha, id
), apuntes AS (
  SELECT fecha, tipo, base, iva, total, 'documento' AS motivo FROM emitidos
  UNION ALL
  SELECT f.fecha, 'canje', -t.base, -t.iva, -t.total, 'canje'
    FROM emitidos f JOIN emitidos t ON t.id = f.sustituye_a_id
  UNION ALL
  SELECT r.fecha, 'canje_anulado', t.base, t.iva, t.total, 'canje_anulado'
    FROM primera_rect r
    JOIN emitidos f ON f.id = r.rectifica_a_id
    JOIN emitidos t ON t.id = f.sustituye_a_id
)
SELECT date_trunc('quarter', a.fecha)::date AS trimestre,
       count(*) FILTER (WHERE motivo = 'documento')                      AS documentos,
       round(sum(base) FILTER (WHERE tipo = 'ordinaria'), 2)             AS base_facturas,
       round(sum(base) FILTER (WHERE tipo = 'simplificada'), 2)          AS base_tickets,
       round(sum(base) FILTER (WHERE tipo = 'rectificativa'), 2)         AS base_rectificativas,
       round(sum(base) FILTER (WHERE motivo <> 'documento'), 2)          AS base_canjes,
       round(sum(base), 2)                                               AS base_total,
       round(sum(iva), 2)                                                AS iva_repercutido
  FROM apuntes a, p
 WHERE a.fecha BETWEEN p.desde AND p.hasta
 GROUP BY 1 ORDER BY 1;

-- B2. IVA repercutido por tipo de IVA (desglose congelado), por trimestre.
--     ESPERADO: casi todo al 21 %. Un tipo 0 o distinto de 21 en una venta de
--     DTF o textil a España hay que explicarlo (exportación, intracomunitaria
--     con NIF-IVA, Canarias...). Sin canjes: es el desglose bruto de lo emitido.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
docs AS (
  SELECT fecha, estado::text AS estado, desglose_iva, base_imponible AS base, iva_total AS iva
    FROM public.facturas
  UNION ALL
  SELECT fecha, estado, desglose_iva, subtotal, iva FROM public.textil_facturas
)
SELECT date_trunc('quarter', d.fecha)::date AS trimestre,
       COALESCE((x ->> 'tipo')::numeric, -1) AS tipo_iva,   -- -1: documento sin desglose
       round(sum(COALESCE((x ->> 'base')::numeric, d.base)), 2) AS base,
       round(sum(COALESCE((x ->> 'cuota')::numeric, d.iva)), 2) AS cuota
  FROM docs d
  LEFT JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.desglose_iva) = 'array' THEN d.desglose_iva ELSE '[]'::jsonb END) x ON true,
       p
 WHERE COALESCE(d.estado, '') <> 'borrador' AND d.fecha BETWEEN p.desde AND p.hasta
 GROUP BY 1, 2 ORDER BY 1, 2 DESC;

-- B3. IVA soportado de las facturas de compra registradas, por trimestre y
--     categoría, con los mismos importes que usa Gerencia (importesDeCompra:
--     la cuota calculada por la base, o la impresa si se eligió el importe de
--     la factura; sin borradas ni proformas).
--     ESPERADO: la fila «TOTAL» de cada trimestre = «IVA soportado» de
--     Gerencia › Fiscal para ese trimestre y «Todas las tiendas».
--     OJO: Gerencia › Resultados suma ADEMÁS el IVA estimado de los gastos
--     fijos (B4). Por eso Fiscal y Resultados no dan el mismo 303.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
c AS (
  SELECT date_trunc('quarter', fecha)::date AS trimestre, COALESCE(categoria, 'textil') AS categoria,
         base,
         CASE WHEN cuota_iva IS NULL OR liquido_origen = 'factura' THEN iva ELSE cuota_iva END AS iva,
         CASE WHEN cuota_iva IS NULL OR liquido_origen = 'factura' THEN COALESCE(irpf, 0)
              ELSE COALESCE(cuota_irpf, 0) END AS irpf,
         gasto_id
    FROM public.textil_compras, p
   WHERE estado = 'registrada' AND borrada_en IS NULL
     AND COALESCE(tipo_documento, 'factura') = 'factura'
     AND fecha BETWEEN p.desde AND p.hasta
)
SELECT trimestre, COALESCE(categoria, 'TOTAL') AS categoria, count(*) AS facturas,
       round(sum(base), 2) AS base, round(sum(iva), 2) AS iva_soportado,
       round(sum(irpf), 2) AS irpf_retenido,
       count(*) FILTER (WHERE gasto_id IS NOT NULL) AS enlazadas_a_gasto_fijo
  FROM c
 GROUP BY GROUPING SETS ((trimestre, categoria), (trimestre))
 ORDER BY trimestre, categoria NULLS LAST;

-- B4. IVA y retenciones ESTIMADOS de los gastos fijos (Gerencia › Ajustes),
--     cargo a cargo, como hace impuestos.ts: el cargo con su factura de
--     compra enlazada lleva los importes de la factura; sin factura, el
--     importe configurado × su % de IVA y de IRPF. Sin justificante, nada.
--     ESPERADO: «iva_sin_factura» = 0. Todo IVA de esa columna está entrando
--     en el 303 de Resultados sin que exista una factura registrada que lo
--     respalde (art. 97 LIVA: sin factura no se deduce).
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
g AS (
  SELECT g.*, CASE g.periodicidad WHEN 'trimestral' THEN 3 WHEN 'anual' THEN 12 ELSE 1 END AS paso
    FROM public.gerencia_gastos_fijos g
), cargos AS (
  SELECT g.id AS gasto_id, g.concepto, g.tipo, g.con_justificante, g.importe_mensual, g.iva_pct,
         g.irpf_pct, k, (g.desde + make_interval(months => k * g.paso))::date AS fecha_cargo
    FROM g, p, generate_series(0, 600) AS k
   WHERE (g.periodicidad <> 'puntual' OR k = 0)
     AND (g.desde + make_interval(months => k * g.paso))::date <= LEAST(COALESCE(g.hasta, p.hasta), p.hasta)
), facturas_de_cargo AS (
  -- cargoDeFactura(): meses naturales desde el mes de «desde», entre el paso.
  SELECT c.gasto_id,
         CASE WHEN g.periodicidad = 'puntual' THEN 0
              ELSE floor(((EXTRACT(YEAR FROM c.fecha) - EXTRACT(YEAR FROM g.desde)) * 12
                          + EXTRACT(MONTH FROM c.fecha) - EXTRACT(MONTH FROM g.desde)) / g.paso)::int
         END AS k,
         sum(c.base) AS base,
         sum(CASE WHEN c.cuota_iva IS NULL OR c.liquido_origen = 'factura' THEN c.iva ELSE c.cuota_iva END) AS iva,
         sum(CASE WHEN c.cuota_iva IS NULL OR c.liquido_origen = 'factura' THEN COALESCE(c.irpf, 0)
                  ELSE COALESCE(c.cuota_irpf, 0) END) AS irpf
    FROM public.textil_compras c JOIN g ON g.id = c.gasto_id
   WHERE c.estado = 'registrada' AND c.borrada_en IS NULL
     AND COALESCE(c.tipo_documento, 'factura') = 'factura'
     AND (g.periodicidad = 'puntual' OR c.fecha >= date_trunc('month', g.desde))
   GROUP BY 1, 2
), x AS (
  SELECT c.*, f.gasto_id IS NOT NULL AS con_factura,
         CASE WHEN f.gasto_id IS NOT NULL THEN f.iva
              WHEN c.con_justificante IS FALSE THEN 0
              ELSE round(c.importe_mensual * c.iva_pct / 100, 2) END AS iva,
         CASE WHEN f.gasto_id IS NOT NULL THEN f.irpf
              WHEN c.con_justificante IS FALSE THEN 0
              ELSE round(c.importe_mensual * c.irpf_pct / 100, 2) END AS irpf
    FROM cargos c LEFT JOIN facturas_de_cargo f ON f.gasto_id = c.gasto_id AND f.k = c.k, p
   WHERE c.fecha_cargo >= p.desde
)
SELECT date_trunc('quarter', fecha_cargo)::date AS trimestre,
       count(*) AS cargos,
       count(*) FILTER (WHERE NOT con_factura AND con_justificante IS NOT FALSE) AS cargos_estimados,
       round(sum(iva), 2) AS iva_soportado_gastos,
       round(sum(iva) FILTER (WHERE NOT con_factura), 2) AS iva_sin_factura,
       round(sum(irpf) FILTER (WHERE tipo = 'alquiler'), 2) AS irpf_115,
       round(sum(irpf) FILTER (WHERE tipo IS DISTINCT FROM 'alquiler'), 2) AS irpf_111
  FROM x GROUP BY 1 ORDER BY 1;

-- B5. Compras registradas que NO están enlazadas a su gasto fijo pero lo
--     parecen (misma base que el cargo y fecha dentro de su vigencia). Cada
--     una cuenta dos veces en Resultados: su IVA como compra y el IVA
--     estimado del cargo; y su retención va al 111 aunque sea del alquiler.
--     ESPERADO: 0 filas.
SELECT c.id, c.fecha, c.proveedor, c.numero, c.base, c.categoria,
       g.concepto AS gasto_parecido, g.tipo AS tipo_gasto, g.importe_mensual
  FROM public.textil_compras c
  JOIN public.gerencia_gastos_fijos g
    ON g.empresa_id = c.empresa_id
   AND abs(g.importe_mensual - c.base) <= 0.01
   AND c.fecha BETWEEN date_trunc('month', g.desde)::date AND COALESCE(g.hasta, DATE '2999-12-31')
 WHERE c.estado = 'registrada' AND c.borrada_en IS NULL AND c.gasto_id IS NULL
   AND COALESCE(c.categoria, 'textil') <> 'textil'
 ORDER BY c.fecha;

-- B6. IVA devengado SIN documento: pedidos no cancelados del trimestre que no
--     tienen factura ni ticket vigente (el grupo «B» de Gerencia). El IVA se
--     devenga con la entrega o el cobro anticipado (art. 75 LIVA), haya
--     documento o no; el 303 que calcula el CRM solo mira documentos.
--     ESPERADO: 0 pedidos al cerrar cada trimestre.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
vigentes AS (
  SELECT DISTINCT f.pedido_id FROM public.facturas f
   WHERE f.pedido_id IS NOT NULL AND f.tipo IN ('ordinaria', 'simplificada')
     AND f.estado NOT IN ('borrador', 'anulada')
     AND NOT EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = f.id)
), dev AS (SELECT pedido_id, sum(importe) AS devuelto FROM public.pedido_devoluciones GROUP BY 1),
ped AS (
  SELECT pe.*, CASE WHEN pe.origen = 'woocommerce' THEN (pe.fecha_pedido AT TIME ZONE 'UTC')::date
                    ELSE (pe.fecha_pedido AT TIME ZONE 'Europe/Madrid')::date END AS dia
    FROM public.pedidos pe
)
SELECT date_trunc('quarter', ped.dia)::date AS trimestre, ped.origen,
       count(*) AS pedidos_sin_documento,
       round(sum(ped.total - COALESCE(dev.devuelto, 0)), 2) AS vendido_con_iva,
       round(sum(ped.iva * CASE WHEN ped.total > 0
                                THEN GREATEST(0, (ped.total - COALESCE(dev.devuelto, 0)) / ped.total)
                                ELSE 1 END), 2) AS iva_sin_documentar
  FROM ped LEFT JOIN dev ON dev.pedido_id = ped.id, p
 WHERE ped.dia BETWEEN p.desde AND p.hasta
   AND ped.estado <> 'cancelado'
   AND ped.id NOT IN (SELECT pedido_id FROM vigentes)
 GROUP BY 1, 2 ORDER BY 1, 2;
-- Y lo mismo en el textil:
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta)
SELECT date_trunc('quarter', tp.fecha)::date AS trimestre, count(*) AS pedidos_textil_sin_documento,
       round(sum(tp.total), 2) AS vendido_con_iva, round(sum(tp.iva), 2) AS iva_sin_documentar
  FROM public.textil_pedidos tp, p
 WHERE tp.fecha BETWEEN p.desde AND p.hasta
   AND COALESCE(tp.estado, '') <> 'cancelado'
   AND NOT EXISTS (
     SELECT 1 FROM public.textil_facturas f
      WHERE f.textil_pedido_id = tp.id AND COALESCE(f.tipo::text, 'ordinaria') <> 'rectificativa'
        AND COALESCE(f.estado, '') NOT IN ('borrador', 'anulada')
        AND NOT EXISTS (SELECT 1 FROM public.textil_facturas r WHERE r.rectifica_a_id = f.id))
 GROUP BY 1 ORDER BY 1;

-- ============================================================================
-- C. RETENCIONES (111 y 115)
-- ============================================================================

-- C1. Retenciones de las facturas de compra por trimestre. Gerencia manda
--     TODAS al 111 (impuestos.ts:628), sea cual sea la categoría.
--     ESPERADO: ninguna fila con «parece_alquiler» = true (esa retención es
--     del 115, no del 111). El total del 111 de Resultados = esta suma + la
--     columna irpf_111 de B4.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta)
SELECT date_trunc('quarter', fecha)::date AS trimestre, COALESCE(categoria, 'textil') AS categoria,
       (concat_ws(' ', proveedor, concepto) ~* '(alquil|arrend|local)') AS parece_alquiler,
       count(*) AS facturas,
       round(sum(CASE WHEN cuota_iva IS NULL OR liquido_origen = 'factura' THEN COALESCE(irpf, 0)
                      ELSE COALESCE(cuota_irpf, 0) END), 2) AS irpf
  FROM public.textil_compras, p
 WHERE estado = 'registrada' AND borrada_en IS NULL
   AND COALESCE(tipo_documento, 'factura') = 'factura'
   AND fecha BETWEEN p.desde AND p.hasta
   AND COALESCE(CASE WHEN cuota_iva IS NULL OR liquido_origen = 'factura' THEN irpf ELSE cuota_irpf END, 0) <> 0
 GROUP BY 1, 2, 3 ORDER BY 1, 2;

-- ============================================================================
-- D. PEDIDOS FRENTE A SUS DOCUMENTOS
-- ============================================================================

-- D1. Pedidos cuyo documento vigente no suma lo mismo que el pedido. Causas
--     conocidas: cupones de WooCommerce (las líneas se guardan ANTES del
--     descuento: woocommerce.functions.ts:698), recargos («fee_lines») que
--     no se importan, pedidos sin IVA a los que el ticket pone 21 %, y
--     redondeos de un céntimo.
--     ESPERADO: 0 filas con |diferencia| > 0,01.
WITH vig AS (
  SELECT DISTINCT ON (f.pedido_id) f.pedido_id, f.id, f.serie, f.ejercicio, f.numero, f.tipo,
         f.base_imponible, f.iva_total, f.total
    FROM public.facturas f
   WHERE f.pedido_id IS NOT NULL AND f.tipo IN ('ordinaria', 'simplificada')
     AND f.estado NOT IN ('borrador', 'anulada')
     AND NOT EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = f.id)
   ORDER BY f.pedido_id, f.fecha DESC
)
SELECT pe.numero AS pedido, pe.origen, pe.fecha_pedido, pe.subtotal AS base_pedido,
       pe.iva AS iva_pedido, pe.total AS total_pedido,
       v.serie || v.ejercicio || '/' || v.numero AS documento, v.tipo,
       v.base_imponible AS base_doc, v.iva_total AS iva_doc, v.total AS total_doc,
       round(v.total - pe.total, 2) AS diferencia
  FROM vig v JOIN public.pedidos pe ON pe.id = v.pedido_id
 WHERE abs(v.total - pe.total) > 0.01
 ORDER BY abs(v.total - pe.total) DESC;

-- D2. Pedidos de WooCommerce cuyas líneas no suman la base del pedido. Es la
--     causa de D1 antes de emitir: el ticket que se emita saldrá mal.
--     ESPERADO: 0 filas con |diferencia| > 0,02.
SELECT pe.numero, pe.fecha_pedido, pe.subtotal AS base_pedido, pe.envio,
       round(COALESCE(sum(i.subtotal), 0) + COALESCE(pe.envio, 0), 2) AS lineas_mas_envio,
       round(COALESCE(sum(i.subtotal), 0) + COALESCE(pe.envio, 0) - pe.subtotal, 2) AS diferencia
  FROM public.pedidos pe LEFT JOIN public.pedido_items i ON i.pedido_id = pe.id
 WHERE pe.origen = 'woocommerce' AND pe.estado <> 'cancelado'
 GROUP BY pe.id
HAVING abs(COALESCE(sum(i.subtotal), 0) + COALESCE(pe.envio, 0) - pe.subtotal) > 0.02
 ORDER BY abs(COALESCE(sum(i.subtotal), 0) + COALESCE(pe.envio, 0) - pe.subtotal) DESC;

-- D3. Pedidos cuyo IVA no es el 21 % de su base. El ticket desde el pedido
--     pone siempre 21 % (woocommerce.functions.ts:711 y
--     factura-desde-pedido.ts): si WooCommerce no cobró IVA (Canarias,
--     intracomunitaria con NIF-IVA, exportación), el documento repercute un
--     IVA que el cliente no pagó.
--     ESPERADO: 0 filas, o solo las que se sepa explicar. Explica, por
--     ejemplo, el «IVA 20,3 % sobre bruta» de la captura de Facturación del
--     8-10-2026.
SELECT pe.numero, pe.origen, pe.fecha_pedido, pe.subtotal, pe.iva, pe.total,
       round(100 * pe.iva / NULLIF(pe.subtotal, 0), 2) AS pct_iva,
       pe.direccion_facturacion ->> 'pais' AS pais_facturacion,
       pe.direccion_facturacion ->> 'provincia' AS provincia
  FROM public.pedidos pe
 WHERE pe.estado <> 'cancelado' AND pe.subtotal > 0
   AND abs(pe.iva - round(pe.subtotal * 0.21, 2)) > 0.02
 ORDER BY pe.fecha_pedido DESC;

-- D4. Pedidos cancelados que conservan un documento vigente. Gerencia y
--     Facturación los quitan de las ventas; Fiscal sigue contando su IVA.
--     ESPERADO: 0 filas (cada uno necesita su rectificativa).
SELECT pe.numero, pe.fecha_pedido, pe.cancelado_en, f.serie || f.ejercicio || '/' || f.numero AS documento,
       f.tipo::text AS tipo, f.total
  FROM public.pedidos pe JOIN public.facturas f ON f.pedido_id = pe.id
 WHERE pe.estado = 'cancelado'
   AND f.tipo IN ('ordinaria', 'simplificada') AND f.estado NOT IN ('borrador', 'anulada')
   AND NOT EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = f.id)
UNION ALL
SELECT tp.numero, tp.fecha::timestamptz, NULL, f.numero, f.tipo::text, f.total
  FROM public.textil_pedidos tp JOIN public.textil_facturas f ON f.textil_pedido_id = tp.id
 WHERE tp.estado = 'cancelado'
   AND COALESCE(f.tipo::text, 'ordinaria') <> 'rectificativa'
   AND COALESCE(f.estado, '') NOT IN ('borrador', 'anulada')
   AND NOT EXISTS (SELECT 1 FROM public.textil_facturas r WHERE r.rectifica_a_id = f.id);

-- D5. Pedidos con devoluciones (reembolsos de WooCommerce) cuyo documento no
--     tiene rectificativa. Ventas y Cobrado restan la devolución; el IVA del
--     documento no (art. 80.Dos LIVA: hace falta rectificativa).
--     ESPERADO: 0 filas.
SELECT pe.numero, pe.total, sum(d.importe) AS devuelto,
       f.serie || f.ejercicio || '/' || f.numero AS documento, f.total AS total_documento,
       round(sum(d.importe) * f.iva_total / NULLIF(f.total, 0), 2) AS iva_de_mas_en_el_303
  FROM public.pedido_devoluciones d
  JOIN public.pedidos pe ON pe.id = d.pedido_id
  JOIN public.facturas f ON f.pedido_id = pe.id
 WHERE f.tipo IN ('ordinaria', 'simplificada') AND f.estado NOT IN ('borrador', 'anulada')
   AND NOT EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = f.id)
 GROUP BY pe.id, pe.numero, pe.total, f.id, f.serie, f.ejercicio, f.numero, f.total, f.iva_total;

-- ============================================================================
-- E. COBROS
-- ============================================================================

-- E1. Vendido (por día del pedido) frente a Cobrado (por día del cobro), por
--     mes y tienda. Explica que «Cobrado» pueda superar a «Vendido» en un mes
--     (captura del 8-10: 860,00 frente a 853,00): se cobran pedidos de meses
--     anteriores, hay propinas o hay cobros web fechados al día siguiente.
--     ESPERADO: «vendido» = tarjeta «Vendido» de Facturación de la tienda
--     para ese mes; «cobrado» = tarjeta «Cobrado».
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
dev AS (SELECT pedido_id, sum(importe) AS devuelto FROM public.pedido_devoluciones GROUP BY 1),
ped AS (
  SELECT pe.tienda_id, pe.total - COALESCE(dev.devuelto, 0) AS neto,
         CASE WHEN pe.origen = 'woocommerce' THEN (pe.fecha_pedido AT TIME ZONE 'UTC')::date
              ELSE (pe.fecha_pedido AT TIME ZONE 'Europe/Madrid')::date END AS dia
    FROM public.pedidos pe LEFT JOIN dev ON dev.pedido_id = pe.id
   WHERE pe.estado <> 'cancelado'
), v AS (
  SELECT tienda_id, date_trunc('month', dia)::date AS mes, round(sum(GREATEST(neto, 0)), 2) AS vendido
    FROM ped, p WHERE dia BETWEEN p.desde AND p.hasta GROUP BY 1, 2
), c AS (
  SELECT pe.tienda_id, date_trunc('month', co.fecha)::date AS mes,
         round(sum(co.importe), 2) AS cobrado, round(sum(co.propina), 2) AS propinas
    FROM public.cobros co JOIN public.pedidos pe ON pe.id = co.pedido_id, p
   WHERE co.fecha BETWEEN p.desde AND p.hasta GROUP BY 1, 2
)
SELECT t.nombre AS tienda, COALESCE(v.mes, c.mes) AS mes, v.vendido, c.cobrado, c.propinas,
       round(COALESCE(c.cobrado, 0) - COALESCE(v.vendido, 0), 2) AS cobrado_menos_vendido
  FROM v FULL JOIN c ON c.tienda_id = v.tienda_id AND c.mes = v.mes
  JOIN public.tiendas t ON t.id = COALESCE(v.tienda_id, c.tienda_id)
 ORDER BY 1, 2;

-- E2. Pedidos cobrados de más (cobros por encima del total menos lo devuelto)
--     o con estado de pago que no casa con sus cobros.
--     ESPERADO: 0 filas.
WITH dev AS (SELECT pedido_id, sum(importe) AS devuelto FROM public.pedido_devoluciones GROUP BY 1),
cob AS (SELECT pedido_id, sum(importe) AS cobrado FROM public.cobros WHERE pedido_id IS NOT NULL GROUP BY 1)
SELECT pe.numero, pe.origen, pe.estado::text, pe.estado_pago::text, pe.total,
       COALESCE(dev.devuelto, 0) AS devuelto, COALESCE(cob.cobrado, 0) AS cobrado,
       CASE WHEN COALESCE(cob.cobrado, 0) > pe.total - COALESCE(dev.devuelto, 0) + 0.005 THEN 'cobrado de más'
            WHEN pe.estado_pago = 'pagado' AND COALESCE(cob.cobrado, 0) < pe.total - COALESCE(dev.devuelto, 0) - 0.005 THEN 'pagado sin cobros que lo cubran'
            WHEN pe.estado_pago = 'pendiente' AND COALESCE(cob.cobrado, 0) > 0.005 THEN 'pendiente con cobros'
       END AS problema
  FROM public.pedidos pe LEFT JOIN dev ON dev.pedido_id = pe.id LEFT JOIN cob ON cob.pedido_id = pe.id
 WHERE pe.estado <> 'cancelado'
   AND (COALESCE(cob.cobrado, 0) > pe.total - COALESCE(dev.devuelto, 0) + 0.005
     OR (pe.estado_pago = 'pagado' AND COALESCE(cob.cobrado, 0) < pe.total - COALESCE(dev.devuelto, 0) - 0.005)
     OR (pe.estado_pago = 'pendiente' AND COALESCE(cob.cobrado, 0) > 0.005));

-- E3. Tickets que nacen «pagada» (tickets.sql:399) de pedidos que no están
--     cobrados enteros. La lista de facturas los da por cobrados.
--     ESPERADO: 0 filas.
WITH cob AS (SELECT pedido_id, sum(importe) AS cobrado FROM public.cobros WHERE pedido_id IS NOT NULL GROUP BY 1)
SELECT f.serie || f.ejercicio || '/' || f.numero AS ticket, f.fecha, f.total,
       pe.numero AS pedido, COALESCE(cob.cobrado, 0) AS cobrado,
       round(f.total - COALESCE(cob.cobrado, 0), 2) AS pendiente
  FROM public.facturas f
  JOIN public.pedidos pe ON pe.id = f.pedido_id
  LEFT JOIN cob ON cob.pedido_id = pe.id
 WHERE f.tipo = 'simplificada' AND f.estado = 'pagada'
   AND NOT EXISTS (SELECT 1 FROM public.facturas r WHERE r.rectifica_a_id = f.id)
   AND NOT EXISTS (SELECT 1 FROM public.facturas s WHERE s.sustituye_a_id = f.id)
   AND COALESCE(cob.cobrado, 0) < f.total - 0.005;

-- E4. Cobros web fechados en otro día que su pedido (la base pasa a Madrid una
--     hora que la web ya guardó en hora de Madrid: cifras_fiables.sql:72).
--     Los de fin de mes cambian de mes el «Cobrado».
--     ESPERADO: pocas filas, todas de pedidos de las 22:00-23:59; ninguna
--     que cambie de mes o de trimestre sin que se sepa.
SELECT pe.numero, pe.fecha_pedido, (pe.fecha_pedido AT TIME ZONE 'UTC')::date AS dia_pedido,
       co.fecha AS dia_cobro,
       date_trunc('month', co.fecha) <> date_trunc('month', (pe.fecha_pedido AT TIME ZONE 'UTC')::date) AS cambia_de_mes
  FROM public.cobros co JOIN public.pedidos pe ON pe.id = co.pedido_id
 WHERE co.metodo = 'web' AND co.fecha <> (pe.fecha_pedido AT TIME ZONE 'UTC')::date
 ORDER BY pe.fecha_pedido DESC;

-- E5. Ingresos de Caja que no vienen de ningún cobro de pedido (ventas en
--     efectivo apuntadas solo en Caja). No están en Ventas, ni en Cobrado, ni
--     tienen documento: no están en el IVA.
--     ESPERADO: 0 filas, o solo aportaciones o traspasos que se sepa explicar.
SELECT m.fecha, m.concepto_nombre, m.cliente_nombre, m.socio_nombre, m.importe, m.observaciones
  FROM public.caja_movimientos m
 WHERE m.categoria = 'ingreso'
   AND NOT EXISTS (SELECT 1 FROM public.cobros c WHERE c.caja_movimiento_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM public.textil_cobros t WHERE t.caja_movimiento_id = m.id)
 ORDER BY m.fecha DESC;

-- ============================================================================
-- F. BANCO Y CONCILIACIÓN
-- ============================================================================

-- F1. La cadena de saldos de cada cuenta: saldo anterior + importe = saldo.
--     ESPERADO: 0 filas. Una fila es un extracto que falta o un movimiento
--     repetido u omitido.
WITH m AS (
  SELECT id, cuenta_id, fecha, importe, saldo,
         lag(saldo) OVER (PARTITION BY cuenta_id ORDER BY fecha, created_at, id) AS saldo_anterior
    FROM public.banco_movimientos WHERE saldo IS NOT NULL
)
SELECT cuenta_id, fecha, importe, saldo_anterior, saldo,
       round(saldo_anterior + importe - saldo, 2) AS descuadre
  FROM m
 WHERE saldo_anterior IS NOT NULL AND abs(saldo_anterior + importe - saldo) > 0.005
 ORDER BY cuenta_id, fecha;
-- Nota: si el banco ordena dentro del día de otra forma que created_at,
-- puede salir un falso descuadre que se anula en la fila siguiente.

-- F2. Lo que queda sin conciliar, por mes y signo.
--     ESPERADO: al cerrar cada mes, poco y explicable (comisiones, nóminas,
--     impuestos, liquidaciones de la pasarela de pago).
SELECT date_trunc('month', m.fecha)::date AS mes,
       CASE WHEN m.importe >= 0 THEN 'abono' ELSE 'cargo' END AS signo,
       count(*) AS movimientos, round(sum(m.importe), 2) AS importe
  FROM public.banco_movimientos m
 WHERE m.traspaso_con IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones c WHERE c.movimiento_id = m.id)
 GROUP BY 1, 2 ORDER BY 1, 2;

-- F3. Movimientos repartidos de más: la suma de lo conciliado contra
--     documentos supera el movimiento.
--     ESPERADO: 0 filas.
SELECT m.id, m.fecha, m.concepto, m.importe, round(sum(c.importe), 2) AS conciliado
  FROM public.banco_movimientos m JOIN public.banco_conciliaciones c ON c.movimiento_id = m.id
 WHERE c.importe IS NOT NULL
 GROUP BY m.id
HAVING abs(sum(c.importe)) > abs(m.importe) + 0.01;

-- F4. Facturas de compra marcadas pagadas que no se pagaron en efectivo y no
--     están conciliadas con ningún movimiento.
--     ESPERADO: 0 filas al cerrar cada mes.
SELECT c.fecha, c.proveedor, c.numero, c.liquido, c.forma_pago, c.fecha_pago
  FROM public.textil_compras c
 WHERE c.estado = 'registrada' AND c.borrada_en IS NULL AND c.estado_pago = 'pagada'
   AND COALESCE(c.forma_pago, '') <> 'efectivo'
   AND NOT EXISTS (SELECT 1 FROM public.banco_conciliaciones b WHERE b.compra_id = c.id)
 ORDER BY c.fecha;

-- ============================================================================
-- G. COMPRAS Y PROFORMAS
-- ============================================================================

-- G1. Lo que está subido y no registrado (cola de la IA y borradores): no
--     cuenta en el IVA ni en Gerencia.
--     ESPERADO: 0 al cerrar cada trimestre.
SELECT date_trunc('quarter', COALESCE(fecha, created_at::date))::date AS trimestre,
       revision, count(*) AS documentos, round(sum(COALESCE(total, 0)), 2) AS total_leido
  FROM public.textil_compras
 WHERE estado = 'borrador' AND borrada_en IS NULL
 GROUP BY 1, 2 ORDER BY 1, 2;

-- G2. Facturas de compra duplicadas (mismo proveedor y número, no borradas).
--     ESPERADO: 0 filas. Un duplicado deduce el IVA dos veces.
SELECT COALESCE(proveedor_id::text, proveedor_clave, nif_proveedor, proveedor) AS proveedor,
       numero_clave, count(*) AS veces, string_agg(id::text, ', ') AS ids, sum(iva) AS iva
  FROM public.textil_compras
 WHERE estado = 'registrada' AND borrada_en IS NULL
   AND COALESCE(tipo_documento, 'factura') = 'factura' AND COALESCE(numero_clave, '') <> ''
 GROUP BY 1, 2 HAVING count(*) > 1;

-- G3. Facturas registradas sin el PDF del proveedor. Sin justificante no hay
--     deducción (art. 97 LIVA) y la gestoría no la puede contabilizar.
--     ESPERADO: 0 filas.
SELECT fecha, proveedor, numero, base, iva, categoria
  FROM public.textil_compras
 WHERE estado = 'registrada' AND borrada_en IS NULL
   AND COALESCE(tipo_documento, 'factura') = 'factura' AND fichero_ruta IS NULL
 ORDER BY fecha;

-- G4. Facturas registradas con el importe impreso distinto del calculado.
--     ESPERADO: pocas, todas con nota_descuadre que lo explique.
SELECT fecha, proveedor, numero, base, cuota_iva, iva, cuota_irpf, irpf, liquido_calculado, liquido,
       liquido_origen, nota_descuadre
  FROM public.textil_compras
 WHERE estado = 'registrada' AND borrada_en IS NULL AND liquido_origen = 'factura'
 ORDER BY fecha;

-- G5. Proformas registradas que siguen sin su factura. Su género ya está en
--     el stock, pero su IVA no se puede deducir hasta que llegue la factura.
--     ESPERADO: solo proformas recientes. Más de 30 días: reclamar la factura.
SELECT p.fecha, p.proveedor, p.numero, p.base, p.iva, p.total, p.estado_pago,
       CURRENT_DATE - p.fecha AS dias
  FROM public.textil_compras p
 WHERE p.tipo_documento = 'proforma' AND p.estado = 'registrada' AND p.borrada_en IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.textil_compras f
                    WHERE f.proforma_id = p.id AND f.borrada_en IS NULL)
 ORDER BY p.fecha;

-- G6. Lo que las facturas casadas con su proforma no pudieron llevar al stock
--     (la diferencia de precio de las prendas que ya se habían vendido). No
--     está en el coste de la ropa ni en ningún otro sitio de Resultados.
--     ESPERADO: 0, o un importe que hay que sumar a mano al coste de ventas.
SELECT date_trunc('quarter', fecha)::date AS trimestre, count(*) AS facturas,
       round(sum((casado_resumen -> 'stock' ->> 'diferencia_sin_aplicar')::numeric), 2) AS diferencia_sin_aplicar
  FROM public.textil_compras
 WHERE proforma_id IS NOT NULL AND borrada_en IS NULL
   AND casado_resumen -> 'stock' ->> 'diferencia_sin_aplicar' IS NOT NULL
 GROUP BY 1 ORDER BY 1;

-- ============================================================================
-- H. ALMACÉN TEXTIL
-- ============================================================================

-- H1. Unidades: la caché frente al libro de movimientos.
--     ESPERADO: 0 filas.
SELECT * FROM public.stock_descuadres();

-- H2. Valor: la caché (cantidad × coste medio) frente al libro (suma de los
--     movimientos valorados, con los ajustes de coste). stock_descuadres()
--     solo mira unidades.
--     ESPERADO: diferencia total de céntimos (redondeo del coste medio a 4
--     decimales). Más de 1 € por variante hay que mirarlo.
WITH libro AS (
  SELECT stock_id,
         round(sum(CASE WHEN motivo = 'ajuste_coste' THEN COALESCE(importe_ajuste, 0)
                        ELSE round(cantidad * coste_unitario, 2) END), 2) AS valor_libro
    FROM public.textil_stock_movimientos GROUP BY 1
)
SELECT s.id, s.nombre, s.talla, s.color, s.cantidad, s.coste_unitario,
       round(s.cantidad * s.coste_unitario, 2) AS valor_cache, l.valor_libro,
       round(s.cantidad * s.coste_unitario - COALESCE(l.valor_libro, 0), 2) AS diferencia
  FROM public.textil_stock s LEFT JOIN libro l ON l.stock_id = s.id
 WHERE abs(s.cantidad * s.coste_unitario - COALESCE(l.valor_libro, 0)) > 1
 ORDER BY abs(s.cantidad * s.coste_unitario - COALESCE(l.valor_libro, 0)) DESC;
-- Y el total, para la gestoría (existencias finales del balance):
SELECT round(sum(s.cantidad * s.coste_unitario), 2) AS valor_almacen_cache,
       (SELECT round(sum(CASE WHEN motivo = 'ajuste_coste' THEN COALESCE(importe_ajuste, 0)
                              ELSE round(cantidad * coste_unitario, 2) END), 2)
          FROM public.textil_stock_movimientos) AS valor_almacen_libro,
       (SELECT round(sum(CASE WHEN motivo = 'ajuste_coste' THEN COALESCE(importe_ajuste, 0)
                              ELSE round(cantidad * coste_unitario, 2) END), 2)
          FROM public.textil_stock_movimientos
         WHERE COALESCE(fecha, created_at::date) <= DATE '2026-12-31') AS valor_libro_a_31_12
  FROM public.textil_stock s;

-- H3. Existencias negativas o salidas a coste 0.
--     ESPERADO: 0 filas.
SELECT 'stock negativo' AS problema, s.id::text, s.nombre, s.cantidad, s.coste_unitario
  FROM public.textil_stock s WHERE s.cantidad < 0
UNION ALL
SELECT 'venta a coste 0', m.stock_id::text, m.nota, m.cantidad, m.coste_unitario
  FROM public.textil_stock_movimientos m WHERE m.motivo = 'venta' AND m.coste_unitario = 0;

-- H4. Pedidos textil no cancelados sin ninguna salida de almacén: su margen
--     va sin coste de la ropa (Gerencia lo avisa como «textil sin coste»).
--     ESPERADO: solo pedidos que de verdad no llevan prenda del almacén.
SELECT tp.numero, tp.fecha, tp.estado, tp.subtotal
  FROM public.textil_pedidos tp
 WHERE COALESCE(tp.estado, '') <> 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM public.textil_stock_movimientos m
                    WHERE m.textil_pedido_id = tp.id AND m.motivo = 'venta')
 ORDER BY tp.fecha DESC;

-- ============================================================================
-- I. GASTOS, AMORTIZACIONES Y SOCIOS
-- ============================================================================

-- I1. Gastos fijos marcados «con justificante» que no tienen ninguna factura
--     de compra enlazada. Su IVA y su retención entran en Resultados por
--     estimación (B4).
--     ESPERADO: 0 filas con IVA o IRPF.
SELECT g.concepto, g.tipo, g.periodicidad, g.importe_mensual, g.iva_pct, g.irpf_pct, g.desde, g.hasta
  FROM public.gerencia_gastos_fijos g
 WHERE g.con_justificante IS NOT FALSE AND (g.iva_pct > 0 OR g.irpf_pct > 0)
   AND NOT EXISTS (SELECT 1 FROM public.textil_compras c
                    WHERE c.gasto_id = g.id AND c.estado = 'registrada' AND c.borrada_en IS NULL);

-- I2. Gastos sin justificante (grupo B): coste del negocio que no deduce.
--     ESPERADO: lo mínimo. Cada euro aquí es un gasto que Hacienda no admite.
SELECT concepto, tipo, periodicidad, importe_mensual, desde, hasta
  FROM public.gerencia_gastos_fijos WHERE con_justificante IS FALSE;

-- I3. Inmovilizado (maquinaria e informática) y su amortización lineal anual
--     según Gerencia (12 % y 25 %, compras.ts:56). Para cotejar con el libro
--     de bienes de inversión de la gestoría.
--     ESPERADO: la misma lista que la gestoría tiene como inmovilizado.
SELECT fecha, proveedor, numero, categoria, base,
       CASE categoria WHEN 'maquinaria' THEN 12 ELSE 25 END AS pct_anual,
       round(base * CASE categoria WHEN 'maquinaria' THEN 0.12 ELSE 0.25 END, 2) AS cuota_anual
  FROM public.textil_compras
 WHERE categoria IN ('maquinaria', 'informatica') AND estado = 'registrada' AND borrada_en IS NULL
   AND COALESCE(tipo_documento, 'factura') = 'factura'
 ORDER BY fecha;

-- I4. Retiradas de los socios (Inversión) por año. «Retirada» mezcla
--     devolución de aportaciones y reparto de beneficios (inversion.ts:10).
--     Un reparto es dividendo: acuerdo de junta, retención del 19 % y
--     modelo 123. Una devolución de préstamo de socio, no.
--     ESPERADO: cada retirada clasificada con la gestoría.
SELECT EXTRACT(YEAR FROM fecha)::int AS anio, socio_nombre, tipo::text, count(*) AS apuntes,
       round(sum(importe), 2) AS importe
  FROM public.inversion_movimientos
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- ============================================================================
-- J. LA MISMA CIFRA EN TODAS LAS PANTALLAS
-- ============================================================================

-- J1. Por mes, las tres «facturaciones» que enseña el CRM, en una fila:
--       - pedidos: lo que usan Dashboard, Facturación de tienda y Gerencia
--         (no cancelados, neto de devoluciones). «bruta» va sin envío.
--       - documentos: lo que usa Fiscal y el «Facturado» del informe de
--         socios (base de tickets y facturas, con envío).
--       - cobros: lo que usa la Facturación Consolidada.
--     ESPERADO: base_pedidos ≈ base_documentos cuando todo está documentado
--     y no hay devoluciones; la diferencia es el grupo B (B6) más D1.
WITH p AS (SELECT DATE '2026-01-01' AS desde, DATE '2026-12-31' AS hasta),
dev AS (SELECT pedido_id, sum(importe) AS devuelto FROM public.pedido_devoluciones GROUP BY 1),
ped AS (
  SELECT CASE WHEN pe.origen = 'woocommerce' THEN (pe.fecha_pedido AT TIME ZONE 'UTC')::date
              ELSE (pe.fecha_pedido AT TIME ZONE 'Europe/Madrid')::date END AS dia,
         CASE WHEN pe.total > 0 THEN GREATEST(0, LEAST(1, (pe.total - COALESCE(dev.devuelto, 0)) / pe.total)) ELSE 1 END AS parte,
         pe.subtotal, pe.envio, pe.iva, pe.total
    FROM public.pedidos pe LEFT JOIN dev ON dev.pedido_id = pe.id
   WHERE pe.estado <> 'cancelado'
  UNION ALL
  SELECT tp.fecha, 1, tp.subtotal, tp.envio, tp.iva, tp.total
    FROM public.textil_pedidos tp WHERE COALESCE(tp.estado, '') <> 'cancelado'
), vp AS (
  SELECT date_trunc('month', dia)::date AS mes,
         round(sum(total * parte), 2) AS vendido_con_iva,
         round(sum(subtotal * parte), 2) AS base_pedidos,
         round(sum((subtotal - COALESCE(envio, 0)) * parte), 2) AS bruta_sin_envio,
         round(sum(iva * parte), 2) AS iva_pedidos
    FROM ped, p WHERE dia BETWEEN p.desde AND p.hasta GROUP BY 1
), vd AS (
  SELECT date_trunc('month', fecha)::date AS mes, round(sum(base), 2) AS base_documentos,
         round(sum(iva), 2) AS iva_documentos
    FROM (SELECT fecha, base_imponible AS base, iva_total AS iva, estado::text AS estado FROM public.facturas
          UNION ALL SELECT fecha, subtotal, iva, estado FROM public.textil_facturas) d, p
   WHERE COALESCE(estado, '') <> 'borrador' AND fecha BETWEEN p.desde AND p.hasta GROUP BY 1
), vc AS (
  SELECT date_trunc('month', fecha)::date AS mes, round(sum(importe), 2) AS cobrado
    FROM public.cobros, p WHERE fecha BETWEEN p.desde AND p.hasta GROUP BY 1
)
SELECT COALESCE(vp.mes, vd.mes, vc.mes) AS mes, vp.vendido_con_iva, vp.base_pedidos, vp.bruta_sin_envio,
       vp.iva_pedidos, vd.base_documentos, vd.iva_documentos,
       round(COALESCE(vp.base_pedidos, 0) - COALESCE(vd.base_documentos, 0), 2) AS base_sin_documentar_aprox,
       vc.cobrado
  FROM vp FULL JOIN vd ON vd.mes = vp.mes FULL JOIN vc ON vc.mes = COALESCE(vp.mes, vd.mes)
 ORDER BY 1;
-- Nota: base_documentos ya resta rectificativas y no neutraliza canjes (B1 sí).

-- J2. Ajustes de Gerencia que mueven los impuestos estimados.
--     ESPERADO: tipo_is acorde con la situación real de la sociedad (ver
--     hallazgo del informe: el 15 % de nueva creación solo vale dos
--     ejercicios) y cuota_is_anterior = la del último modelo 200 presentado.
SELECT empresa_id, tipo_is, cuota_is_anterior, web_sin_pagar_cuenta, precio_metro, coste_envio_defecto
  FROM public.gerencia_ajustes;

ROLLBACK;
