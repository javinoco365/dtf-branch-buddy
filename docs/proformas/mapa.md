### sql-compras
# Informe técnico: esquema SQL de compras y stock, y cómo añadir proformas

He leído el esquema sin cambiar nada. La base no tiene hoy ningún concepto de proforma ni de enlace entre documentos. Para la factura que se casa con su proforma, lo más seguro es pasar el `proforma_id` en el mismo `textil_compra_guardar_y_registrar()` y que esa llamada se salte el paso de stock. Una función aparte que case después no sirve en textil, porque registrar la factura ya habría metido el stock.

## 1. Cómo se registra hoy una compra textil y cómo entra el stock

**Tabla `public.textil_compras`**
- Se crea en `20260903260000_compras_textil.sql:61-84`. Columna `estado`, CHECK `compra_estado` con `'borrador'|'registrada'` (l.80).
- Columnas añadidas después:
  - `categoria`, CHECK `compra_categoria` y `compra_textil_sin_gasto`: `20261013100000_compras_generales.sql:39-65`.
  - `estado_pago` (`'pendiente'|'pagada'`, CHECK `compra_estado_pago`) y `fecha_pago`, con CHECK `compra_pago_con_fecha` `(estado_pago='pagada') = (fecha_pago IS NOT NULL)`: `20261014100000_compras_recibidas.sql:68,116,123-124`.
  - `borrada_en`: l.72 del mismo fichero.
  - Columnas generadas `cuota_iva`, `cuota_irpf`, `liquido`, `ejercicio` y `trimestre`: l.78-94 del mismo fichero.
  - Índice `textil_compras_por_trimestre (ejercicio, trimestre) WHERE borrada_en IS NULL`: l.142.
  - `revision`, `proveedor_clave`, `numero_clave` y CHECK `compra_registrada_revisada`: `20261015100000_compras_cola.sql:36-67`.
  - `proveedor_id`: `20261028100000_escaner_textil_esquema.sql:256-261`.

**Tabla `public.textil_compra_lineas`**
- Base en `20260903260000:93-107`. CHECK `compra_linea_cantidad (cantidad > 0)`.
- En `20261028100000:266-310` se añaden `tipo` (`articulo|porte|descuento|otro`), `unidades_por_pack`, `unidades_stock`, `coste_total_entrada`, `coste_unitario_entrada` y `casado_metodo`, más `UNIQUE compra_linea_id_compra (id, compra_id)`.

**Tabla `public.textil_stock_movimientos`**
- Base en `20260903200000_stock_movimientos.sql:49-68`. CHECK `stock_movimiento_no_cero (cantidad <> 0)` y CHECK `stock_movimiento_signo` (l.63-67).
- En `20261028100000:325-348` se añaden `compra_id` (FK `ON DELETE RESTRICT`), `compra_linea_id` y `fecha DATE`, con:
  - FK compuesta `stock_mov_linea_de_su_compra (compra_linea_id, compra_id) → textil_compra_lineas(id, compra_id)`.
  - CHECK `stock_linea_con_compra`.
  - Índice `textil_stock_mov_por_compra`.
- En `20261028100200_escaner_textil_reglas.sql:427-445` se añaden:
  - `stock_compra_con_factura`: `motivo <> 'compra' OR compra_linea_id IS NOT NULL`, `NOT VALID`.
  - `stock_linea_solo_compra`: `compra_linea_id IS NULL OR motivo = 'compra'`.
  - `stock_compra_id_motivo`: `compra_id IS NULL OR motivo IN ('compra','devolucion_proveedor')`.
- Trigger `textil_stock_mov_inmutable` (`20260903200000:80-93`): ningún movimiento admite UPDATE ni DELETE.

**Camino principal: `textil_compra_guardar_y_registrar(_compra JSONB, _usuario_id UUID)`** (`20261028100200:500-1065`)
- Es SECURITY DEFINER y solo puede ejecutarlo `service_role`.
- Fija `app.usuario_id` (l.549) y bloquea la compra con `FOR UPDATE` (l.552).
- Rechaza si `estado='registrada'` (l.568) o si la fecha es futura (l.579).
- Hace INSERT o UPDATE de la cabecera en borrador (l.586-638) y resuelve el proveedor (l.641-717).
- Borra y vuelve a insertar las líneas (l.721-749).
- Solo si `v_textil`:
  - 4.1: al menos un artículo.
  - 4.2: unidades y coste de entrada.
  - 4.3: signo de portes y descuentos.
  - 4.4: Σ importe = base (±0,02).
  - 4.5: Σ `coste_total_entrada` = base, al céntimo (l.813-821).
  - 4.6: casa o crea la variante (l.824-981).
  - **4.8: un INSERT `'compra'` por artículo, con `compra_id` y `compra_linea_id` y `fecha = v_fecha` (l.984-997).**
  - 4.9: aprende la memoria del escáner (l.1001-1028).
- Paso 5 (l.1034-1046): `UPDATE ... SET estado='registrada', revision='revisada'`. Si salta `textil_compras_factura_unica`, el error se traduce a mensaje de duplicado.

**Camino viejo: `textil_compra_registrar(_compra_id UUID)`** (`20261028100200:1070-1141`)
- Lo puede ejecutar `authenticated`.
- Rechaza líneas que no son artículo y líneas sin `stock_id`.
- Inserta `'compra'` con `cantidad × unidades_por_pack` (l.1116-1124).

**`stock_aplicar_movimiento()`** (`20261028100200:330-405`, trigger BEFORE INSERT `textil_stock_mov_aplicar`)
- Bloquea la variante con `FOR UPDATE` y pone la fecha.
- Si una `devolucion_cliente` llega con coste 0, toma el coste al que salió en el pedido.
- Si un `ajuste_inventario` positivo llega con coste 0, entra al coste medio.
- Media ponderada solo en las entradas (`cantidad > 0`).
- **Toda salida (`cantidad < 0`) sale al coste medio vigente, venga con el coste que venga (l.391-393).**
- Escribe la caché `textil_stock` con la bandera `app.stock_via_movimiento`.

**`stock_compra_solo_por_registro()`** (l.407-422)
- Una entrada `'compra'` con `current_user` igual a `authenticated` o `anon` da error. Solo la pueden anotar las funciones SECURITY DEFINER.

## 2. Qué impide modificar una compra registrada

**Líneas**
- `compra_registrada_inmutable()` y su trigger `textil_compra_lineas_inmutables`, BEFORE INSERT/UPDATE/DELETE (`20260903260000:122-145`).

**Cabecera**
- `compra_registrada_cabecera()` (`20261028100200:138-238`), con dos triggers:
  - `textil_compras_registrada_inmutable` (AFTER UPDATE).
  - `textil_compras_registrada_no_se_borra` (BEFORE DELETE).
- No es SECURITY DEFINER a propósito: mira `current_user`. Dentro de una función SECURITY DEFINER, `current_user` es el dueño, así que esas funciones sí pueden pasar la compra a registrada.
- Qué bloquea:
  - Pasar a `'registrada'` desde `authenticated` o `anon` (l.158).
  - Volver a borrador (l.165).
  - Cambiar cualquiera de la lista fija de l.173-175: `empresa_id, proveedor, nif_proveedor, numero, fecha, base, iva, irpf, total, categoria, lectura_ia, cuota_iva, cuota_irpf, liquido`.
  - `proveedor_id`, `fichero_ruta` y `fichero_huella` solo pueden pasar de nulo a un valor (l.184-192).
  - `gasto_id` solo puede pasar de un valor a nulo (l.196-201).
  - `borrada_en`: **prohibido si `categoria='textil'`** (l.207); en las demás categorías, solo de nulo a una fecha.
  - `estado_pago` y `fecha_pago` **no están protegidos**: se pueden cambiar en una registrada (lo comprueba la prueba 10b de C18).

**Políticas RLS** (`20261028100000:423-473`)
- `"compras alta"` exige `estado='borrador'`.
- `"compras baja"` exige `estado='borrador'`.
- `"compras edicion"` solo exige ser miembro de la empresa. **Toda columna nueva que no esté en la lista de l.173 la puede cambiar `authenticated` en una compra registrada.**

**Duplicados** (`20261015100000_compras_cola.sql`)
- `textil_compras_fichero_unico (empresa_id, fichero_huella) WHERE fichero_huella IS NOT NULL AND borrada_en IS NULL` (l.72).
- `textil_compras_factura_unica (empresa_id, proveedor_clave, numero_clave) WHERE estado='registrada' AND borrada_en IS NULL AND proveedor_clave<>'' AND numero_clave<>''` (l.77-80).
- La antigua `compra_unica` se borra en l.82.

## 3. Motivos válidos de movimiento

Enum `public.stock_motivo` (`20260903200000:37-47`):

| Motivo | Signo exigido por `stock_movimiento_signo` |
|---|---|
| `inicial` | > 0 |
| `compra` | > 0 |
| `devolucion_cliente` | > 0 |
| `venta` | < 0 |
| `devolucion_proveedor` | < 0 |
| `merma` | < 0 |
| `ajuste_inventario` | los dos sentidos |

- **No existe `regularizacion` ni ningún motivo de ajuste de coste.**
- `cantidad = 0` está prohibida (`stock_movimiento_no_cero`), así que no se puede revalorizar el stock sin mover unidades.
- `compra_linea_id` solo se admite con `'compra'`.
- `compra_id` solo se admite con `'compra'` o `'devolucion_proveedor'`.
- En el código: `src/dominio/tipos-textil.ts:21-22`. `src/dominio/cuenta-almacen.ts:142-146` trata cualquier motivo que no conozca como ajuste con signo.

## 4. Cambios propuestos (migración nueva, sin aplicar)

**a) Columnas en `textil_compras`**
- `tipo_documento TEXT NOT NULL DEFAULT 'factura'`, con CHECK `compra_tipo_documento IN ('factura','proforma')`. Las filas existentes quedan como `'factura'`.
- `proforma_id UUID REFERENCES public.textil_compras(id) ON DELETE RESTRICT`.
- CHECK `compra_proforma_solo_factura`: `proforma_id IS NULL OR tipo_documento='factura'`.
- CHECK de que no se apunte a sí misma: `proforma_id IS DISTINCT FROM id`.
- Que el destino sea de verdad una proforma no cabe en un CHECK: lo valida la función.
- `CREATE UNIQUE INDEX textil_compras_proforma_casada_unica ON textil_compras(proforma_id) WHERE proforma_id IS NOT NULL AND borrada_en IS NULL`. Esto fija una factura por proforma. Riesgo: si un proveedor factura una proforma en dos facturas, o dos proformas en una, este modelo 1:1 no lo admite; habría que pasar a una tabla puente.
- Índice para el aviso: `textil_compras_proformas_abiertas (empresa_id, fecha) WHERE tipo_documento='proforma' AND borrada_en IS NULL`.

**b) Duplicados**
- Recrear `textil_compras_factura_unica` incluyendo `tipo_documento`: `(empresa_id, tipo_documento, proveedor_clave, numero_clave)`. Si no, una proforma y su factura con el mismo número chocan, y `textil_compra_guardar_y_registrar()` lo traduce como «ya está registrada» (l.1041-1043).
- `textil_compras_fichero_unico` no cambia: son ficheros distintos.

**c) `compra_registrada_cabecera()`**
- Añadir `tipo_documento` a la lista de l.173.
- `proforma_id`: solo de nulo a un valor, y solo dentro de las funciones SECURITY DEFINER. Rechazar si `current_user IN ('authenticated','anon')`, como en l.158. Si no, el UPDATE de `"compras edicion"` permitiría casar o descasar a mano.

