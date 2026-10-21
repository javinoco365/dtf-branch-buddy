# 01 · Revisión contable y fiscal del CRM

**Para:** Javier (DTI S.L. / RONOCA DESARROLLOS S.L.)
**Fecha:** 20-10-2026
**Punto de vista:** contable fiscal senior (IVA, IRPF, Sociedades, Verifactu 2027)
**Pregunta:** ¿cuadran todos los números y la información es correcta?

Va acompañado de `consultas-cuadre.sql` (en esta misma carpeta): un paquete de consultas de
solo lectura para ejecutar en producción. Cada hallazgo dice qué consulta lo comprueba.

---

## 0. Respuesta corta

**La parte de mecánica está bien hecha.** La numeración no deja huecos, lo emitido no se puede
tocar, las rectificativas restan, los canjes de ticket por factura cuentan una sola vez y el
almacén lleva un libro inmutable con media ponderada. El banco SQL (`probar-migraciones.sh`)
termina en «TODO EN VERDE» y las 132 pruebas de dominio fiscal pasan.

**Lo que no cuadra son los criterios, no las sumas.** Hay tres problemas que yo no firmaría:

1. **El CRM ya expide facturas de verdad, aunque la decisión diga que no.** Los tickets y las
   facturas llevan «FACTURA SIMPLIFICADA», el NIF, numeración legal y se mandan por correo al
   cliente. Si la gestoría emite además su propia factura por la misma venta, esa operación
   tiene dos facturas. Y desde el 1-1-2027, si el CRM expide, es un sistema de facturación
   sujeto a Verifactu. Faltan 72 días.
2. **Los documentos llevan la fecha del pedido como fecha de expedición.** Un ticket emitido
   en noviembre por un pedido de septiembre dice que se expidió en septiembre. Eso es antedatar
   la factura, y además cambia un trimestre cuyo 303 ya se ha presentado.
3. **El ticket que sale de un pedido de WooCommerce no siempre coincide con lo que pagó el
   cliente.** Las líneas se guardan antes del cupón y siempre al 21 %. Con un cupón, o con un
   pedido sin IVA, el documento repercute más IVA del que se cobró.

Después hay una serie de cifras que **no salen iguales en todas las pantallas**: dos 303
distintos (Fiscal frente a Resultados), tres «beneficios» y cuatro «facturaciones». Cada una
tiene su lógica, pero se llaman igual y no cuadran entre sí.

| Gravedad | Hallazgos |
| -------- | --------- |
| Crítica  | 3 (H1–H3) |
| Alta     | 6 (H4–H9) |
| Media    | 9 (H10–H18) |
| Baja     | 6 (H19–H24) |

---

## 1. Alcance y límites, con honestidad

- **No he visto datos reales de producción.** He trabajado con el código, las migraciones, el
  banco SQL local (PostgreSQL 16 con datos sintéticos que dejan las pruebas), las pruebas de
  dominio y las capturas que mandaste. Los ejemplos numéricos son o bien cálculos con las
  funciones reales del CRM (ejecutadas con `vite-node` sobre `src/dominio/`), o bien cifras de
  tus capturas. **No puedo decir cuánto dinero mueve cada hallazgo en tu empresa**: eso lo dice
  `consultas-cuadre.sql` cuando lo ejecutes.
- Entre las capturas no he encontrado ningún informe anual en PDF: las nueve imágenes son
  pantallas del CRM, de WooCommerce, un ticket y un error de carga. Si ese informe existe,
  mándamelo y cruzo sus cifras.
- No he revisado la contabilidad de la gestoría ni los modelos presentados. Donde digo «el 303
  del CRM» me refiero a la estimación que enseña Gerencia, no al modelo presentado.
- Las referencias legales son las que aplicaría un asesor. Las que dependen de hechos que no
  conozco (fecha de constitución, cifra de negocios, si vendes a Canarias o a la UE) van
  marcadas como «a confirmar».

---

## 2. Lo que está bien (y conviene no tocar)

- **Numeración correlativa sin huecos y bajo bloqueo**: `emitir_factura()` bloquea la fila de
  `series_facturacion` (`20261004100100_tickets.sql:350-363`). Una serie por empresa y tipo
  (F, R, T) y ejercicio, compartida entre tiendas y textil. `facturas_huecos_en_serie()` lo
  comprueba y Gerencia › Fiscal lo enseña.
- **Inmutabilidad real** de lo emitido, con la única puerta de `factura_borrar_ultima()`.
- **Rectificativas como documentos nuevos** en su propia serie, en negativo, con motivo R1–R5
  (R5 para tickets: `routes/panel/tiendas/$tiendaId/facturas.tsx:240`).