**d) `textil_compra_guardar_y_registrar()`**
- Leer `_compra ->> 'tipo_documento'` y `_compra ->> 'proforma_id'`.
- Proforma: mismo camino que una factura textil de hoy (4.1-4.9, mete el stock).
- Factura con `proforma_id`:
  - Antes del paso 3, bloquear las dos filas en orden de id con `FOR UPDATE`.
  - Validar:
    - Misma empresa.
    - `tipo_documento='proforma'`.
    - `estado='registrada'` y `borrada_en IS NULL`.
    - Que no esté ya casada.
    - Misma `categoria`.
    - Mismo `proveedor_id`, o el mismo `nif_clave` si la factura aún no tiene proveedor resuelto.
  - Hacer 3 (líneas) y 4.4 (Σ importe = base).
  - **Saltarse 4.1-4.3 y 4.5-4.9**: sin variantes, sin movimientos, sin memoria. Las líneas quedan con `stock_id` NULL, cosa que no rompe nada.
  - En el UPDATE del paso 5, poner también `proforma_id`.
  - Después, pasar el pago (punto f).
- Todo dentro de la misma transacción, como ahora.

**e) `textil_compra_registrar()` (camino viejo)**
- Añadir un guard: si `proforma_id IS NOT NULL`, RAISE, porque si no metería stock por duplicado.

**f) Pasar el pago de la proforma a la factura (en la misma transacción)**
- Si la proforma está `estado_pago='pagada'`: `UPDATE textil_compras SET estado_pago='pagada', fecha_pago=<la de la proforma>` en la factura.
- `UPDATE banco_conciliaciones SET compra_id=<factura> WHERE compra_id=<proforma>`. Hace falta SECURITY DEFINER, porque a `authenticated` se le revocaron INSERT/UPDATE/DELETE (`20261017100000_conciliacion_motor.sql:110`). Lo registra el trigger `banco_conciliaciones_auditoria`.
- La columna `importe` vale −líquido de la proforma (`20261017100000:103`). Si el `liquido` de la factura es distinto, poner `estado='revisar'` o recalcular `diferencia`.
- `conciliacion_par_compra (movimiento_id, compra_id)` no choca, porque la factura no tenía enlace.
- `banco_desenlazar_como()` (`20261017100000:372-376`) devolverá la factura a pendiente porque `marco_pagada` se conserva. Es coherente.

**g) Conciliación**
- `banco_documentos()` (`20261025100000_conciliacion_pendientes.sql:118-137`) marca como conciliable toda compra con `estado='registrada' AND borrada_en IS NULL`. Hay que excluir la proforma ya casada: `AND NOT EXISTS (SELECT 1 FROM textil_compras f WHERE f.proforma_id=c.id AND f.borrada_en IS NULL)`.
- Hacer lo mismo en la comprobación de `banco_enlazar_como()` (`20261017100000:231-240`).
- La proforma sin casar sí debe poder conciliarse, porque es el pago por adelantado. Hoy ya lo es.

**h) Aviso de proforma sin factura (desde el día 1)**
- Función o vista SECURITY INVOKER `compras_proformas_sin_factura()`: `tipo_documento='proforma' AND estado='registrada' AND borrada_en IS NULL AND NOT EXISTS (factura con proforma_id = id)`, con los días desde `fecha`.

**i) Fiscal y Gerencia**
- En SQL nada filtra por tipo. La proforma tiene `cuota_iva`, `ejercicio` y `trimestre` generados, así que contaría en el 303/111 y en Gerencia si no se filtra.
- Hay que filtrar `tipo_documento='factura'` en `src/lib/gerencia.ts` (l.480-523 y l.804) y en `compras.functions.ts` y `archivo.functions.ts`. Eso es área de la aplicación, fuera de este informe.
- El coste textil de Gerencia sale de los movimientos, que llevan `compra_id` = proforma. Está bien.

**j) Pruebas**
- Nueva prueba en `supabase/pruebas/` (p. ej. `C19_proformas.sql`) y una línea `seccion` en `probar-migraciones.sh:162`.
- Casos que hay que cubrir:
  - La proforma mueve stock.
  - La factura casada no mueve nada: `pg_temp.huella()` de C18 igual.
  - No se puede casar dos veces.
  - Un `UPDATE proforma_id` desde `authenticated` falla.
  - El mismo número en proforma y factura no choca.
  - El pago pasa con su fila de conciliación.
  - `banco_documentos()` deja de ofrecer la proforma casada.
- Reversión en `supabase/reversiones/`.

## 5. Si la factura no coincide con la proforma

- **Más unidades en la factura**: hay que anotar una entrada `'compra'` adicional. `stock_compra_con_factura` exige `compra_linea_id`, que puede ser la línea de la factura (la FK compuesta lo admite). Riesgo: rompe la idea de que la factura casada no mueve stock y obliga a casar esa línea con su variante.
- **Menos unidades**: `devolucion_proveedor` (negativa, `compra_id` admitido) o `ajuste_inventario`. **Sale al coste medio vigente, no al precio de la proforma** (l.391-393), así que el valor no cuadra exactamente.
- **Otro precio**: **no está soportado.** No hay motivo de ajuste de coste y `cantidad=0` está prohibida.
  - Para soportarlo hay que añadir `ALTER TYPE stock_motivo ADD VALUE 'ajuste_coste'`, relajar `stock_movimiento_no_cero` y `stock_movimiento_signo` para ese motivo, y meter una rama en `stock_aplicar_movimiento()` que reparta el importe sobre el saldo.
  - Riesgo: si parte de las unidades ya se vendió, esa diferencia pertenece a ventas pasadas y no se puede reasignar sin tocar libros cerrados.
  - Riesgo técnico: C18 aplica las migraciones dentro de `BEGIN` (l.12-19), y en PostgreSQL 16 un valor de enum añadido no se puede usar en la misma transacción. Un CHECK que lo cite fallaría.
- **Recomendación para la primera versión**: el coste del stock es el de la proforma. La factura casada guarda su importe fiscal y la diferencia en su línea o en `nota_descuadre`. Si las unidades difieren, se bloquea el casado o se exige un ajuste explícito aparte.

## 6. Otros riesgos

- **Proforma textil sin borrado**: el borrado lógico está prohibido en textil (`compra_registrada_cabecera`, l.207). Una proforma cancelada solo se corrige con `devolucion_proveedor` o con un ajuste, y seguiría saliendo en el aviso. Hace falta un estado o una excepción para la proforma cancelada.
- **`ON DELETE RESTRICT`**: la FK `compra_id` de los movimientos y la de `proforma_id` impiden borrar la proforma. Es lo que se quiere.
- **`compra_registrada_revisada`**: obliga a `revision='revisada'` también en la proforma. El paso 5 ya la pone así.
- **Fecha del movimiento**: es la de la proforma. El ejercicio fiscal será el de la factura. No choca, porque el stock no es fiscal.

### escaner
# Informe técnico: proformas en el lector IA, la cola de revisión y el escáner textil (solo lectura; no se ha cambiado nada)

Repositorio en `/home/user/dtf-branch-buddy`, rama `claude/crm-dtf-app-review-ftg3di`. Las rutas de abajo son relativas a esa carpeta.

## 0. Resumen

Hoy todo documento que entra se trata como factura y, si es textil, mete stock al registrarlo. Para las proformas hay que tocar cinco cosas:

1. Una columna nueva `tipo_documento` en `textil_compras`.
2. Un campo `tipo_documento` en el esquema que se pide a la IA.
3. Una función pura que busque proformas candidatas.
4. Un parámetro `proforma_id` en `guardarYRegistrarCompra` y en `textil_compra_guardar_y_registrar`, que se salte el bloque de stock.
5. Que el camino viejo nunca registre una factura casada.

## 1. Flujo actual, de subir el PDF a registrar

**1. Subida** (`src/components/compras/SubidaFacturas.tsx:44` llama a `subirFacturaRecibida`, en `src/lib/compras.functions.ts:570-625`)
- `huellaDe` (`src/lib/cola-compras.server.ts:56-59`) calcula el SHA-256 del fichero.
- Busca filas con la misma `fichero_huella` (`compras.functions.ts:579-593`). Si hay una viva, devuelve `resultado: "duplicado"` (nivel `archivo`).
- Sube el fichero a `compras/ronoca/<año>/<id>.<ext>` (`:598-603`).
- Inserta la fila con `categoria: data.categoria ?? "otros"`, `revision: "pendiente"` y `revision_motivo: "Leyendo con IA…"` (`:605-614`).
- Llama a `procesarFactura`.

**2. Lectura** (`procesarFactura`, `cola-compras.server.ts:82-209`)
- `leerYValidar` (`:37-53`) lee con un reintento. Llama a `leerFactura` (`src/lib/lector-facturas.server.ts:92-161`), que usa:
  - el prompt de sistema `INSTRUCCIONES` (`:25-57`);
  - el mensaje de usuario `"Lee esta factura de compra."` (`:133`);
  - `output_config.format` con `ESQUEMA_LECTURA_JSON` (`:122-129`).
- Valida con `validarLectura` / `esquemaLectura` (`src/dominio/cola-compras.ts:445-464` y `:317-353`).
- `normalizarCompra` (`src/dominio/factura-compra.ts:154-232`) devuelve una `CompraLeida` (`:60-71`), que **no tiene tipo de documento**.
- Comprobaciones: `avisosQueImportan(revisarCompra(...))` (`cola-compras.ts:504-510`; `factura-compra.ts:247-307`), `tipoProbable` y `tipoIrpfProbable`.
- Candidatas a duplicado: `.eq("proveedor_clave", clave)` con `CAMPOS_DUPLICADO` (`cola-compras.server.ts:30-31` y `:109-116`), y después `duplicadosDe` (`cola-compras.ts:244-269`).
- `motivosRevision` (`cola-compras.ts:475-498`).
- Escritura: `UPDATE` de la cabecera (`cola-compras.server.ts:144-163`), y después borra e inserta las líneas (`:166-202`), con respaldo si falta la migración `20261028100000` (`MOTIVO_SIN_COLUMNAS_ESCANER`, `:66-67`).
- Camino alternativo sin cola: `leerFacturaCompra` (`compras.functions.ts:62-83`), que no escribe nada (lo usa `PaginaCompras.tsx:298`).

**3. Revisión**
- `src/components/compras/PaginaCompras.tsx`:
  - `paraDuplicados` (`:171`) son todas las compras ya cargadas por `listCompras` (`compras.functions.ts:427-458`, `select("*, lineas:...")`).
  - `duplicadosDe` (`:975`) y `bloqueaRegistro` (`:988`).
- `src/components/compras/RevisarCompraTextil.tsx`:
  - `leerMemoriaEscaner` (`:253`, servidor en `src/lib/escaner-textil.functions.ts:74-158`; busca el proveedor por id, `nif_clave` y `nombre_clave`, `:88-117`).
  - `casarLineas` (`:270`, `src/dominio/casado-textil.ts:500-600`).
  - Duplicados en `:374-388`.
  - `pendientes` (`:400-410`): «líneas sin variante», «El reparto no cuadra con la base».
  - `registrar` (`:412-423`) llama a `onRegistrar`.
- `PaginaCompras.tsx:355-400` llama a `registrarFn` (`guardarYRegistrarCompra`).