- **Canje de ticket por factura** sin doble IVA: cada paso en su fecha (`canjes.ts`), y la
  base exige el mismo total y el NIF.
- **Límite del ticket comprobado en la base**, con el tipo fiscal congelado en el receptor.
- **Compensación del 303** con caducidad de cuatro años (art. 99.Cinco LIVA) y sin compensar
  lo anterior a la primera venta documentada: bien pensado.
- **Plazos** del 303 (día 20; 30 de enero el 4T), 111 y 115 (20 de enero el 4T) y 202 (abril,
  octubre y diciembre): correctos.
- **Facturas recibidas**: la cuota la calcula la base en columnas generadas, las proformas no
  cuentan en el IVA, el borrado es lógico y hay detección de duplicados.
- **Almacén**: libro de movimientos inmutable, media ponderada bajo `FOR UPDATE`, toda salida
  al coste medio vigente, `coste_unit_snapshot` congelado en la línea.
- **Coste por metro congelado en el pedido** (`coste_metro_snapshot`): el margen de un mes no
  cambia cuando cambias el coste de hoy.

---

## 3. Hallazgos

Formato de cada uno: qué pasa · dónde (fichero:línea) · ejemplo con números · impacto fiscal
· arreglo · consulta que lo comprueba.

### CRÍTICOS

#### H1 · El CRM expide facturas reales, pero la decisión dice que no es el sistema de facturación

- **Qué pasa.** La decisión del 9-10-2026 (CLAUDE.md) dice que las facturas que se declaran
  las hace la gestoría. Pero el CRM numera en serie legal (T2026/0003), imprime «FACTURA
  SIMPLIFICADA» con razón social y NIF de RONOCA (captura del ticket), desglosa el IVA y
  **lo manda por correo al cliente** (`src/lib/facturas.functions.ts:311`,
  `enviarDocumentoPorCorreo`). Un documento así, entregado al cliente, es una factura a todos
  los efectos (RD 1619/2012, arts. 2, 6 y 7).
- **Ejemplo.** El pedido DCUL-64-2026 (22,10 €) recibe el ticket T2026/00xx del CRM. Si la
  gestoría emite a fin de mes su factura simplificada por esa misma venta con su numeración,
  la operación tiene dos facturas con dos números distintos. La AEAT ve dos documentos por una
  sola operación; el cliente tiene uno, la contabilidad otro.
- **Impacto.** Duplicidad de facturas por una operación (infracción del art. 201 LGT por
  incumplir obligaciones de facturación; 1 % del importe de las operaciones afectadas). Desde el
  **1-1-2027** (fecha de CLAUDE.md para sujetos pasivos del IS; confírmala con la gestoría), un
  programa que expide facturas tiene que cumplir el Reglamento de sistemas de facturación
  (RD 1007/2023): integridad, inalterabilidad, registros de alta y anulación, y nada de borrar
  facturas. Eso choca de frente con H2 y H3.
- **Arreglo (decisión, no código).** Antes de diciembre, una de dos:
  - **(a) El CRM no factura.** Sus documentos pasan a ser internos: otro título («Resumen de
    pedido», «Nota de entrega»), sin serie fiscal, sin desglose de IVA como factura, y **no se
    mandan al cliente como factura**. La gestoría expide todas.
  - **(b) El CRM factura.** Integrar el proveedor certificado (lo que ya prevé CLAUDE.md), la
    gestoría **contabiliza** las del CRM sin volver a emitirlas, y se retiran H2 y H3.
  - Mientras no se decida, que la gestoría no emita factura por ventas que ya tienen ticket del
    CRM.
- **Consulta.** Ninguna lo puede ver en la base: hay que preguntarlo a la gestoría. A7 dice
  cuántos documentos se han emitido tarde.

#### H2 · La fecha de expedición es la del pedido, no la del día en que se emite

- **Qué pasa.** Desde `20261021100000_fecha_del_pedido.sql:37` la comprobación de orden de
  fechas está vacía, y la aplicación emite siempre con la fecha del pedido
  (`src/lib/facturas.functions.ts:425-440`; el canje también, `:1381`). La factura no tiene
  otro campo de fecha: la fecha del pedido se imprime como fecha de expedición.
- **Ejemplos.**
  1. Pedido del 15-09-2026 (3T), ticket emitido el 10-11-2026 (4T): el ticket dice 15-09 y
     lleva un número posterior al de tickets de octubre. La consulta A6 cuenta estos cruces;
     en el banco sintético salen 5 en dos series.
  2. Ese ticket de 100 € de base suma 21 € al **3T** del CRM **después** de que la gestoría
     presentara el 303 del 3T (20-10). Gerencia › Resultados enseña un 3T distinto al
     presentado y nadie lo avisa.
  3. Anulación y reemisión: la rectificativa sale con la fecha de hoy
     (`20260903100000_empresa_y_serie_unicas.sql:562`, 4T: −21 €), pero el ticket nuevo del
     mismo pedido vuelve a salir con la fecha vieja (3T: +21 €). El neto es 0, pero el 3T ya
     presentado cambia y el 4T baja.
- **Impacto.** El art. 6.1.c del RD 1619/2012 exige la **fecha de expedición**; la de la
  operación, si es distinta, va aparte (art. 6.1.l). Poner la del pedido es antedatar. Expedir
  tarde también tiene plazo (art. 11: en el momento, o antes del día 16 del mes siguiente si el
  cliente es empresario). Con Verifactu, la fecha de expedición la fija el registro: no se
  puede elegir.
- **Arreglo.** Fecha de expedición = el día que se emite, siempre. Añadir «fecha de la
  operación» (la del pedido) como campo aparte, impreso en el PDF cuando difiera. El IVA se
  sigue imputando por la fecha de devengo (la operación), pero Gerencia debe marcar los
  documentos que caen en un trimestre ya vencido y listarlos para la gestoría (complementaria o
  regularización). Es una migración: no la escribo aquí porque esta revisión es de solo lectura.
- **Consultas.** A6 (número y fecha fuera de orden), A7 (expedidos tarde y tras el plazo del
  303).

#### H3 · Borrar la última factura no sabe si ya la vio alguien

- **Qué pasa.** `factura_borrar_ultima()` (`20261019100000_borrar_ultima_factura.sql:170-262`)
  comprueba que es la última, que no la rectifica ni la sustituye nada y que no está conciliada.
  **No comprueba si el PDF se mandó al cliente** (no se registra el envío:
  `facturas.functions.ts:311` no escribe nada) **ni si salió en un ZIP para la gestoría**
  (Archivo no registra descargas). El número se reutiliza para otro documento.
- **Ejemplo.** Se emite T2026/0120 (121 €) a las 10:00, se manda al cliente, se descarga el
  ZIP del mes para la gestoría. A las 12:00 se borra porque había un error y el siguiente
  ticket, de otro cliente y 48,40 €, se llama también T2026/0120. Existen dos T2026/0120
  distintos fuera del CRM.
- **Impacto.** Numeración con duplicados para terceros aunque la tabla no tenga huecos. Con
  Verifactu, prohibido.
- **Arreglo.** Registrar cada envío por correo y cada descarga de Archivo, y negar el borrado
  si el documento salió del CRM; o limitarlo al mismo día de emisión. Retirar la excepción el
  1-1-2027, como ya dice CLAUDE.md.
- **Consulta.** No hay rastro que consultar: es justo lo que falta. La auditoría (`auditoria`)
  sí guarda los borrados: pídele a la gestoría que coteje los números borrados con lo que
  recibió.

### ALTOS

#### H4 · Cupones y recargos de WooCommerce: el ticket no suma lo que pagó el cliente

- **Qué pasa.** Las líneas del pedido web se guardan con `li.subtotal`, que en WooCommerce es
  el importe **antes del cupón** (`src/lib/woocommerce.functions.ts:699`). La cabecera del
  pedido sí va después del descuento: `subtotal = total − total_tax`
  (`src/dominio/pedido-woo.ts:114`). El ticket se hace con las líneas
  (`factura-desde-pedido.ts`), así que sale por más. Los recargos (`fee_lines`) no se
  importan, así que en ese caso sale por menos.
- **Ejemplo (calculado con las funciones del CRM).** Línea de 100 € con cupón del 10 %:
  pedido 90,00 + 18,90 = **108,90 €**; ticket generado: 100,00 + 21,00 = **121,00 €**.
  2,10 € de IVA de más y un documento por 12,10 € más de lo cobrado.
- **Impacto.** IVA repercutido de más en el 303 que enseña el CRM; documento que no coincide
  con el cobro (la conciliación no casa) y factura al cliente por un importe que no pagó.
- **Arreglo.** Usar `li.total` y `li.total_tax` (después del descuento), importar
  `fee_lines` como líneas, y negarse a emitir si líneas + envío ≠ base del pedido (±0,01).