**4. Registro** (`guardarYRegistrarCompra`, `compras.functions.ts:279-420`)
- En textil, `conCostesDeEntrada` (`:362-369`; `src/dominio/reparto-compra.ts:114`) reparte portes y descuentos y comprueba la invariante I1 (la suma de los costes de entrada es la base, al céntimo).
- Llama al RPC `textil_compra_guardar_y_registrar` con `adminComoUsuario` y `_usuario_id` (`:400-405`).
- Si falla la función, cae a `caminoViejo` (`:314-356`): `guardarBorrador` (`:128-156`), después `registrarBorrador` (`:162-195`), después el RPC `textil_compra_registrar`.

**5. SQL** (`supabase/migrations/20261028100200_escaner_textil_reglas.sql`)
- `textil_compra_guardar_y_registrar` empieza en la línea 500.
- `v_textil := v_categoria = 'textil'` (`:584`).
- El bloque 4 (`:751-1029`) va entero dentro de `IF v_textil THEN`:
  - 4.1: E-REG-8 (al menos un artículo).
  - 4.4 y 4.5: base e I1.
  - 4.6: casado. Error «falta la variante del catálogo» (aprox. `:967`).
  - **4.8: `INSERT INTO textil_stock_movimientos ... 'compra'` (`:983-997`).**
  - 4.9: memoria del escáner.
- Paso 5 (`:1031-1046`): `estado='registrada'` y traducción de `textil_compras_factura_unica`.
- El camino viejo `textil_compra_registrar` (`:1070`) también mueve stock si `categoria='textil'` (`:1096-1119`).

## 2. Dónde encaja la clasificación factura/proforma

**Esquema JSON** (`src/dominio/cola-compras.ts:373-442`)
- Añadir `tipo_documento` a `required` (`:376-390`) y a `properties`, como `{ type: "string", enum: ["factura", "proforma", ""] }`.
- Opcionalmente, `referencia_proforma: tOn`: el n.º de proforma o de pedido que cite la factura, que sirve para casar.
- El límite de 16 uniones no se ve afectado. El test `src/dominio/cola-compras.test.ts:200-221` cuenta solo `anyOf` o `type` en lista, y hoy hay **0 uniones**: `tOn` (`:363`) y los `enum` de tipo string no cuentan. El límite de 24 opcionales tampoco, mientras todo vaya en `required`.

**zod** (`esquemaLectura`, `:317-353`)
- `tipo_documento: z.preprocess(v => v === "" ? null : v, z.enum(["factura","proforma"]).nullable())`, con el mismo patrón que `categoria` (`:323-326`).
- Si se añade, `referencia_proforma: textoOpcional`.
- Poner la lista `TIPOS_DOCUMENTO_COMPRA` en `src/dominio/compras.ts`, junto a `CATEGORIAS_COMPRA` (`:42`).

**Prompt** (`lector-facturas.server.ts`)
- En `INSTRUCCIONES`, añadir una viñeta junto a `:31` («numero»): `tipo_documento: "proforma"` si el papel dice «Proforma», «Factura proforma», «Pro-forma» u «Order confirmation»; `"factura"` si es factura ordinaria o simplificada; `""` si no está claro, y decirlo en `dudas`.
- Añadir también: «`numero`: el número del documento (de la proforma si es proforma)».
- Cambiar `:133` a «Lee este documento de compra (factura o proforma).».

**Dominio**
- `normalizarCompra` y `CompraLeida` (`factura-compra.ts:60-71` y `:219-231`): pasar `tipo_documento` y `referencia_proforma`.
- `motivosRevision` (`cola-compras.ts:475-498`): parámetro nuevo `tipoDocumento`.
  - Si es `null`: «La IA no sabe si es factura o proforma: elígelo.»
  - Si es `"proforma"`: siempre un motivo visible («Proforma: mete stock y no cuenta en IVA»). Clasificar mal es lo más caro (ver riesgos).
- `procesarFactura` (`cola-compras.server.ts:144-163`): escribir `tipo_documento`, con el mismo respaldo `faltaLaColumna` que se usa en `:190-200`.
- Si la subida viene de Textil (`OpcionesProcesar`, `:69-75`), la categoría se fuerza a textil, pero el tipo de documento lo sigue decidiendo la IA.

**Base** (lo que necesitaría la migración; aquí no se escribe)
- `textil_compras.tipo_documento TEXT NOT NULL DEFAULT 'factura'`, con `CHECK IN ('factura','proforma')`. El histórico queda como factura.
- Añadir `tipo_documento` al array de columnas inmutables de `compra_registrada_cabecera()` (`20261028100200:173-175`).

**Interfaz**
- Un selector de factura o proforma en la revisión (`PaginaCompras.tsx` y `RevisarCompraTextil.tsx`), que se envía en `registroSchema`.

## 3. Duplicados (niveles archivo, factura y probable) frente a proformas

**Nivel `archivo`:** no cambia. El mismo fichero es el mismo documento (índice `textil_compras_fichero_unico`, `20261015100000:72-74`).

**Nivel `factura`** (`cola-compras.ts:255`)
- Hoy salta con el mismo proveedor y el mismo `claveNumero`.
- Si un proveedor numera igual la proforma y la factura («123» y «123»):
  - la factura saldría como duplicada de su proforma;
  - `bloqueaRegistro` (`:291-292`) le impediría registrarse;
  - **en la base, `textil_compras_factura_unica`** (`20261015100000:77-80`, sobre `(empresa_id, proveedor_clave, numero_clave) WHERE estado='registrada' AND borrada_en IS NULL ...`) la rechazaría.
- Cambio necesario:
  - comparar solo cuando `tipo_documento` coincide;
  - en la base, añadir `AND tipo_documento = 'factura'` a ese `WHERE`, más un índice gemelo para proformas.
- El índice cambia de definición: no basta `IF NOT EXISTS`, hace falta `DROP INDEX` y crearlo de nuevo. Además, el texto de la restricción se traduce en `20261028100200:1041` y en `compras.functions.ts:188`, así que el nombre tiene que seguir igual o cambiar en los tres sitios.

**Nivel `probable`** (`:256-262`)
- Mismo proveedor, misma fecha y mismo importe. Una proforma y su factura del mismo día dan hoy «Posible duplicado…» (`avisoDuplicado`, `:284`).
- Ese par tiene que salir como **candidata a casar**, no como duplicado.

**Tipos y consultas**
- `CompraComparable` (`:215-227`): añadir `tipo_documento` y `proforma_id`.
- `CAMPOS_DUPLICADO` (`cola-compras.server.ts:30-31`): añadir `tipo_documento, proforma_id`.
- Los dos `duplicadosDe` de la interfaz (`PaginaCompras.tsx:975`, `RevisarCompraTextil.tsx:374`) tienen que pasar esos campos.

## 4. Dónde buscar proformas candidatas al leer una factura

**Función pura nueva**, por ejemplo `proformasCandidatas(factura, otras, hoy)`, en `src/dominio/cola-compras.ts` o en `src/dominio/proformas.ts`.

Filtro:
- `tipo_documento='proforma'`, `estado='registrada'`, `borrada_en` nulo;
- sin factura casada (que ninguna fila tenga `proforma_id = esa.id`);
- mismo proveedor;
- `fecha_proforma <= fecha_factura`.

Orden, de más a menos seguro:
1. La factura cita el número de la proforma: `claveNumero(referencia_proforma) === claveNumero(proforma.numero)`.
2. Mismo `total` (o `liquido`) con una diferencia ≤ `TOLERANCIA` (`factura-compra.ts:29`, 0,02).
3. Misma `base`.
4. Mismas unidades por variante. Las líneas de la factura pasan por `casarLineas`, y la memoria aprendida al registrar la proforma (4.9) las lleva a los mismos `stock_id`, así que se comparan Σ unidades por `stock_id` con las líneas de la proforma.

Igual que el casado (`casado-textil.ts`, cabecera, punto 5), **la función nunca casa sola: solo propone.** Lo confirma la persona.

**Servidor**, en `procesarFactura`, después de `cola-compras.server.ts:116`
- Hoy la consulta busca solo por `proveedor_clave`. Esa columna es el NIF y, si no hay NIF, el nombre (`20261015100000:43-47`). **Una proforma leída sin NIF y una factura con NIF tienen claves distintas y la consulta no la encuentra.**
- Arreglo: buscar también por `proveedor_id`, resolviendo el proveedor como hace `leerMemoriaEscaner` (`escaner-textil.functions.ts:88-117`). La proforma registrada ya tiene `proveedor_id`, porque lo fija el paso 5 del SQL (`:1036-1037`).
- Resultado: un motivo en `revision_motivo`, por ejemplo «Proforma PF-12 del 3/10 sin factura, mismo importe: ¿es esta?».

**Interfaz**
- `paraDuplicados` (`PaginaCompras.tsx:171`) ya tiene todas las compras con sus líneas. La misma función pura puede ir al lado de `duplicadosDe` (`:975` y `RevisarCompraTextil.tsx:374`) y mostrar un selector «Casar con proforma…».

**Aviso de proforma sin factura desde el día 1**
- Otra función pura sobre lo que devuelve `listCompras` (que trae `*`, `compras.functions.ts:443-448`): proformas registradas sin factura que apunte a ellas, desde su `fecha` y sin umbral.

## 5. Cómo registrar una factura casada sin stock

**TypeScript** (`compras.functions.ts`)
- `registroSchema` (`:254-260`): añadir `tipo_documento: z.enum(["factura","proforma"])` y `proforma_id: z.string().uuid().nullable().optional()`.
- Tipo `RegistroCompra` (`src/dominio/tipos-textil.ts:153-176`): los mismos dos campos.
- Handler (`:282-420`):
  - Con `proforma_id`, no llamar a `conCostesDeEntrada` (`:362-369`): su error E-REG-14 o I1 no aplica, porque el coste ya entró con la proforma.
  - Mandar las líneas con `stock_id` (copiado de la proforma o `null`) y `casado_metodo: null`, que `compra_linea_casado` admite (`20261028100000:294-296`).
- **Crítico, `caminoViejo` (`:314-356`) y `faltaLaFuncion` (`:407`):** con `proforma_id` o `tipo_documento` en la entrada, **nunca hay que caer al camino viejo**. `textil_compra_registrar` (`20261028100200:1096-1119`) mete stock de toda línea textil casada, y la factura volvería a meter el stock que ya metió la proforma. Hay que lanzar el aviso de la migración.
- **Interfaz** (`RevisarCompraTextil.tsx:400-410`): con una proforma elegida, quitar de `pendientes` «líneas sin variante» y «El reparto no cuadra». Si no, el botón (`:849`) queda deshabilitado.

**SQL** (función nueva o una versión nueva de `textil_compra_guardar_y_registrar`)
- Leer `_compra->>'proforma_id'`.
- Bloquear la proforma con `SELECT ... FOR UPDATE` y comprobar:
  - misma `empresa_id`;
  - `tipo_documento='proforma'`, `estado='registrada'` y `borrada_en IS NULL`;
  - que no esté ya casada;
  - mismo `proveedor_id`.
- `v_textil := v_categoria = 'textil' AND v_proforma IS NULL`, para saltarse entero el bloque 4 (`:752-1029`): sin E-REG-8, sin casado, sin movimientos y sin memoria. La categoría sigue siendo `textil`, porque Gerencia la necesita en Textil.
- Enlace: `proforma_id UUID` en la **factura**, fijado al insertarla, con:
  - `UNIQUE (proforma_id) WHERE proforma_id IS NOT NULL AND borrada_en IS NULL` (relación 1:1);
  - entrada en el array de inmutables (`:173-175`).
- No poner `factura_id` en la proforma: la proforma ya está registrada y habría que meter esa columna en la lista de «solo de nulo a valor» (`:184`).
- El pago:
  - Hoy es `estado_pago` / `fecha_pago` por fila (`pagarCompra`, `compras.functions.ts:502-524`, con el CHECK de `20261014100000:124`).
  - La factura casada debería nacer con el `estado_pago` y la `fecha_pago` de la proforma, en la misma transacción.
  - Los enlaces de conciliación de la proforma (`compra_id` en la tabla de enlaces que lee `src/lib/conciliacion.functions.ts:340-355`) tienen que pasar a la factura. Ese motor es de otra área.
  - Ojo: la conciliación solo propone compras con `estado='registrada'` (`:349-352`). Eso sirve para conciliar la proforma pagada por adelantado, pero hay que excluir la proforma ya casada.

## 6. Riesgos

1. **Coste congelado en la proforma.** El stock entra a `coste_unitario_entrada` de la proforma. Si la factura trae otro precio o portes nuevos, el coste medio queda mal, y los movimientos no se editan (trigger `stock_compra_solo_por_registro`, `:407-411`). Opciones: bloquear el casado si la base difiere más que `TOLERANCIA`, o exigir una nota. Lo decide Javier.
2. **Clasificación equivocada por la IA:**
   - Si una factura se registra como proforma, mete stock y su IVA no entra en el 303.
   - Si una proforma se registra como factura, cuando llegue la factura real se duplica el stock.
   - La confirmación humana del tipo tiene que ser explícita.
3. **Una proforma no se puede corregir.** Al ser textil y registrada, no se borra (`borrarCompra`, `compras.functions.ts:476-483`, y el trigger `:207-211`). Una proforma errónea solo se arregla con un ajuste de inventario.
4. **La factura casada tampoco se puede borrar con borrado lógico** (mismo trigger, por `categoria='textil'`), aunque no movió stock. Hay que decidir si se relaja la regla para las facturas casadas.
5. **Proformas sin NIF:** no se encuentran por `proveedor_clave` (sección 4).
6. **Casos 1:N** (una proforma con varias facturas por entregas parciales) y **N:1**: el `UNIQUE` 1:1 los excluye. Hay que confirmarlo con Javier.
7. **Exclusión fiscal (fuera de esta área, solo localizada):** las lecturas de `textil_compras` en `src/lib/gerencia.ts:520, 632, 792, 917, 996` y en `src/lib/archivo.functions.ts:81` tienen que filtrar `tipo_documento='factura'`. Ojo con Gerencia › Textil y el valor del stock, que sí debe contar la proforma mientras no tenga factura.
8. **Releer:** `releerFacturaRecibida` (`compras.functions.ts:628-662`) puede cambiar el tipo en un borrador. Es correcto, pero `procesarFactura` no debe conservar un tipo elegido a mano. Hoy pisa la cabecera entera (`:144-163`).

### conciliacion
# Proformas de proveedor: pagos, banco y conciliación

**Resumen.** Hoy un cargo del banco se concilia con una compra mediante filas de `banco_conciliaciones.compra_id`, y al conciliar la compra pasa a `estado_pago='pagada'`. Para que el pago anticipado de la proforma pase a la factura propongo una única función SQL, `compra_casar_proforma`. Esa función mueve los enlaces de la proforma a la factura con un `UPDATE compra_id`, que queda auditado, y copia el estado de pago. La proforma casada se excluye de lo conciliable y de los pagos pendientes. Lo que más importa: hoy una proforma pagada y sin factura no se ve en ninguna pantalla, y los campos nuevos tienen que entrar en el trigger de inmutabilidad de compras registradas.

## 1. Cómo se concilia hoy un cargo con una compra

**Tablas**

- **`public.banco_movimientos`** (`supabase/migrations/20260903280000_conciliacion_bancaria.sql`, líneas 30-43):
  - `importe` lleva signo: un cargo es negativo.
  - Restricción `banco_movimiento_unico UNIQUE (empresa_id, huella)`.
  - `traspaso_con` se añade en `20261017100000_conciliacion_motor.sql`, líneas 115-116.
  - Política `"banco baja"` (líneas 176-181): solo se borra un movimiento si no está conciliado.
  - Trigger `banco_movimientos_auditoria` (líneas 195-198).
- **`public.banco_conciliaciones`** (líneas 55-73, ampliada en `20261017100000`, líneas 59-110):
  - Cada fila enlaza un movimiento con un documento. `conciliacion_un_documento CHECK (num_nonnulls(factura_id, compra_id, textil_factura_id) = 1)` (líneas 75-79).
  - `compra_id UUID REFERENCES textil_compras(id) ON DELETE RESTRICT` (línea 61).
  - `estado` puede ser `'conciliada'` o `'revisar'` (`conciliacion_estado`, líneas 70-73).
  - `grupo UUID`: las filas de un mismo enlace lo comparten. Un enlace es 1 movimiento con N documentos, o N movimientos con 1 documento.
  - `importe` guarda lo que el documento espera ver en el banco. En una compra es `-liquido`, congelado al enlazar.
  - `diferencia` es Σmovimientos − Σdocumentos, con el mismo valor en todas las filas del grupo.
  - `marco_pagada` indica si la conciliación fue la que marcó el pago.
  - Se quitaron los UNIQUE uno a uno (líneas 81-82). Quedan `conciliacion_par_compra UNIQUE (movimiento_id, compra_id) WHERE compra_id IS NOT NULL` (líneas 87-88) e índices `conciliacion_por_compra` y `conciliacion_por_grupo` (líneas 94-96).
  - La aplicación no puede escribir en ella: `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated` (línea 110). Solo escriben las funciones `SECURITY DEFINER`.
  - Trigger de auditoría `banco_conciliaciones_auditoria`, `AFTER INSERT OR UPDATE OR DELETE` (`20260903280000`, líneas 200-203).
- **`public.textil_compras`**:
  - `estado_pago TEXT` con `compra_estado_pago CHECK IN ('pendiente','pagada')` y `fecha_pago DATE`, con `compra_pago_con_fecha CHECK ((estado_pago='pagada') = (fecha_pago IS NOT NULL))` (`20261014100000_compras_recibidas.sql`, líneas 68-69, 116 y 123-124).
  - `liquido` es una columna generada, y es la que se concilia (línea 152).

**Funciones** (todas en `20261017100000_conciliacion_motor.sql`)

- **`banco_enlazar_como(_usuario_id, _movimientos UUID[], _documentos JSONB, _estado, _motivo)`** (líneas 161-294):
  - Hace `set_config('app.usuario_id')` (línea 198), así que el cambio queda con autor.
  - Bloquea los movimientos `ORDER BY id FOR UPDATE` (líneas 201-219).
  - Para el tipo `'compra'` (líneas 230-240): bloquea la compra, exige `estado='registrada'` y que no esté borrada, y comprueba que no tenga ya un enlace (`EXISTS ... WHERE compra_id = d.id`).
  - Calcula lo esperado como `-c.liquido` y comprueba el signo (líneas 270-274).
  - Inserta el producto cartesiano movimientos × documentos (líneas 279-287). Si el estado es `'conciliada'`, llama a `banco_aplicar_efectos`.
  - El envoltorio que usa la aplicación es `banco_enlazar(...)`, con `auth.uid()` (líneas 299-315).
- **`banco_aplicar_efectos(_usuario_id, _grupo)`** (líneas 124-153): hace `UPDATE textil_compras SET estado_pago='pagada', fecha_pago = max(fecha del movimiento) WHERE estado_pago='pendiente'` y deja `marco_pagada = FOUND` (líneas 135-141).
- **`banco_confirmar(_grupo)`** (líneas 320-346): pasa el grupo de `'revisar'` a `'conciliada'` y aplica los efectos.
- **`banco_desenlazar_como(_usuario_id, _grupo)`** (líneas 354-388): devuelve a `'pendiente'` las compras con `marco_pagada` (líneas 372-376) y hace `DELETE` de las filas del grupo (línea 384).
- **Lectura** (`20261025100000_conciliacion_pendientes.sql`):
  - `banco_documentos()`, rama de compras (líneas 133-136): una compra es conciliable si `estado='registrada' AND borrada_en IS NULL`.
  - `banco_documentos_por_conciliar()` (líneas 204-227) quita lo que ya está enlazado.
  - `banco_enlaces()` (líneas 259-307) devuelve el JSON de documentos de cada grupo.

**Aplicación**

- `src/lib/conciliacion.functions.ts`:
  - `COLUMNAS_COMPRA` (línea 214), `deCompra` (líneas 218-228) y la etiqueta `compra: "Recibida"` (línea 140).
  - `leerPendientes` (líneas 271-298) lee de las funciones SQL. `leerDeTablas` (líneas 318-400) es el respaldo sin la migración 20261025 y lee `textil_compras` directamente (líneas 348-356).
  - Funciones de servidor: `aplicarPlan` (línea 599), `enlazarManual` (línea 637), `confirmarEnlace` (línea 662) y `deshacerEnlace` (línea 669).
- `src/dominio/motor-conciliacion.ts`:
  - `esperadoDe` (líneas 101-103) da lo esperado de una compra como `-importe`.
  - La ventana de fechas es `DIAS_ANTES = 5` y `DIAS_DESPUES = 45` (líneas 31-33), con `enVentana` en las líneas 119-122.
  - `planConciliacion` (líneas 293-393) solo propone verde si hay un reparto único (líneas 330-340). Si no, propone ámbar con motivo `varias_candidatas`.
- **Pago manual:** `pagarCompra` (`src/lib/compras.functions.ts`, líneas 502-523) escribe `estado_pago` y `fecha_pago` directamente, sin mirar si la compra tiene enlaces.
- **Inmutabilidad:** `compra_registrada_cabecera()` (`20261028100200_escaner_textil_reglas.sql`, líneas 138-223) actúa con los triggers `textil_compras_registrada_inmutable` (`AFTER UPDATE`, líneas 230-233) y `textil_compras_registrada_no_se_borra` (líneas 235-238).
  - Columnas congeladas (líneas 173-175): `empresa_id`, `proveedor`, `nif_proveedor`, `numero`, `fecha`, `base`, `iva`, `irpf`, `total`, `categoria`, `lectura_ia`, `cuota_iva`, `cuota_irpf`, `liquido`.
  - Columnas que solo pueden pasar de nulo a un valor (línea 184): `proveedor_id`, `fichero_ruta`, `fichero_huella`.
  - `estado_pago` y `fecha_pago` no están congeladas, así que se pueden cambiar en una compra registrada.
  - **Una columna que no esté en ninguna de las listas se puede cambiar libremente aunque la compra esté registrada.**

## 2. Por qué el pago anticipado debe enlazarse con la proforma

- La ventana del motor solo admite un movimiento 5 días antes del documento como mucho (`DIAS_ANTES = 5`, `motor-conciliacion.ts`, línea 31). El pago anticipado es anterior a la factura por varios días, así que el motor nunca lo propondría contra la factura. Contra la proforma, que es anterior al pago, sí cae dentro de la ventana.
- Si la proforma y su factura (mismo proveedor y mismo líquido) son conciliables a la vez, el motor no puede proponer verde (`repartosUnicos`, líneas 330-340). Las propone en ámbar `varias_candidatas` y puede casar el pago con la factura equivocada. Por eso hay que excluir la proforma casada de `banco_documentos()`.
- Hay un precedente que se puede copiar: el canje de ticket por factura (`sustituye_a_id`) en `banco_documentos()`, líneas 141-151 (tienda) y 170-179 (textil). Ahí ya se excluye «el ticket canjeado» y «la factura que canjea un ticket ya cobrado». La proforma hace el papel del ticket y la factura el de la factura que canjea.