- **Consultas.** D2 (pedidos cuyas líneas no suman su base: el ticket saldrá mal), D1
  (documentos que ya salieron distintos del pedido).

#### H5 · IVA del 21 % fijo: pedidos sin IVA se documentan con IVA

- **Qué pasa.** Toda línea de WooCommerce se guarda al 21 % (`woocommerce.functions.ts:711`)
  y el envío también (`factura-desde-pedido.ts:38, 151, 160`). Si WooCommerce no cobró IVA
  (Canarias, Ceuta, cliente de la UE con NIF-IVA, exportación), el ticket repercute un 21 %
  que el cliente no pagó.
- **Ejemplo.** Pedido de 100 € sin IVA → ticket de 121 €.
  **Tu captura de Facturación (octubre, DTF Culture, 8-10-2026)**: base 709,26 €, IVA
  143,74 € = **20,27 %**. Al 21 % serían 148,94 €: faltan 5,20 € de IVA, lo que equivale a
  unos **24,76 € de base vendidos sin IVA** (o a cupones). No lo puedo confirmar sin datos;
  D3 lo dice.
- **Impacto.** IVA repercutido de más en esos documentos; y si la venta era exenta, la
  factura necesita la causa de exención (art. 6.1.j RD 1619/2012) y, si es intracomunitaria,
  el NIF-IVA del cliente y el modelo 349.
- **Arreglo.** Tomar el tipo de cada línea de lo que manda WooCommerce (`taxes` o
  `subtotal_tax / subtotal`); si es 0 %, pedir la causa y el NIF-IVA antes de emitir.
- **Consultas.** D3 (pedidos cuyo IVA no es el 21 % de su base), B2 (tipos de IVA en lo
  emitido).

#### H6 · El 303 del CRM solo ve lo documentado; el IVA se devenga igual sin ticket

- **Qué pasa.** Gerencia separa A (con documento) y B (sin documento). El IVA y Sociedades
  salen solo de A (`src/dominio/grupos.ts:249`, `conIs` solo en A; `fiscal.ts`, solo
  documentos). Pero el IVA se devenga con la entrega o el cobro anticipado (art. 75 LIVA), haya
  documento o no.
- **Ejemplo.** Cierras el 3T con 10 pedidos web de 121 € sin ticket: la venta está cobrada y
  el IVA devengado son 210 €. El 303 que enseña el CRM no los cuenta, y Sociedades se estima
  sin sus 1.000 € de base.
- **Impacto.** El 303 y el IS estimados salen por debajo de lo que se debe cuando B no es 0.
  Además, una columna «B · Sin documento» con ventas y gastos sin justificante que no entran
  en impuestos es, leída por un tercero (un inspector, un comprador de la empresa, un banco),
  una contabilidad paralela. La intención (lo pendiente de documentar) es legítima; el
  nombre y el cálculo no lo transmiten.
- **Arreglo.** (1) Calcular el IVA y el IS estimados sobre el **total del negocio**, y enseñar
  aparte «de esto, X € de IVA está sin documentar». (2) Renombrar B como «Pendiente de
  documentar» y avisar en rojo si, al pasar el día 20 del mes siguiente al trimestre, sigue
  habiendo pedidos sin documento. (3) Los gastos sin justificante se pueden seguir enseñando
  como coste interno: está bien que no rebajen impuestos.
- **Consulta.** B6 (pedidos sin documento por trimestre, con su IVA).

#### H7 · Devoluciones y cancelaciones no generan rectificativa

- **Qué pasa.** Ventas y Cobrado restan los reembolsos de WooCommerce (`kpis.ts`
  `parteVendida`; `cobro_web_al_dia()` en `20261007100000_cifras_fiables.sql`). El documento
  emitido no cambia y no hay rectificativa parcial: `anular_factura()` solo anula entera. Un
  pedido cancelado sale de Ventas, pero su ticket sigue vigente en Fiscal.
- **Ejemplo.** Ticket de 121 € (100 + 21) con un reembolso de 36,30 €: Gerencia vende 84,70 €
  (base 70), pero Fiscal sigue repercutiendo **21,00 €** en vez de 14,70 €: **6,30 € de IVA de
  más** y una diferencia entre Gerencia y Fiscal que nadie explica. Pedido cancelado con
  ticket: Gerencia 0 €, Fiscal 21 €.
- **Impacto.** IVA ingresado de más, que solo se recupera con la rectificativa (art. 80.Dos
  LIVA y art. 15 RD 1619/2012). Y la diferencia entre pantallas.