## 3. Qué cambiar (todo en migración nueva; no la aplico)

### 3.1 Esquema de `textil_compras`

Esta parte la decide el área de compras; aquí solo lo que necesita la conciliación.

- `tipo_documento TEXT NOT NULL DEFAULT 'factura'` con `CHECK IN ('factura','proforma')`.
- `proforma_id UUID REFERENCES textil_compras(id) ON DELETE RESTRICT`, puesto en la factura. Añadir:
  - `CHECK (proforma_id IS NULL OR tipo_documento='factura')`;
  - un índice único parcial `textil_compras_proforma_casada_unica ON (proforma_id) WHERE proforma_id IS NOT NULL AND borrada_en IS NULL`, para que una proforma solo se case con una factura.
- En `compra_registrada_cabecera()`, `tipo_documento` va a la lista de congeladas (líneas 173-175) y `proforma_id` a la de «solo de nulo a un valor» (línea 184). **Riesgo:** si no se añaden, se podrían cambiar en una compra registrada.
- **Riesgo:** el índice `textil_compras_factura_unica (empresa_id, proveedor_clave, numero_clave) WHERE estado='registrada'` (`20261015100000_compras_cola.sql`, líneas 77-80) choca si el proveedor usa el mismo número en la proforma y en la factura. Habría que añadir `tipo_documento` a la clave.

### 3.2 Función nueva: `compra_casar_proforma_como(_usuario_id, _factura_id, _proforma_id)`

Va con un envoltorio `compra_casar_proforma(...)` que pasa `auth.uid()`, igual que `banco_enlazar` y `banco_enlazar_como`. Se le quita `EXECUTE` a `authenticated` en la versión `_como`. Todo ocurre en una sola transacción:

1. `set_config('app.usuario_id', _usuario_id::text, true)`, para que la auditoría tenga autor.
2. Bloquear las dos compras `ORDER BY id FOR UPDATE` y, después, `SELECT ... FROM banco_conciliaciones WHERE compra_id = _proforma_id FOR UPDATE`.
3. Comprobar:
   - que las dos son de la misma empresa (`es_miembro_empresa`), `registrada`, sin `borrada_en`, y que el tipo de documento es el correcto en cada una;
   - el mismo proveedor (`proveedor_id`, o si no `nif_proveedor` normalizado);
   - que la factura no tiene ningún enlace (`NOT EXISTS ... compra_id = _factura_id`);
   - que la proforma no está casada ya.
4. Mover los enlaces: `UPDATE banco_conciliaciones SET compra_id = _factura_id, importe = -factura.liquido WHERE compra_id = _proforma_id`.
   - Es un UPDATE en el mismo sitio, no un borrar y crear. Así se conservan `grupo`, `motivo`, `estado`, `conciliado_por` y `marco_pagada`, y el trigger `banco_conciliaciones_auditoria` deja anotados el valor viejo y el nuevo.
   - `banco_conciliaciones` no es un registro fiscal ni cerrado: ya se borra en `banco_desenlazar_como`.
   - El índice `conciliacion_par_compra` no choca, porque el paso 3 garantiza que la factura no tenía enlaces.
5. Recalcular `diferencia` de cada grupo tocado: Σmovimientos − Σ`importe` de las filas del grupo.
   - Si el líquido de la factura no coincide con el de la proforma, hay dos opciones: (a) rechazar si la diferencia supera 1 céntimo, o (b) dejar el grupo en `'revisar'`. **Javier tiene que elegir.**
   - Con (b), `banco_confirmar` vuelve a llamar a `banco_aplicar_efectos`, que solo actúa sobre lo `'pendiente'`. Por eso la factura debe quedarse pendiente hasta confirmar.
6. Copiar el estado de pago: `UPDATE textil_compras SET estado_pago = proforma.estado_pago, fecha_pago = proforma.fecha_pago WHERE id = _factura_id`. Esto también cubre la proforma pagada a mano con `pagarCompra`, sin enlace. El trigger de inmutabilidad lo permite.
7. `UPDATE textil_compras SET proforma_id = _proforma_id WHERE id = _factura_id`, que es de nulo a un valor y por tanto está permitido.
   - La proforma no se toca: conserva su `estado_pago` y `fecha_pago` como historia. Deja de contar porque se excluye en todas partes por estar casada.

**Deshacer:** función simétrica `compra_descasar_proforma` que devuelve los enlaces a la proforma. **Pero** quitar `proforma_id` es pasar de un valor a nulo, y el trigger lo prohíbe. O se añade la excepción solo dentro de esta función (con un GUC `app.descasar` comprobado en el trigger), o casar es irreversible. **Decisión de Javier.**

**Alternativa descartada: tratar el par como uno.** Sería dejar el enlace en la proforma y que la factura derive su estado de pago de ella. Funciona, pero `banco_desenlazar_como` (líneas 372-376) solo devolvería la proforma a pendiente y la factura se quedaría `'pagada'` sin respaldo. Habría que tocar `banco_aplicar_efectos` y `banco_desenlazar_como` para que propaguen el cambio a la factura casada, y la pantalla de conciliación seguiría mostrando el pago contra un documento que no es fiscal. Javier pidió que «el pago pasa a la factura», y eso es mover el enlace.

### 3.3 Conciliación (SQL)

- **`banco_enlazar_como`**, rama `'compra'` (líneas 230-240):
  - Rechazar una proforma ya casada: «Esa proforma ya tiene factura: concilia con la factura».
  - Rechazar una factura casada cuya proforma tenga enlaces. Esto en la práctica ya lo cubre el traslado.
- **`banco_documentos()`**, rama de compras (líneas 133-136): añadir `AND c.id NOT IN (SELECT f.proforma_id FROM textil_compras f WHERE f.proforma_id IS NOT NULL AND f.estado='registrada' AND f.borrada_en IS NULL)`. Usar `NOT IN` y no una subconsulta por fila, por el mismo motivo de rendimiento y JIT que se explica en las líneas 111-117. Devolver también `tipo_documento`, lo que obliga a cambiar el `RETURNS TABLE` con un `DROP FUNCTION` y volver a crear `banco_documentos_por_conciliar()` y `banco_enlaces()`, que dependen de su forma.
- **`banco_enlaces()`**: añadir `tipo_documento` al JSON de documentos (líneas 279-283).
- **Pruebas SQL** que hay que ampliar: `supabase/pruebas/C5_conciliacion_motor.sql` y `C14_conciliacion_pendientes.sql`. Más una prueba nueva de casar y descasar con auditoría.

### 3.4 Conciliación (aplicación)

- `src/lib/conciliacion.functions.ts`:
  - Añadir `tipo_documento` en `COLUMNAS_COMPRA` (línea 214) y en `deCompra` (línea 218).
  - Etiqueta «Proforma» junto a `compra: "Recibida"` (línea 140).
  - En el respaldo `leerDeTablas` (líneas 348-356 y 376-386), la misma exclusión de proformas casadas.
- `src/dominio/motor-conciliacion.ts`: no cambian las reglas. Opcionalmente, `Documento` lleva `tipo_documento` para pintarlo.
- **Función de servidor nueva:** `casarProforma` en `src/lib/compras.functions.ts`, con zod en la primera línea, que llama al RPC con `context.supabase`, igual que `enlazarManual`.
- **`pagarCompra`** (líneas 502-523): rechazar si la compra es una proforma casada. **Riesgo:** hoy permite poner `'pendiente'` una compra que está enlazada con el banco; se detalla en la sección 5.

## 4. Tesorería y pagos pendientes con una proforma pagada sin factura

**Lo que pasa hoy**

- **Banco:** `resumenBanco` (`src/dominio/gerencia.ts`, líneas 358-385) cuenta el pago como `salidas`. El indicador `conciliado` solo se usa para las entradas (líneas 365-370), y el aviso `banco_sin_casar` (líneas 402 y 432-438) también es solo de entradas. Es correcto y no hay que tocarlo.
- **Pagos pendientes:** `usePagosProveedores` (`src/lib/gerencia.ts`, líneas 982-1008) filtra `estado='registrada'` y `estado_pago='pendiente'`. `pagosPendientesProveedores` (`src/dominio/pagos-proveedores.ts`, línea 99) aplica el mismo filtro.
  - Una proforma **sin pagar** sale como deuda, y está bien porque Javier la paga por adelantado.
  - Una proforma **pagada** no sale en ningún sitio: **hoy es invisible**.
  - Se ve en `Tesoreria.tsx` (líneas 242-290) y en `ResumenDiario.tsx` (líneas 184-197).
- **Riesgo de contar dos veces:** la proforma pendiente y su factura pendiente sin casar suman la misma deuda dos veces. Una vez casadas, la factura recibe el estado de la proforma.

**Cambios**

- **`pagos-proveedores.ts`**:
  - Añadir `tipo_documento` y `proforma_id` a `CompraPendiente` (líneas 16-28).
  - En la línea 99, excluir toda compra cuyo `id` sea el `proforma_id` de otra compra.
  - El cálculo en dominio solo es correcto si la consulta trae también las facturas pagadas. Es más fiable que la consulta traiga un indicador `casada`, con un embed `textil_compras!proforma_id(id)` o desde SQL.
  - Añadir `CAMPOS_PAGO_PROVEEDOR` (`gerencia.ts`, línea 982) y respaldo con `faltaLaColumna`, como ya se hace con `proveedor_id` (líneas 1002-1004).
  - El texto «facturas» pasa a «documentos», o se separan las proformas en su propia línea.
- **Bloque nuevo «Anticipos a proveedores (proformas pagadas sin factura)»**, en dominio y en Tesorería:
  - consulta `tipo_documento='proforma' AND estado='registrada' AND borrada_en IS NULL AND estado_pago='pagada' AND no casada`;
  - total por `liquido`, número, y días desde `fecha_pago`.
  - Es dinero que ya ha salido sin factura deducible: Gerencia no lo cuenta como compra, así que la caja y los resultados no cuadran justo por ese importe.
- **Aviso desde el día 1:** variante nueva `{ tipo: "proforma_sin_factura"; nivel: "medio"; proformas: number; importe: number; masAntigua: string }` en el tipo `Aviso` (`gerencia.ts`, líneas 394-402) y en `avisosGerencia` (línea 411).
  - El aviso no depende del periodo, así que se le pasa aparte, igual que `PagosProveedores`, que ya ignora el periodo («no depende del periodo», `Tesoreria.tsx`, línea 241).
  - Cuenta toda proforma registrada y no casada, pagada o no, con su antigüedad.

## 5. Riesgos y cosas encontradas (sin arreglar)

- **`pagarCompra`** (`compras.functions.ts`, líneas 502-523) cambia `estado_pago` sin mirar `banco_conciliaciones`. Puede dejar `'pendiente'` una compra conciliada, o `'pagada'` una que después concilia `banco_enlazar` con `marco_pagada = false`. Al desenlazar, esa compra seguiría pagada.
- **Borrado lógico:** una compra que no es textil se puede borrar (`borrada_en`) aunque tenga filas en `banco_conciliaciones`. La FK con `ON DELETE RESTRICT` no actúa en un borrado lógico. El enlace queda apuntando a un documento que «no cuenta». Con proformas se agrava: borrar una proforma pagada dejaría su pago colgado.
- **`banco.functions.ts`**, líneas 234 y 258-290: la pantalla antigua solo mira `factura_id`. No afecta a las compras, pero cuenta como «sin conciliar» lo que tenga solo `compra_id`, si alguien la usa todavía.
- **`leerDeTablas`** es una segunda implementación de las reglas de `banco_documentos()`. Cualquier exclusión nueva hay que escribirla dos veces y mantenerlas iguales.
- **Reversión de 20261017** (`supabase/reversiones/20261017100000_conciliacion_motor.sql`, líneas 15-18): ya se niega a revertir si hay `compra_id`, así que no le afecta.

### gerencia
# Proformas de proveedor: qué cambiar en todo lo que lee `textil_compras` para las cuentas

No he cambiado nada en el repositorio. Doy por supuestas dos columnas nuevas en `textil_compras`, que no existen todavía y cuyos nombres son solo una propuesta:
- `tipo_documento`, con valores `'factura'` o `'proforma'`.
- `proforma_id`, en la factura: una FK a `textil_compras(id)` que apunta a su proforma.

## 0. Un solo punto de filtro ya existente

- **`src/lib/gerencia.ts:493-505` `leerCompras()`** termina en `comprasQueCuentan(r.data)` en la línea 504. Por ahí pasan `useComprasGerencia`, `useFiscal` y `useTextilGerencia`.
- **`src/dominio/compras.ts:337-347` `importesDeCompra()`** hoy devuelve `null` solo si hay `borrada_en`. Hay que añadir `if (c.tipo_documento === 'proforma') return null`.
  - Con eso las proformas salen del IVA (303/111), de Gerencia (gastos y amortizaciones), de la comparación de consumibles y de las compras de la pestaña Textil.
  - La factura casada sigue contando con normalidad: es el documento fiscal.
- **Tipo**: `CompraResumen` (`src/dominio/fiscal.ts:175-196`) necesita `tipo_documento?` y `proforma_id?`.
- **Columnas leídas**: la lista `CAMPOS_COMPRA_POR_MIGRACION` (`gerencia.ts:481-490`) necesita una primera entrada con las columnas nuevas. Si falta la columna, se repite la lectura sin ella y todas cuentan como factura.
- **Riesgo**: no filtres en SQL con `.neq("tipo_documento","proforma")`. En una base sin la migración la consulta falla, y `.neq` deja fuera los NULL. Hay que filtrar en el dominio, después de leer.

## 1. Cada consulta o función que suma o cuenta compras

| # | Fichero:línea | Qué hace | Proforma | Factura casada | Cambio |
|---|---|---|---|---|---|
| 1 | `gerencia.ts:513-532` `useComprasGerencia` | Registradas y no textil (`.neq("categoria","textil")`), para gastos y amortizaciones | **Excluir** | Cuenta | Cubierto por el punto 0. Sin filtro, una proforma de maquinaria pagada por adelantado se amortizaría dos veces |
| 2 | `compras.ts:88-143` `gastosConCompras` (llamada desde `routes/panel/gerencia.tsx:108`) | La compra va a un gasto fijo (`gasto_id`), a gasto puntual o a amortización | Excluir | Cuenta | Cubierto por el punto 0. Una proforma con `gasto_id` absorbería el cargo del gasto fijo (`comprasAbsorbidas`, `dominio/gerencia.ts:673`) |
| 3 | `gerencia.ts:612-680` `useFiscal` → `.compras` | Compras del rango | Excluir | Cuenta, por la **fecha de la factura** | Cubierto por el punto 0 |
| 4 | `components/gerencia/Fiscal.tsx:58-68` → `ivaSoportado` (`fiscal.ts:206-222`) | Tarjeta «IVA soportado» y resultado del IVA | Excluir | Cuenta | Nada más que el punto 0. `ivaSoportado` cuenta `estado==='registrada'`, y una proforma registrada sumaría si no se filtra |
| 5 | `impuestos.ts:588-640` `impuestosPorTrimestre` (líneas 618-625: `ivaSoportado` y `irpf111`), llamada desde `Resultados.tsx:123-135` | 303 y 111 por trimestre | Excluir | Cuenta en el trimestre de la factura | Cubierto. La factura casada **no** debe heredar la fecha de la proforma |
| 6 | `compras.ts:146-161` `comprasParaComparar`, llamada desde `Resultados.tsx:119-121`. Su pie es `totalesComparadas` en `sumatorios-gerencia-b.ts:90-100` | Base de consumibles y envíos | Excluir | Cuenta | Cubierto. Sin el filtro, una proforma de tinta más su factura duplican lo comprado |
| 7 | `gerencia.ts:765-818` `useTextilGerencia` (filtro textil en 801-804) → `Textil.tsx:86-89` `ivaSoportado` → «Compras del periodo, sin IVA» en `Textil.tsx:278-293` | Base textil del periodo y `sinRegistrar` | Excluir | Cuenta por la fecha de la factura | Cubierto por el punto 0. **Añadir** una línea aparte: «N proformas sin factura (X €)», junto a `sinRegistrar` (289-293). Cambiar el texto de `definiciones.ts:349-353` `g_compras_textil` |
| 8 | `gerencia.ts:903-981` `useControlesAlmacen` → `controles-almacen.ts:63-105` `controlComprasEntradas` | Base de cada compra textil registrada frente a Σ de sus entradas `motivo='compra'` por `compra_id` | **Incluir**: tiene las entradas | **Tratar el par** | Ver el apartado 2 |
| 9 | `gerencia.ts:991-1012` `usePagosProveedores` → `pagos-proveedores.ts:84-120` `pagosPendientesProveedores` | Registradas, sin borrar y con `estado_pago='pendiente'`. **No** pasa por `comprasQueCuentan` | Incluir mientras esté pendiente: es un pago real que hay que hacer | Contar **una** vez por par | Ver el apartado 3 |
| 10 | `lib/archivo.functions.ts:79-91` `listarArchivo` → `dominio/archivo.ts:323` `deCompra`, `:348-352` `entraEnArchivo` → `sumatorios-facturas.ts:139-146` `totalesArchivo`, y `routes/panel/archivo.tsx:241-250` | ZIP de PDFs para la gestoría y su total | **Excluir**: no es documento fiscal | Entra | Leer `tipo_documento` en el `select` de la línea 83 y descartar en `entraEnArchivo`. Si no, la gestoría recibe la proforma y la factura dentro de `compras/` |
| 11 | `sumatorios-facturas.ts:77-92` `totalesCompras`, en el pie de `PaginaCompras.tsx:274-275` | Base y líquido de la lista | Excluir del pie, o sumarla aparte | Cuenta | Hoy suma el par dos veces |
| 12 | `lib/conciliacion.functions.ts:347-356` (candidatas) y `:379-385` (`docsEnlazados`) | Compras registradas sin borrar como candidatas a un movimiento del banco | Incluir: el pago se concilia con ella | Excluirla si su proforma ya está enlazada | Si no, el motor ofrece la factura casada como pendiente y el mismo pago puede conciliarse dos veces |
| 13 | `routes/panel/textil/stock.tsx:874-879` | Compras textil registradas para enlazar una `devolucion_proveedor` | Incluir: tiene las entradas | Mostrarla junto a su proforma | Si se enlaza a la factura, el `compra_id` de la devolución apunta a una compra sin entradas. Es válido por `stock_compra_id_motivo` (reglas.sql:442-443) pero no se puede rastrear |
| 14 | `cuenta-almacen.ts:105-170` `cuentaAlmacen` (la partida `compras` va en 127-128), más `costeAlmacenPeriodo` y `valorAFecha` | Sale solo del libro de movimientos | n/a | n/a | **Sin cambio en el cálculo.** Las entradas se fechan con `v_fecha` de la proforma (`20261028100200_escaner_textil_reglas.sql:984-994`). Cambiar el texto «(en las compras, la de la factura)» de `definiciones.ts:354-360` `g_almacen_cuenta` |
| 15 | `Textil.tsx:412` y `pdf-informe-socios.ts:1144,1175` «+ Compras» | Salen de `cuentaAlmacen` | n/a | n/a | Sin cambio |
| 16 | `lib/resumen-diario.ts:288` `useFiscal` | Solo usa `documentos` y `referencias` | n/a | n/a | Sin cambio |
| 17 | `ResumenDiario.tsx:182-199` → `InformeAlmacen` (`cuenta-almacen.ts:197-203`) | Controles y pagos a proveedores para el PDF | | | Recibe los cambios de los puntos 8 y 9. Propongo añadir `proformasSinFactura: {n, base} \| null` al tipo |
| 18 | `stock-textil.ts`, `export-analisis.ts` (no lleva compras), `sumatorios-gerencia-a.ts` | No leen `textil_compras` | | | Sin cambio |

## 2. Control del almacén: compras frente a entradas (`sin_enlace`)

**Cómo funciona hoy:**
- `gerencia.ts:917-923` lee las compras con `estado='registrada'` y fecha en el rango.
- `gerencia.ts:932` se queda con las textil.
- `gerencia.ts:937-948` busca los movimientos `motivo='compra'` con `.in("compra_id", trozo)`.
- `controles-almacen.ts:83-87`: si no hay ninguna entrada enlazada, la fila queda en `"sin_enlace"`.

**Qué pasaría con las proformas:**
- **La proforma** tiene las entradas y cuadra. Está bien.
- **La factura casada** no tiene movimientos, así que saldría en `sin_enlace`. Hoy eso cuenta en `sinEnlace` (línea 100) y aparece como «anterior al enlace: no se puede comprobar» en `Textil.tsx:614-620` y en `pdf-informe-socios.ts:1302-1303`. El texto sería falso, y además esconde el caso de verdad: que la factura y la proforma no coincidan.

**Propuesta: tratar el par**
- En `CompraControl` (`controles-almacen.ts:20-29`) añadir `tipo_documento?` y `proforma_id?`.
- En `CAMPOS_COMPRA_CONTROL_POR_MIGRACION` (`gerencia.ts:883-887`) añadir una primera entrada con esas columnas.
- **Una fila por par**, anclada en la proforma, porque las entradas llevan su fecha:
  - Comparar Σ de las entradas de la proforma con la base de la proforma.
  - Si tiene factura casada, comparar además la base de la factura con Σ de las entradas. Así se detecta que la factura final cambie por portes, descuentos o una línea de menos.
  - La factura casada no tiene fila propia.
- **Lectura fuera del rango**: si la proforma cae en el periodo y la factura en el siguiente, o al revés, hay que leer la otra por id. Se puede hacer con `leerPorIds`, como `referenciasDeCanje` en `gerencia.ts:577-604`.
- **Estados**: añadir `"casada"`, o `"proforma_sin_factura"`, a `FilaControlCompra["estado"]` (`controles-almacen.ts:41`) y a `ORDEN_ESTADO` (52-56). Dejar `sin_enlace` solo para las compras de antes de la migración 20261028100000.
- **Aviso desde el día 1** (proforma registrada sin factura casada): ponerlo como contador nuevo en `ResumenControles` (107-123).
  - Mi propuesta es que **no** rompa `todoEnCero` (138-145), porque es una espera normal de días. Tiene que decidirlo Javier.
  - Este control solo mira el periodo. El aviso debería salir de una consulta sin rango, como `usePagosProveedores`.
- **Riesgo abierto: una factura casada que no coincide con su proforma.** El libro es inmutable y no existe un motivo de «revalorización». Si la factura difiere, el descuadre se queda para siempre o hay que crear un tipo de ajuste de valor. Javier tiene que decidir antes de que el control lo marque como descuadre.
- **Textos que cambian**:
  - `Textil.tsx:614-620`.
  - `pdf-informe-socios.ts:1297-1303`.
  - `definiciones.ts:370-374` `g_almacen_controles`.
- **Pruebas que cambian**: `controles-almacen.test.ts:57`, `:72` y `:113`.