- **Arreglo.** Rectificativa parcial por importe (R1, o R5 si es un ticket) a partir de
  `pedido_devoluciones`; aviso en Pedidos cuando un pedido cancelado o con reembolso tiene
  documento vigente.
- **Consultas.** D4 (cancelados con documento), D5 (con devoluciones y sin rectificativa, con
  el IVA de más).

#### H8 · Resultados deduce IVA de gastos fijos sin factura, y lo duplica si la factura no se enlaza

- **Qué pasa.** En Gerencia › Resultados, cada cargo de un gasto fijo «con justificante» suma
  su IVA estimado (importe × % de Ajustes) al soportado del trimestre, tenga factura o no
  (`src/dominio/impuestos.ts:141`, `:623`). Si la factura del proveedor se registra y **no** se
  enlaza al gasto, cuenta dos veces: como compra y como cargo. Y la retención de una compra va
  siempre al 111 (`impuestos.ts:625`), aunque sea la del alquiler.
- **Ejemplo (calculado con `impuestosPorTrimestre`).** Alquiler de 800 €/mes (IVA 21 %,
  retención 19 %) y la factura de julio registrada sin enlazar:
  - IVA soportado del 3T: **672 €** en lugar de 504 € (168 € de más).
  - 111: **152 €** (que es la retención del alquiler); 115: 456 €. Retenciones totales 608 €
    en vez de 456 €.
  - Con la factura enlazada, sale bien: 504 € de IVA, 0 € al 111 y 456 € al 115.
- **Impacto.** 303 estimado más bajo de lo real (IVA soportado sin factura no se deduce,
  art. 97 LIVA) y 111 inflado.
- **Arreglo.** En el 303, solo IVA de facturas registradas; los cargos sin factura, como
  «previsión» aparte. La retención de una compra según su categoría (y una categoría
  «alquiler» en compras, que vaya al 115). Avisar de las compras que parecen el recibo de un
  gasto fijo y no están enlazadas.
- **Consultas.** B4 (IVA de gastos sin factura), B5 (compras que parecen de un gasto y no
  están enlazadas), C1 (retenciones de compras que parecen de alquiler), I1.

#### H9 · Dos 303 distintos para el mismo trimestre: Fiscal frente a Resultados

- **Qué pasa.** Gerencia › Fiscal calcula «repercutido − soportado» solo con facturas de
  compra (`src/components/gerencia/Fiscal.tsx:78`). Gerencia › Resultados suma además el IVA
  de los gastos fijos (H8) y compensa trimestres anteriores. Además Fiscal admite cualquier
  periodo (un mes, una semana) y Resultados siempre trimestres enteros.
- **Ejemplo.** 3T con 2.100 € de IVA repercutido y el alquiler de H8 dado de alta solo como
  gasto fijo, sin registrar sus facturas: Fiscal dice **2.100 €** a ingresar; Resultados dice
  **1.596 €** (2.100 − 504 de IVA estimado del alquiler). Si las tres facturas se registran y
  se enlazan, los dos dan 1.596 €. El resultado depende de cómo se haya dado de alta cada
  gasto.
- **Impacto.** Ninguna de las dos es «el 303»; es fácil leer la equivocada.
- **Arreglo.** Una sola función `ivaDelTrimestre` que usen las dos pantallas, y en Fiscal
  separar «IVA de facturas registradas» de «previsión de gastos».
- **Consultas.** B1 (repercutido por trimestre), B3 (soportado de facturas), B4 (de gastos).
  B1 − B3 tiene que ser el resultado de Fiscal; B1 − B3 − B4, el de Resultados (sin
  compensar).

### MEDIOS

#### H10 · Envíos: ni son «no venta» ni cuestan lo que se cobra

- **Qué pasa.** La «Facturación bruta» quita el envío cobrado (`kpis.ts:154`) porque «no es
  venta de la empresa». Fiscal y contablemente sí lo es: los portes forman parte de la base
  imponible (art. 78.Dos.2.º LIVA) y de la cifra de negocios. En el coste, Gerencia supone que
  la agencia cobra exactamente lo mismo que el cliente pagó (`kpis.ts:198`,
  `gerencia.ts:196`), aunque existe `coste_envio_real` y el Resumen diario sí lo usa
  (`resumen-diario.ts:230`). Las facturas de mensajería se excluyen del resultado
  (`compras.ts:45`, trato «comparar»).
- **Ejemplo.** Pedido con 5,99 € de envío cobrado y 4,20 € de agencia: Resultados da 70,00 €
  de BAI; el Resumen diario y el informe de socios, 71,79 €. Con envío gratis y 5 € de agencia:
  Resultados no ve los 5 €.