## 3. Pagos y tesorería (punto 9)

- `banco_aplicar_efectos` (`20261017100000_conciliacion_motor.sql:137-138`) pone `estado_pago='pagada'` solo en el `compra_id` del enlace, que será la proforma.
- `banco_desenlazar_como` (líneas 375-376) lo revierte solo en ese mismo `compra_id`.

**Riesgos:**
- La factura casada nace con `estado_pago='pendiente'` (es el DEFAULT, `compras_recibidas.sql:68`). Entonces aparece como deuda aunque ya esté pagada.
- Si al casarla se copia `pagada`/`fecha_pago` a la factura, deshacer la conciliación revierte la proforma pero no la factura.

**Propuesta:**
- Al casar, mover el enlace de `banco_conciliaciones.compra_id` de la proforma a la factura. Así el pago «pasa a la factura» y el desenlazado sigue funcionando.
- En `pagosPendientesProveedores` (línea 98), descartar la proforma que tenga factura casada.
- `CAMPOS_PAGO_PROVEEDOR` (`gerencia.ts:983-984`) tiene que leer `tipo_documento` y `proforma_id` con la misma lectura de respaldo que en el punto 0.
- Texto de `definiciones.ts:417-423` `g_pagos_proveedores`.

## 4. Riesgos fuera de las cuentas que tocan este diseño (solo los anoto)

- **Índice único**: `textil_compras_factura_unica` (`20261015100000_compras_cola.sql:76-79`, clave `(empresa_id, proveedor_clave, numero_clave)` con `WHERE estado='registrada'`). Si la proforma y la factura llevan el mismo número, la factura no se puede registrar. Hay que añadir `tipo_documento` a la clave o excluir las proformas en el WHERE.
- **Avisos de duplicado**: `duplicadosDe` y `bloqueaRegistro` (`cola-compras.ts:83-131`) marcarán la factura como duplicado de su proforma, de nivel «factura» o «probable». Hay que excluir el par.
- **Inmutabilidad de lo registrado**: `compra_registrada_cabecera()` (`reglas.sql:138-233`) no bloquea columnas nuevas.
  - Conviene poner `proforma_id` en la lista «solo de nulo a un valor» (línea 186), para que un casado no se pueda cambiar ni deshacer a mano.
  - El borrado lógico de lo textil está prohibido (línea 207), así que una proforma textil registrada no se puede borrar. Hay que contar con ello al casarla.
- **Fechas**: la base de la pestaña Textil (punto 7) va por la fecha de la factura, y «+ Compras» de la cuenta del almacén (punto 14) por la de la proforma. En un periodo pueden no coincidir, y hay que explicarlo en las ⓘ.

## 5. Pruebas que habrá que tocar

- `src/dominio/compras.test.ts`: `importesDeCompra` y `comprasQueCuentan`.
- `src/dominio/controles-almacen.test.ts`.
- `src/dominio/fiscal.test.ts`.
- `src/dominio/impuestos.test.ts`.
- `src/dominio/archivo.test.ts`.
- `src/dominio/sumatorios-facturas.test.ts`: `totalesCompras` y `totalesArchivo`.
- `src/dominio/pagos-proveedores.test.ts`.
- `src/dominio/cola-compras.test.ts`.

### pantallas
# Informe de pantallas para las proformas de proveedor en Compras

Solo he leído código. No he cambiado nada. Rama `claude/crm-dtf-app-review-ftg3di`.

**Riesgo principal:** hoy una proforma y su factura del mismo proveedor salen como duplicados. Si comparten número, `bloqueaRegistro` impide registrar la factura y la conciliación con la proforma no puede llegar a hacerse (punto 5).

## 0. Lo que hay hoy

- **Rutas:** `src/routes/panel/compras.tsx` es `<PaginaCompras modo="general" />` y `src/routes/panel/textil/compras.tsx` es `<PaginaCompras modo="textil" />`. No hacen falta rutas nuevas. `src/routeTree.gen.ts` no se toca.
- **`src/components/compras/PaginaCompras.tsx`** (1635 líneas):
  - Funciones auxiliares: `enCola` (l.111) y `estadoDe` (l.122).
  - Revisión: `nueva()` (l.180) y `desdeFila()` (l.195) construyen la revisión.
  - Lista: los filtros van en la URL con `useFiltrosUrl({q, estado, categoria, anio, trimestre, proveedor, fichero})` (l.233). El filtrado está en `filtrados` (l.244) y el pie en `totales = totalesCompras(filtrados)` (l.275).
  - Mutaciones: registro en `registrar` (l.354) y pago en `pagar` (l.449).
  - Bloques de la página: `<SubidaFacturas>` (l.560), `<ColaRevision>` (l.567), `<BarraFiltros>` (l.574), tabla (l.666–822), `<ConfirmarBorrado>` (l.825), diálogo «Marcar como pagada» (l.843–870) y diálogo de revisión (l.875–910).
- **`RevisarCompraTextil.tsx`:**
  - Tipos: `Revision` (l.86–116) y `ExtraRegistro` (l.118).
  - Lógica: lista de requisitos `pendientes` (l.392) y `registrar()` (l.412).
  - Interfaz: `DialogTitle` «Revisar la compra textil antes de darla de alta» (l.432), botón «Registrar y dar de alta en el stock» (l.855).
  - Componentes exportados: `TarjetaQueMirar` (l.1016), `FicheroRevision` (l.1089), `Campo` (l.1134).
- **`ColaRevision.tsx`:** la tarjeta ámbar «Por revisar», con su tabla y su pie (`totalesCola`).
- **`SubidaFacturas.tsx`:** la prop `categoria?: "textil"` (l.37) se envía como `fd.append("categoria", …)` (l.66).
- **`LineasEditor` no es de compras.** Es `src/components/textil/LineasEditor.tsx` y lo usan presupuestos y pedidos textil. No sirve para la comparación.
- **Panel principal:** `src/routes/panel/index.tsx` (`DashboardGlobal`) no tiene ningún bloque de avisos. Solo muestra indicadores (`TarjetaKpi`) y gráficas.
- **Gerencia:**
  - Los avisos los genera `avisosGerencia()` en `src/dominio/gerencia.ts:411`. El tipo `Aviso` (l.391) es una unión de `deuda_antigua | caida_ventas | web_sin_pagar | banco_sin_casar`.
  - Los textos están en `textoAviso()` y los enlaces en `destinoAviso()` (`src/components/gerencia/destinos.ts:149` y `:162`).
  - Se pintan en la tarjeta «Avisos» de `src/components/gerencia/Resumen.tsx:69–80` (cálculo) y `:177–203` (pintado).
  - Hay un segundo patrón de aviso: el botón con ventana emergente `PendienteDocumentar` (`src/components/gerencia/PendienteDocumentar.tsx`), colocado en la cabecera de `src/routes/panel/gerencia.tsx:191`.

## 1. Tipo de documento en la lista (`PaginaCompras.tsx`)

1. **Columna o badge.** No haría una columna nueva: cambiaría `colSpan` en l.689, l.694 y l.806, y movería el pie. Mejor un badge junto al número, en la celda de l.713, al estilo del bloque «Recibo de…» (l.704–708). Por ejemplo: `{c.tipo_documento === "proforma" && <Badge variant="outline" className="ml-1 border-amber-500 text-amber-700">Proforma</Badge>}`. Es el mismo estilo que la «Sugerencia» de `RevisarCompraTextil.tsx:985`.
2. **Una proforma casada** se ve como texto pequeño bajo el número: `<span className="block text-xs text-muted-foreground">Facturada en n.º X</span>`. **Una factura casada**, igual, con «De la proforma n.º Y».
3. **Filtro nuevo** en `useFiltrosUrl` (l.233–241): `documento: "todos"`, con un `<SelectFiltro etiqueta="Documento">` al estilo de «Fichero» (l.632–642). Opciones: «Facturas y proformas», «Solo facturas», «Proformas sin factura», «Proformas facturadas». Hay que añadir la condición en `filtrados` (l.244–272) y en sus dependencias (l.258–271).
4. **El filtro Estado** (l.579–590) se rellena con los valores que haya en `estadoDe`, así que no hay que tocarlo. Hay que decidir si la proforma lleva `estado = 'registrada'` (recomendado, porque mueve stock igual). Si fuera otro valor, aparecería solo en el desplegable.
5. **Pie de la tabla** (l.804–819 y `totalesCompras`, `src/dominio/sumatorios-facturas.ts:77`):
   - **Riesgo:** hoy suma todo lo que no es borrador. Una proforma más su factura casada sumarían dos veces.
   - `totalesCompras` debe excluir las proformas, que no son documento fiscal (el pie ya trata así los borradores).
   - El rótulo del pie quedaría «Total · N facturas · sin M proformas» (el mismo patrón que «sin X borradores», l.808–809).
   - Hay que adaptar sus pruebas.
6. **Botón Pagada/Pendiente** (l.760–788): hoy solo sale con `general && recibidas`, así que en Textil › Compras no se puede marcar el pago. Javier paga la proforma por adelantado, y la proforma es textil. Hay que mostrarlo también en modo textil para `tipo_documento === "proforma"`. Hay que ocultarlo (o dejarlo de solo lectura con «Pagada con la proforma») en una factura casada cuyo pago viene de la proforma.
7. **Borrar** (l.789–797, y el servidor `borrarCompra` en `src/lib/compras.functions.ts:467`):
   - Una proforma registrada ha movido stock, así que no se puede borrar. Con la condición actual no sale el icono porque es textil, y el servidor la rechaza también por ser textil (l.479–483). Correcto.
   - **Riesgo:** una factura casada no ha movido stock, pero es textil, así que el servidor le da el mensaje «ya movió stock». Hay que decidir si una factura casada se puede marcar como borrada, lo que deshace el casado y deja la proforma pendiente otra vez. Si se puede, cambiar el texto de `consecuencias` en `<ConfirmarBorrado>` (l.829–839).
8. **Botón «Ver el fichero»** (l.733–741): en una factura casada conviene un segundo icono para abrir el fichero de la proforma. `verFicheroCompra` ya recibe un `id`.

## 2. Sección «Proformas pendientes de factura» (aviso desde el día 1)

**Dónde va.** En `PaginaCompras`, entre `<ColaRevision>` (l.567–573) y `<BarraFiltros>` (l.574). Un componente nuevo `src/components/compras/ProformasPendientes.tsx`, copiado de la estructura de `ColaRevision.tsx`:

- **Contenedor:** `<Card className="border-amber-500/50">`, con `CardTitle` que lleva el icono `AlertTriangle className="h-4 w-4 text-amber-600"` y «Proformas sin factura (N)».
- **Texto de ayuda:** «El género ya está en el stock. No cuentan en el IVA ni en Gerencia hasta que llegue la factura y la cases.»
- **Tabla:** `Table movil="tarjetas"` con las columnas Proveedor (n.º debajo en `text-xs`), Fecha, Días, Total, Pago y acciones.
  - Días: con `diasDesde()` de `src/dominio/pendientes.ts:56`.
  - Pago: `StatusBadge estado="pagada"|"pendiente"` (`src/components/StatusBadge.tsx`).
  - Acciones: «Ver fichero» y «Casar con factura».