- **Impacto.** El BAI y el IS estimados no recogen lo que de verdad cuesta enviar.
- **Arreglo.** En Resultados, coste de envío = facturas de mensajería registradas (o
  `coste_envio_real`, y el coste por defecto donde falte). Llamar a la cifra sin envío
  «Ventas de impresión», no «Facturación bruta».

#### H11 · El coste de producción es estimado y las compras reales de consumibles no entran nunca

- **Qué pasa.** La tinta, el film y el polvo cuestan «metros × coste por metro»; sus facturas
  de compra solo se comparan (`compras.ts:44`).
- **Ejemplo.** 400 m × 2,50 € = 1.000 € estimados; facturas de consumibles del trimestre,
  1.350 €. El BAI sale 350 € mejor y el IS estimado (al 15 %) 52,50 € más bajo.
- **Impacto.** El resultado de Gerencia no es el contable. La gestoría hará compras (600) ±
  variación de existencias; la diferencia aparece en el Sociedades de verdad.
- **Arreglo.** Al cerrar trimestre y año, una línea «Regularización de consumibles» = compras
  reales − coste estimado (la comparación ya existe en la pestaña; falta llevarla al BAI).

#### H12 · Tres «beneficios» y cuatro «facturaciones» para el mismo periodo

- **Qué pasa.**
  - Gerencia › Resumen: margen (sin envíos) − gastos (`Resumen.tsx:303`). Sin mermas.
  - Gerencia › Resultados: ingresos con envío − producción − envío cobrado − ropa − fijos −
    compras − amortización − **mermas** (`grupos.ts:246-248`).
  - Resumen diario e informe de socios: margen **con envíos reales** − gastos
    (`resumen-diario.ts:555`). Sin mermas.
  - «Facturación»: Dashboard y Facturación de tienda (pedidos, sin envío), Facturación
    Consolidada (cobros), «Facturado» del informe de socios (documentos, con envío,
    `pdf-informe-socios.ts:431`), Fiscal (documentos).
  - El «margen neto» del informe de socios dice «% de lo facturado sin IVA», pero divide entre
    la bruta de pedidos (`resumen-diario.ts:641`), no entre el «Facturado» que enseña la tarjeta
    de al lado.
- **Ejemplo.** El pedido de H10 (100 € de impresión, 5,99 € de envío, 4,20 € de agencia, 30 €
  de producción) y una merma de 12 € en el periodo: Resumen 70,00 €; Resultados 58,00 €;
  informe de socios 71,79 €.
- **Impacto.** No es fiscal, pero hace imposible cuadrar el CRM con la gestoría o explicarlo a
  un socio.
- **Arreglo.** Una definición por cifra en `src/dominio/definiciones.ts`, un solo cálculo y
  nombres distintos para cosas distintas («Vendido», «Documentado», «Cobrado»). El informe de
  socios y Resultados deberían dar el mismo beneficio antes de impuestos.
- **Consulta.** J1 (las tres facturaciones de cada mes en una fila).

#### H13 · El ticket nace «pagada» aunque el pedido no esté cobrado

- **Qué pasa.** `emitir_factura()` crea el ticket en estado «pagada»
  (`20261004100100_tickets.sql:401`; textil, `:625`).
- **Ejemplo.** Ticket de 60,50 € de un pedido sin ningún cobro: la lista de facturas lo da por
  cobrado. En el banco sintético sale uno (E3).
- **Impacto.** Ninguno en el IVA (se devenga igual). Sí en tesorería y en el «pendiente de
  cobro» que se mire desde facturas.
- **Arreglo.** Estado de cobro del ticket sacado de los cobros del pedido, no fijado al
  emitir.
- **Consulta.** E3.

#### H14 · La diferencia de precio de las prendas ya vendidas no llega al coste de ventas

- **Qué pasa.** Cuando la factura del proveedor cuesta distinto que su proforma, el ajuste se
  reparte solo entre las existencias que quedan
  (`20261029100100_proformas_compras.sql:388`); lo de las ya vendidas queda como
  `diferencia_sin_aplicar` (`:1368`) y no entra en «Coste de la ropa» ni en Resultados.
- **Ejemplo (de la propia prueba, `controles-almacen.test.ts:162`).** Proforma 10 uds a 5 €;
  factura 12 uds a 6 €, con 8 ya vendidas: se ajustan 2 €, **8 € quedan sin aplicar** y el
  coste de ventas se queda 8 € corto.