- **Pie:** `TableFooter` con «Total · N proformas» y la suma con `sumarImportes` (`src/dominio/sumatorios.ts`), en `font-bold tabular-nums`.
- **Sin pendientes:** `return null`, como `ColaRevision` (l.56). No se inventa ningún estado.
- **Desde el día 1:** sin umbral. Toda proforma registrada, sin borrar y sin factura casada aparece desde que se registra. El nivel de color puede subir con los días: `text-status-pendiente` hasta X días y `text-status-cancelado` a partir de ahí (los dos niveles que ya usa `Resumen.tsx:191–193`). Esto es una decisión de Javier. Si no la toma, todo en ámbar.
- **Lógica:** la lista y la suma salen de una función pura en `src/dominio/` (por ejemplo `proformasSinFactura(compras)` en un `src/dominio/proformas.ts` nuevo, con su `.test.ts`), no en el componente.
- **Pantallas donde sale:**
  - Textil › Compras: siempre.
  - Compras generales: también, porque allí se ven todas las compras. Hay que filtrar con `!(cola && enCola(c))`, igual que en l.249.
  - **Riesgo:** con la lista filtrada por periodo, una proforma antigua desaparecería. Esta sección tiene que leer `compras` sin `filtrados` ni `periodo`.

**Gerencia:**

- Añadir el tipo `{ tipo: "proforma_sin_factura"; nivel: "medio"; proformas: number; importe: number; masAntigua: number }` a `Aviso` (`src/dominio/gerencia.ts:391`).
- Añadir su rama en `avisosGerencia()` (l.411) y en `gerencia.test.ts`.
- Textos y destino: añadir la rama en `textoAviso` y `destinoAviso` (`destinos.ts:149/162`), que lleva a `{ to: "/panel/textil/compras", search: { documento: "proforma_pendiente" } }`.
- Datos: hacen falta en `DatosGerencia` (`destinos.ts`, el tipo que montan `src/routes/panel/gerencia.tsx:100–170`). Hoy Gerencia no carga la lista de compras. Hay que añadir una consulta pequeña, independiente del periodo, como ya pasa con `pendientes`.
- **Riesgo:** las dependencias de `useMemo` en `Resumen.tsx:78`.
- **Alternativa con menos cambios:** un botón en la cabecera de Gerencia, al estilo de `PendienteDocumentar` (`Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs text-status-pendiente"` y un `Popover`), junto a l.191 de `gerencia.tsx`. Es visible en todas las pestañas y no depende de los filtros.

**Panel principal** (`src/routes/panel/index.tsx`): no hay ningún patrón de avisos. Añadir uno sería crear una tarjeta nueva. Recomiendo no hacerlo y avisar en Gerencia y en Compras.

**Textil (inicio)** (`src/routes/panel/textil/index.tsx`): la tarjeta «Compras» no existe en el array `cards`. Se puede añadir con `hint: "N proformas sin factura"`, siguiendo el patrón de «Stock», `hint: "${stockBajo} bajo mínimo"`.

## 3. Clasificación en la subida y la revisión

1. **Cola** (`ColaRevision.tsx`): en la celda «Factura» (l.85–90), un badge «Proforma» si la IA la clasificó así. El pie (`totalesCola`) separa «· N proformas».
2. **Revisión** (`Revision` en `RevisarCompraTextil.tsx:86`): añadir `tipo_documento: "factura" | "proforma"`, que rellena `desdeFila` (`PaginaCompras.tsx:195`) desde la fila y `nueva` (l.180) desde la lectura.
   - Un conmutador visible para corregir a la IA: un `Select` o `ToggleGroup` (`src/components/ui/toggle-group.tsx`) junto a los `Campo` de l.470–495.
   - Si es proforma, el título (l.432) pasa a «Revisar la proforma antes de dar de alta el género». La descripción debe decir que no cuenta en el IVA.
   - El botón de l.855 queda igual («Registrar y dar de alta en el stock»).
3. **Registro** (`registrar`, `PaginaCompras.tsx:354–405`): enviar `tipo_documento`. Para una proforma no se envía `tipo_iva`/`tipo_irpf` con efecto fiscal, aunque el servidor y la base deciden.
4. **Subida en Compras generales:** la IA decide la categoría. Una proforma textil subida allí llega con su categoría, y si es «textil» se revisa con `RevisarCompraTextil` (condición en l.876). No hay que tocar nada más.

## 4. Diálogo para casar una factura con su proforma

**Cuándo se abre:**

- **(a)** Al revisar una factura textil (o leída como tal) cuyo proveedor tenga proformas sin factura. En `RevisarCompraTextil`, encima de la tabla de líneas, sale una tarjeta «¿Es la factura de una de estas proformas?», con el estilo de `TarjetaQueMirar` (l.1016).
  - La sugerencia sale de una función pura en `src/dominio/proformas.ts`, por ejemplo `sugerirProforma(factura, proformas)`. Puntúa por mismo proveedor (`claveProveedor` de `src/dominio/cola-compras.ts:40`), total (±0,01), fecha posterior y coincidencia de líneas.
  - Muestra la mejor como `Button variant="outline"` con «X puntos», igual que la sugerencia de variante en `CeldaVariante` (l.979–999), y un «Elegir otra…».
- **(b)** Desde la sección de pendientes («Casar con factura»), sobre una factura ya en la cola.

**El diálogo.** `Dialog` + `DialogContent className="max-w-[min(96vw,90rem)] max-h-[92vh] overflow-y-auto"`, el tamaño de l.430.

- **Cabecera:** dos columnas con Proforma y Factura: proveedor, n.º, fecha, base, IVA y total, con `eur()` y `fechaCorta()` de `src/lib/format.ts`.
- **Tabla línea a línea** (`Table movil="tarjetas"`): Descripción/referencia, Cant. proforma, Cant. factura, Importe proforma, Importe factura, Diferencia.
  - El emparejado lo hace una función pura en `src/dominio/`, por ejemplo `compararLineas(proforma.lineas, factura.lineas)`, que empareja por referencia/EAN/talla/color y si no por orden.
  - La celda de diferencia lleva un badge: «Igual» `bg-emerald-600 hover:bg-emerald-600`, «Distinta» `variant="outline" border-amber-500 text-amber-700`, «Solo en proforma» / «Solo en factura» `variant="destructive"`. Son los mismos badges de `CeldaVariante` (l.920–1009).
- **Pie** (`TableFooter`): «Total · N líneas» con las dos sumas y la diferencia (`font-bold tabular-nums`), como `RevisarCompraTextil.tsx:698–708`.
- **Si no cuadra:** tarjeta ámbar «Los números no cuadran» (l.452–470). La regla para bloquear o pedir confirmación la tiene que decidir Javier.
  - **Riesgo:** si la factura trae más unidades que la proforma, la diferencia no entra en stock porque la factura casada no crea stock. Hace falta un ajuste de inventario o una regla explícita. No conviene resolverlo en silencio.
- **Pago:** una línea informativa «El pago de la proforma (fecha, importe) pasa a esta factura», con `StatusBadge estado="pagada"`.
- **Pie del diálogo** (`DialogFooter`): con la factura casada, el botón deja de ser «Registrar y dar de alta en el stock» (l.855) y pasa a «Registrar la factura (sin mover stock)», con icono `FileText` en lugar de `PackageCheck`.
  - En ese modo hay que saltar el casado de variantes y el reparto. Si no, las comprobaciones de l.392–410 (líneas sin casar o reparto con errores) bloquean una factura que no va a mover stock.
  - **Riesgo:** al servidor (`guardarYRegistrarCompra`) no deben llegar `lineas` con `stock_id`, o generará movimientos `compra` duplicados. La protección de verdad tiene que estar en SQL. La pantalla solo deja de enviarlas, junto con un `proforma_id`.
- **Al terminar:** el `onSuccess` (l.420–432) ya invalida `["compras"]`, `["textil-stock"]` y `["gerencia-compras"]`. Hay que añadir la clave de la consulta de Gerencia de proformas si se crea.

## 5. Riesgos en código que ya existe

- **Duplicados** (`src/dominio/cola-compras.ts:83`, `duplicadosDe`):
  - Si la proforma y la factura tienen el mismo número, sale el nivel `"factura"`, y `bloqueaRegistro` (l.130) impide registrar la factura cuando la proforma está `registrada`. Si coinciden fecha e importe, sale `"probable"` y pide confirmación.
  - Hay que excluir los pares proforma↔factura del mismo proveedor, o devolverlos como «proforma candidata» en vez de duplicado. Esto afecta a `TarjetaQueMirar`, a `pendientes` (`RevisarCompraTextil.tsx:393–395`) y a `RevisarCompra` (`PaginaCompras.tsx:~950`).
- **Gerencia › Textil, «Compras textil frente a sus entradas»** (`src/components/gerencia/Textil.tsx:602–620`, `resumenControlesAlmacen` en `src/dominio/controles-almacen.ts:108–132`):
  - Si el control compara cada compra textil con sus movimientos, la proforma cuadra.
  - La factura casada no tiene movimientos y daría descuadre. Si se excluye la proforma, su stock queda sin justificante. El control tiene que tratar el par como uno solo.
- **Gerencia › Textil, «Compras del periodo, sin IVA»** (`Textil.tsx:280–294`, `ivaSoportado`) y **Fiscal** (`Fiscal.tsx:61–65`): tienen que excluir las proformas. El aviso «compras subidas sin registrar» (l.289) no debe contarlas.
- **Textil › Stock, devolución a proveedor** (`src/routes/panel/textil/stock.tsx:874–880`): el selector de compras filtra `registrada && textil`, así que mezclaría proformas y facturas casadas, y el mismo género aparecería dos veces. Hay que listar solo la que movió stock (la proforma) y añadir «· facturada en n.º X».
- **`listCompras`** (`src/lib/compras.functions.ts:427–465`): usa `select("*, lineas:…")` y las columnas nuevas llegan solas. Pero sigue el patrón «¿existe la columna?» (`faltaLaColumna`, l.431–438). La pantalla tiene que ocultar todo lo de proformas sin la migración, con un banner ámbar como `AVISO_MIGRACION_ESCANER` (`PaginaCompras.tsx:547–553`).

## 6. Componentes y estilos que se reutilizan (no hay que crear ninguno nuevo de `ui/`)

- **De `ui/`:** `card`, `table` (con `movil="tarjetas"` y `TableFooter`), `badge`, `dialog`, `button`, `select`, `toggle-group`, `popover`, `tooltip`.
- **Propios:**
  - `StatusBadge` (`src/components/StatusBadge.tsx`: `pagada` / `pendiente` / `borrador`).
  - `EstadoVacio`, `ConfirmarBorrado`, `Explicacion` (la ⓘ, con su definición nueva en `DEFINICIONES`).
  - `VerDetalle` (`gerencia/comun.tsx:10`).
  - `BarraFiltros` / `SelectFiltro` / `QuitarFiltros` (`src/components/filtros/Filtros.tsx`).
  - `Campo` y `FicheroRevision` (`RevisarCompraTextil.tsx`).
- **Patrones de estilo que se usan:**
  - Aviso: `Card className="border-amber-500/50"` con `AlertTriangle h-4 w-4 text-amber-600`. Si es grave: `border-destructive/60` y `text-destructive`.
  - Sumas: `font-bold tabular-nums text-right`.
  - Rótulo del pie: «Total · N cosa(s) · sin M …».
  - Subtexto: `block text-xs text-muted-foreground`.
  - Colores de estado: `text-status-pendiente` / `text-status-completado` / `text-status-cancelado`.
  - Formatos: `eur`, `fechaCorta` y `eurUnitario` de `src/lib/format.ts`.
- **Toda la lógica fuera de los componentes,** en un `src/dominio/proformas.ts` nuevo con pruebas:
  - proformas sin factura y su antigüedad;
  - sugerencia de casado;
  - comparación de líneas;
  - totales sin proformas.