- **Impacto.** Margen textil y BAI ligeramente sobrevalorados; existencias bien.
- **Arreglo.** Llevar la diferencia sin aplicar al coste de ventas del periodo de la factura,
  como línea propia en Resultados.
- **Consulta.** G6.

#### H15 · Límite de 3.000 € para el ticket a «particular»

- **Qué pasa.** El límite de 3.000 € se aplica si el cliente está marcado como particular
  (`20261004100100_tickets.sql:57` y `ticket_receptor()`).
- **Impacto.** El art. 4.1.b RD 1619/2012 no va por tipo de cliente sino por **tipo de
  actividad** (venta al por menor, hostelería, revelado de fotografías, etc.). Que la
  impresión DTF por encargo entre en «venta al por menor» es discutible. Si no entra, todo
  ticket de más de 400 € es una factura simplificada mal expedida. **A confirmar con la
  gestoría.**
- **Arreglo.** Hasta que la gestoría lo confirme, 400 € para todos (es un ajuste de la
  empresa, sin migración).
- **Consulta.** A8 (lista los tickets de más de 400 €, si los hay, con su tipo fiscal).

#### H16 · «Retirada» de socio mezcla devolución y reparto de beneficios

- **Qué pasa.** En Inversión, «recuperado» es «lo que ha sacado, sea devolución o reparto»
  (`src/dominio/inversion.ts:10`).
- **Impacto.** Un reparto es un dividendo: acuerdo de junta, retención del 19 % y modelo 123.
  Devolver un préstamo de socio no lleva retención; devolver una aportación (cuenta 118) es
  otra cosa. Y si el socio cobra por trabajar o administrar, eso es nómina o retribución de
  administrador, con su retención en el 111.
- **Arreglo.** Tipos distintos (aportación, préstamo, devolución de préstamo, dividendo,
  retribución) y aviso de retención en los que la llevan.
- **Consulta.** I4.

#### H17 · Ventas en efectivo apuntadas solo en Caja

- **Qué pasa.** Un ingreso de Caja que no viene de un cobro de pedido no está en Ventas, ni en
  Cobrado, ni tiene documento (ya anotado en `pendiente_auditoria.md`).
- **Impacto.** Si son ventas, su IVA y su base no están en ningún cálculo.
- **Arreglo.** Caja solo admite ingresos de venta a través de un cobro de pedido; los demás
  ingresos, con concepto obligatorio (aportación, traspaso).
- **Consulta.** E5.

#### H18 · Banco: las liquidaciones de la pasarela no casan con nada

- **Qué pasa.** El cobro web es el total del pedido el día del pedido; al banco llega una
  liquidación agrupada y neta de comisión. No hay donde apuntar la comisión (gasto financiero)
  ni se concilian cobros, solo facturas (ya anotado).
- **Impacto.** El gasto de comisiones no está en Resultados y el banco queda con abonos sin
  conciliar.
- **Arreglo.** Conciliar contra cobros y aceptar «liquidación de pasarela = suma de cobros web
  − comisión», con la comisión como gasto.
- **Consultas.** F2 (lo que queda sin conciliar por mes), F4.

### BAJOS

#### H19 · Tipo de Sociedades por defecto del 15 %

- `src/dominio/gerencia.ts:571`. El 15 % de nueva creación vale para el primer periodo con
  base positiva y el siguiente (art. 29.1 LIS). Para 2026, con cifra de negocios menor de 1 M€,
  el tipo es del 19 % los primeros 50.000 € y 21 % el resto (DT 44.ª LIS, Ley 7/2024); para
  empresa de reducida dimensión que no sea micro, más alto. **A confirmar** según la fecha de
  constitución de RONOCA y sus cifras. Además el IS se calcula sobre el BAI de cada periodo,
  no del año. Es un ajuste: la consulta J2 enseña el que tienes puesto.

#### H20 · Pago fraccionado (202)

- `impuestos.ts:264`. La base es el 18 % de la cuota íntegra **menos** deducciones,
  bonificaciones, retenciones e ingresos a cuenta (art. 40.2 LIS). Y el de abril se calcula con
  el 200 del año n−2 (el de n−1 aún no se ha presentado). Un solo campo no sirve para los tres.

#### H21 · Cobros web fechados al día siguiente

- `20261007100000_cifras_fiables.sql:73` pasa a hora de Madrid una hora que la web ya guardó
  en hora de Madrid. Un pedido de las 23:15 del 31 de octubre cobra el 1 de noviembre: el
  «Cobrado» cambia de mes. Ya está documentado en el código; conviene corregirlo en la base.
  Consulta E4.

#### H22 · Factura manual con fecha libre

- `src/lib/facturas.functions.ts:440`. Una factura sin pedido lleva la fecha que se escriba.
  Mismo problema que H2.

#### H23 · `anular_factura()` en SQL no impide anular un ticket canjeado

- Lo impide la aplicación (`facturas.functions.ts:1171`), no la base. Una llamada directa
  rectificaría el ticket y la factura del canje. Hoy solo el servicio puede llamarla.

#### H24 · Cosas que la gestoría echará en falta

- Sin 347 (operaciones con terceros de más de 3.005,06 €), 349 (si hay intracomunitarias),
  390 (resumen anual del IVA), ni libro de bienes de inversión con regularización (art. 107
  LIVA para bienes de más de 3.005,06 €). La amortización de Gerencia (12 % y 25 %,
  `compras.ts:46-47`) empieza el día de la factura, no el de puesta en funcionamiento, y no
  contempla la libertad de amortización de la empresa de reducida dimensión. Es el «paquete
  trimestral para la gestoría» de la lista de mejoras.

---

## 4. Lo que hay que ejecutar en producción y qué esperar

`consultas-cuadre.sql` va en una transacción `READ ONLY` que termina en `ROLLBACK`. Lo he
ejecutado entero contra el banco local y no da ningún error. Orden recomendado:

| Bloque | Qué comprueba | Esperado | Hallazgo |
| ------ | ------------- | -------- | -------- |
| A1–A4 | Huecos, duplicados, contador, coherencia de cada documento | 0 filas | — |
| A5 | Líneas y desglose frente a la cabecera | 0 filas | — |
| A6–A7 | Número/fecha fuera de orden, expedición tardía y tras el 303 | Hoy algunas; 0 desde 2027 | H2 |
| A8–A11 | Tickets sobre el límite, facturas sin NIF, rectificativas y canjes raros | 0 filas | H15 |
| B1–B3 | IVA repercutido y soportado por trimestre | = Resultados / Fiscal | H9 |
| B4–B5 | IVA estimado de gastos y compras sin enlazar | 0 | H8 |
| B6 | Pedidos sin documento y su IVA | 0 al cierre | H6 |
| C1 | Retenciones de compras | ninguna de alquiler en el 111 | H8 |
| D1–D5 | Pedido frente a documento, cupones, IVA ≠ 21 %, cancelados, devoluciones | 0 filas | H4, H5, H7 |
| E1–E5 | Vendido frente a cobrado, sobrecobros, tickets «pagada», cobros web, Caja | ver cada una | H13, H17, H21 |
| F1–F4 | Saldos, sin conciliar, repartos de más, pagadas sin banco | 0 / poco | H18 |
| G1–G6 | Sin registrar, duplicadas, sin PDF, descuadres, proformas, diferencia sin aplicar | 0 / reciente | H14 |
| H1–H4 | Stock en unidades y en valor, negativos, textil sin coste | 0 filas | — |
| I1–I4 | Gastos sin factura, sin justificante, inmovilizado, retiradas de socios | ver cada una | H8, H16 |
| J1–J2 | Las tres facturaciones por mes; ajustes de IS | cuadrar con pantallas | H12, H19 |

Si alguna consulta falla con «column … does not exist», a producción le falta una migración:
eso ya es un hallazgo por sí mismo.

---

## 5. Orden de arreglo que propongo

1. **Esta semana, sin código:** hablar con la gestoría de H1 (quién factura) y H15 (límite de
   3.000 €), y ejecutar el paquete de consultas.
2. **Antes de cerrar el 4T (30-1-2027) y de Verifactu (1-1-2027):** H2 (fecha de expedición),
   H3 (borrado de la última), H4 y H5 (tickets que coinciden con el pedido), H7
   (rectificativas parciales).
3. **Para que Gerencia sea fiable:** H6, H8 y H9 (un solo 303, con el IVA devengado), H10–H12
   (envíos, consumibles, una definición por cifra).
4. **El resto**, cuando se toque cada pantalla.

Cada arreglo es una tarea con su rama, como dice CLAUDE.md. Varios (H2, H3, H7, H13) llevan
migración: este informe no escribe ninguna.

---

## 6. Ficheros tocados

- `docs/informe-empresa/01-contable-fiscal.md` (este informe).
- `docs/informe-empresa/consultas-cuadre.sql` (consultas de solo lectura).

Nada más del repositorio ha cambiado. No se ha conectado a producción.
