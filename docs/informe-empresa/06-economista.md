# 06 · La empresa vista por un economista

**Para:** Javier y los socios de DTI S.L. (RONOCA DESARROLLOS S.L.)
**Fecha:** 20-10-2026
**Punto de vista:** economista jefe; veinte años asesorando pymes industriales de impresión y
textil B2B
**Pregunta:** ¿qué negocio se ve desde el CRM, se mide lo que hace falta para decidir, qué
riesgos tiene y qué más deberíamos hacer?

Va en la misma carpeta que `01-contable-fiscal.md` (criterios fiscales y cuadres) y
`consultas-cuadre.sql`. Aquí no repito lo fiscal: lo cito cuando cambia una decisión económica.

> **Nota de revisión (director de operaciones, 21-10-2026).** He recalculado las cifras de la
> sección 2.1 con las capturas (853 / 24 = 35,54 €; 588,95 / 85,56 = 6,88 €/m; 120,31 / 5,99 ≈ 20
> envíos; 5,99 / 12,99 = 46 %): son correctas. He corregido tres exageraciones: la capacidad de
> 70 m/h × 4 h es el **valor por defecto del código**, no un ajuste que haya visto en
> producción, así que el «5 % de ocupación» es condicional; el lector de facturas «no
> funcionaba» en las capturas, no sé si sigue igual; y WowInvoice está instalado, pero no hay
> prueba de que emita. Todo lo demás de este informe son escenarios con supuestos a la vista,
> no datos de la empresa.
>
> **Segunda revisión (21-10-2026, tarde).** Rehechas las cuentas de las secciones 6 y 8. Tres
> estaban mal: (1) en §6.2, el punto muerto más bajo de la tabla (333 m) ya supera el ritmo
> actual (~320 m), así que **ningún** escenario cubre la estructura, no «salvo fijos por debajo
> de 1.500 €»; (2) en §6.3, con 10 minutos a 20 €/h el pedido de 1 m gana 0,67 €, no pierde: pierde
> a partir de 12 minutos; (3) en §8.2, pasar de 3,6 a 5 m por pedido baja el coste de servir por
> metro un 28 %, no un 25 %. Añadida la sanción de Verifactu en §7.1 y la venta anual ajustada
> a 26.500-32.000 €. Las decisiones que salen de aquí (pedido mínimo, quién factura) están en la
> sección 2 de `00-informe-director.md`.

---

## 0. Respuesta corta

**El CRM está mejor construido que el negocio que mide.** Tiene una contabilidad de gestión
más seria que la de muchas pymes diez veces mayores: importes congelados, una definición por
cifra, margen por metro, grupos A/B, prorrateo de gastos fijos, Pareto, clientes dormidos y
capacidad de máquina. Pero lo que enseñan las capturas es un negocio **muy pequeño y recién
arrancado**: en los primeros ocho días de octubre, DTF Culture vendió **853 € con IVA en 24
pedidos y 85,56 m**. A ese ritmo son unos **300 m y unos 2.200-2.700 € de base al mes**. La
máquina, con los **valores por defecto** de jornada del código (70 m/h, de 9:00 a 13:00; no sé
si en producción están cambiados), daría para unos **5.900 m al mes**: **se usaría en torno al
5 %**.

Mis tres conclusiones, sin adornos:

1. **El problema de DTI no es medir, es vender.** Cada hora más de CRM tiene hoy menos retorno
   que una hora de captación comercial. Con la máquina al 5 %, el coste fijo se reparte entre muy
   pocos metros y **el margen por metro no paga la estructura**. El indicador que manda es uno
   que la app no tiene: **el punto muerto en metros al mes**, y lo lejos que está.
2. **El margen que enseña la app está inflado, y no sabes cuánto.** El coste por metro es un
   número escrito a mano (consumibles + embalaje + electricidad). No lleva mano de obra, ni
   merma, ni comisiones de cobro, ni amortización de la máquina. El lector de facturas de compra
   no funcionaba en las dos capturas que lo enseñan (1 y 9), así que las compras reales de tinta y film no llegan a
   contrastarlo. Y en los pedidos cuyo largo no se lee de DTFBuild, los metros se **estiman
   dividiendo el importe entre 7 €**: su «€ por metro» sale 7 por construcción, no por medida.
3. **El precio está en la franja baja y no hay suelo por pedido.** 7 € el metro sin IVA, sin
   pedido mínimo ni cargo de preparación. Un pedido de 1 m deja unos 7 € de base, de los que hay
   que pagar material, preparación, embalaje y cobro. Con 3,6 m de pedido medio, **los pedidos
   pequeños probablemente pierden dinero** y la app no lo enseña porque no mide la economía por
   tamaño de pedido.

Lo que haría en los próximos 90 días, en este orden: **(1)** saber el punto muerto y el coste
real por metro con datos tuyos (dos tardes, sin programar); **(2)** pedido mínimo o cargo fijo
por pedido y revisión de la escalera de precios; **(3)** un plan comercial B2B con objetivo en
metros (talleres, tiendas de personalización, clubes), medido por coste de captación;
**(4)** cerrar los tres riesgos que pueden costar más que todo el margen del año: Verifactu y
la doble facturación, el «grupo B» y la caída de la app. El detalle y el impacto estimado de
cada uno, en la sección 8.

---

## 1. Alcance y límites, con honestidad

- **No he visto datos de producción.** He trabajado con el código (`src/dominio/`,
  `src/components/gerencia/`, `src/lib/gerencia*.ts`), las migraciones, la auditoría del 17-10
  (`docs/pendiente_auditoria.pdf`), los informes 01 a 04 y las nueve capturas que mandaste.
- **Entre las capturas no hay ningún informe anual en PDF.** Las nueve imágenes son: el aviso de
  que falta la clave del lector de facturas (1), un pedido en WordPress (2), un pedido
  desplegado en el CRM (3), la pantalla Facturación de DTF Culture de octubre (4), un ticket
  (5), la lista de pedidos de 11 a 13 de octubre (6), la lista de presupuestos (7), el panel
  caído (8) y el lector de facturas devolviendo error 400 (9). La auditoría en PDF de `docs/`
  tampoco trae cifras: deja las consultas para ejecutar. **Si existe ese informe anual
  (cuentas anuales, balance, modelo 200, un informe de la gestoría), mándamelo**: con él este
  documento pasa de «cómo está montado y qué apunta» a «cómo están tus números».
- Las cifras de la sección 2 salen **solo** de las capturas. Son ocho días de una tienda, al
  principio de su vida: sirven para dimensionar, no para sacar tendencias.
- Donde necesito un número que no tengo (coste fijo mensual, coste real por metro, coste de
  mano de obra), lo pongo **como escenario con su supuesto a la vista**, nunca como dato tuyo.
  Los rangos de mercado que cito son de mi experiencia y hay que contrastarlos con tus facturas
  y con cinco competidores.
- La sección 9 trae seis consultas de **solo lectura** para el SQL Editor de Supabase que
  convierten los escenarios en cifras reales. Las he ejecutado contra el esquema completo de
  `supabase/migrations/` en un PostgreSQL 16 local (vacío, dentro de una transacción de solo
  lectura) para asegurar que corren. **No las he ejecutado contra producción.**

---

## 2. Lo que dicen los datos reales que he visto

### 2.1 Cifras de las capturas

| Dato | Valor | De dónde |
| --- | --- | --- |
| Vendido 1-8 oct (DTF Culture, con IVA) | 853,00 € | Captura 4 |
| Facturación bruta (en esa versión llevaba el envío dentro) | 709,26 € | Captura 4 |
| Envíos cobrados, sin IVA | 120,31 € | Captura 4 |
| Base sin envío (709,26 − 120,31) | **588,95 €** | Cálculo |
| Pedidos válidos / cancelados | 24 / 4 (**14 %** cancelados) | Captura 4 |
| Metros | 85,56 m | Captura 4 |
| Metros por pedido | **3,6 m** | Cálculo |
| Precio medio del metro (588,95 ÷ 85,56) | **6,88 €/m** sin IVA | Cálculo |
| Ticket medio con IVA | 35,54 € | Captura 4 |
| Pedidos con envío (120,31 ÷ 5,99) | ≈ 20 de 24 (**83 %**) | Cálculo |
| Mismo periodo de septiembre (1-8 sep) | ≈ 1 pedido, 2 m, 14 € | Deducido de las variaciones de la captura 4 |
| Producto con más metros | «DTF por Metros – Pedido Manual» | Captura 4 |
| Precio por metro en la web | 7,00 € sin IVA | Capturas 2 y 5 |
| Envío 24 h (CTT Express) | 5,99 € sin IVA | Capturas 2, 3 y 5 |
| Coste de envío estimado en el CRM | 5,00 € sin IVA | `AJUSTES_JORNADA_POR_DEFECTO` (`src/dominio/gerencia.ts:587`) |
| Capacidad (valor por defecto del código; en producción, a comprobar) | 70 m/h × 4 h/día (9:00-13:00) | Mismo sitio |
| Numeración de tickets el 24-9 | T2026/0003 | Captura 5 |
| Numeración de pedidos web el 13-10 | DCUL-77-2026 | Captura 6 |
| Presupuestos abiertos | 1, en borrador, 60,61 € | Captura 7 |
| Medio de pago visto | Bizum | Captura 2 |
| Clientes vistos | correos de Gmail, Yahoo y Outlook | Capturas 3 y 6 |

### 2.2 Lo que leo en esas cifras

- **Arranque muy reciente.** De ~14 € del 1 al 8 de septiembre a 853 € del 1 al 8 de octubre.
  Es crecimiento, pero desde casi cero: el «+5.992 %» de la pantalla es cierto y no significa
  nada. Te recomiendo no mirar variaciones porcentuales hasta tener tres meses comparables (ver
  8.3, «variación con base mínima»).
- **Ritmo: unos 300-325 m y 2.200-2.700 € de base al mes** en DTF Culture (85,56 m en 8 días
  naturales ≈ 320 m/mes; en 6 días laborables ≈ 14 m/día). Base al mes: 588,95 ÷ 8 × 30 ≈
  2.200 € sin envío y 709,26 ÷ 8 × 30 ≈ 2.660 € con envío. Al año, unos 26.500-32.000 € de
  base. Es una microempresa en la cifra de negocio, aunque tenga estructura de pyme.
- **Ocupación de la máquina ≈ 5 %** (si la capacidad real se parece a la de por defecto).
  70 m/h × 4 h × ~21 días = 5.880 m/mes de capacidad frente a ~300 m vendidos. La propia definición de la app (`rd_capacidad`) dice que por debajo del 50 %
  «hay sitio para vender más». Aquí hay sitio para vender **veinte veces más** sin comprar otra
  máquina. Con estos números, **cualquier inversión en capacidad sería un error**; la inversión
  que falta es comercial.
- **El cliente real no es el B2B de manual.** Bizum, correos personales, tickets (factura
  simplificada) en vez de facturas completas, 3,6 m por pedido: es **micro-B2B** (autónomos,
  pequeños talleres, particulares que personalizan). Eso cambia todo: el coste de servir un
  pedido pesa mucho, el cliente compara precio en Google y la fidelidad hay que ganarla.
- **El canal manual pesa más que la web.** El producto con más metros es «Pedido Manual». Es
  buena señal (son los clientes que vuelven y piden por WhatsApp o correo), y es donde está el
  B2B de verdad. Hay que medirlo aparte, con su precio y su margen.
- **El envío pesa mucho en el ticket pequeño.** En el ticket de la captura 5 (1 m), el envío
  (5,99 €) es el 46 % de la base. Para el cliente, el metro le sale a 13 €, no a 7: compite mal
  contra la recogida en tienda o contra quien regala el envío a partir de cierta cantidad.
- **14 % de cancelados.** Alto para un negocio de pago por adelantado. En WooCommerce suele ser
  pago no completado que la tienda cancela sola; si es eso, es venta perdida en la pasarela, y
  se arregla con un correo de recuperación de carrito. Hay que mirarlo antes de darlo por bueno.
- **Solo hay una tienda real.** En la barra lateral de la captura 4 se ven «DTF Culture» y
  «prueba». El modelo «varias tiendas WooCommerce» es hoy una aspiración, no un hecho. No tiene
  sentido abrir más tiendas hasta que la primera cubra su parte de los costes fijos.
- **Comercial casi vacío.** Un presupuesto, en borrador, de 60,61 €. Si el textil
  personalizado y el B2B grande se venden por presupuesto, el embudo está seco.

---

## 3. El modelo de negocio, con ojo crítico

### 3.1 DTF por metros

Es un negocio de **coste fijo alto, coste variable bajo y precio comoditizado**: la máquina, la
nave y las personas cuestan lo mismo imprimas 300 m o 3.000 m; la tinta, el film y el polvo
son una parte pequeña del precio; y el cliente compara el metro en Google en dos minutos. En
ese tipo de negocio solo hay tres palancas:

1. **Volumen** para diluir el fijo (hoy, al 5 % de capacidad, es la palanca dominante).
2. **Precio por pedido**, no por metro: el pedido pequeño cuesta casi lo mismo de preparar que
   el grande. Por eso el sector cobra pedido mínimo, cargo de preparación o una escalera de
   precio por tramos.
3. **Servicio** que permita no ser el más barato: plazo (24 h con hora de corte, que ya tenéis),
   revisión del archivo, gang sheet montado por vosotros, recogida, muestras.

El CRM mide bien la palanca 1 a toro pasado (metros, capacidad) y nada de la 2 (no hay
economía por tamaño de pedido).

### 3.2 Varias tiendas WooCommerce

Varias tiendas con una sola máquina y un solo CIF tienen sentido si cada una ataca un público
distinto (DTF por metros, DTI, textil, marca blanca para revendedores). Tienen dos costes que
se suelen olvidar: **el mantenimiento de cada WordPress** (la captura 2 enseña 10 plugins por
actualizar, otro plugin de facturas, WowInvoice, y un montador de terceros) y **la publicidad
que compite contra sí misma** en Google Ads. Antes de la segunda tienda real, la primera tiene
que demostrar su coste de captación y su margen tras publicidad.

### 3.3 Textil personalizado

Cambia el perfil de riesgo: hay **stock** (dinero parado), **anticipos a proveedores**
(proformas) y **trabajo por presupuesto** (ciclo comercial más largo). Bien llevado, es el
negocio de más margen absoluto por pedido; mal llevado, es donde se queda la caja. El CRM ya
tiene libro de almacén con coste medio ponderado, mermas y controles: es la parte mejor medida.
Falta la **rotación** (cuánto tarda en salir lo que se compra) y el **margen por pedido textil
incluyendo la impresión DTF que lleva** (hoy queda fuera por decisión, ver
`docs/escaner-textil/contrato.md` §0.1.2).

---

## 4. Qué mide hoy la app (y cómo de bien)

He leído el código de Gerencia y sus definiciones (`src/dominio/definiciones.ts`, unas 60
cifras con su ⓘ). Este es el inventario, con mi nota:

| Indicador | ¿Existe? | Dónde | Nota del economista |
| --- | --- | --- | --- |
| Vendido, cobrado, pendiente | Sí | `gerencia.ts`, `kpis.ts` | Bien: neto de devoluciones, sin cancelados |
| Facturación bruta sin envío | Sí | `calcularKpis` | Bien desde F7 |
| Margen (bruta − coste) | Sí | `cifrasGerencia` | **Coste incompleto** (ver 5.1) |
| € por metro y margen por metro | Sí | `margen.ts` `margenPorMetro` | Contaminado por metros estimados (5.2) |
| Margen por tienda | Sí | `margenPor(…tienda_id…)` | Sin publicidad ni fijos por tienda: no es rentabilidad |
| Beneficio estimado (margen − fijos prorrateados) | Sí | `beneficioEstimado` | Bien pensado; depende de que los fijos estén todos |
| Cuenta de resultados, Sociedades, 303/111/115/202 | Sí | `impuestos.ts`, `Resultados.tsx` | Orientativo; ver informe 01 |
| Objetivos de metros y de venta | Sí | `objetivoDelRango` | Bien; falta ligarlo al punto muerto |
| Días medios de cobro | Sí | `diasMediosCobro` | **Halagador**: la web cuenta 0 días (5.4) |
| Antigüedad de la deuda (0-30, 31-60, 60+) | Sí | `antiguedadPendientes` | Bien |
| Banco y caja, sin conciliar | Sí | `resumenBanco` | Bien; no hay previsión |
| Clientes activos, nuevos, recurrentes, dormidos (60 d), Pareto 80 % | Sí | `clientela.ts` | Por **ventas**, no por margen; DTF y textil son clientes distintos |
| Embudo de presupuestos, conversión, días a pedido | Sí | `comercial.ts` | Bien |
| Taller, espera, días hasta envío | Sí | `produccion.ts` | Bien |
| Capacidad usada de la máquina | Sí | `resumen-diario.ts` (`rd_capacidad`) | Muy útil; debería estar en el Resumen |
| Margen neto con envíos | Sí, solo en Resumen diario | `rd_margen_neto` | El Resumen general supone envío = coste |
| Valor del almacén, mermas, cuenta del almacén | Sí | `stock-textil.ts`, Textil | Bien |
| Compras de consumibles frente a coste estimado | Sí | `comparacionCompras` | Buena idea; **vacía si no se registran compras** |
| **Punto muerto** (metros y € al mes) | **No** | — | El más importante para decidir hoy |
| **Coste real por metro** (compras ÷ metros) | **No** (solo comparación) | — | Pendiente de la auditoría (mejora 6) |
| **Economía por tamaño de pedido** | **No** | — | Decide el pedido mínimo |
| **Margen por cliente** y Pareto por margen | **No** | — | Mejora 3 de la auditoría |
| **Coste de captación (CAC) y retorno de publicidad** | **No** | — | La publicidad es un gasto suelto, sin tienda ni canal |
| **LTV** (valor de vida del cliente) y cohortes | **No** | — | Con 2 meses de vida, aún poco fiable; prepararlo |
| **DSO real** (pendiente ÷ venta diaria) | **No** | — | Ver 5.4 |
| **Previsión de caja** a 30/60/90 días | **No** | — | Mejora 7 de la auditoría |
| **Rotación de stock textil** y días de stock | **No** | — | Los datos ya están en el libro de almacén |
| **Concentración** de clientes (top 1/5/10, HHI) y de proveedores | **No** | — | Ver riesgos |
| Comisiones de cobro (pasarela, Bizum, TPV) | **No** | — | `export-analisis.ts:154` lo reconoce |
| Tasa de cancelación y de recuperación de carritos | Solo el número | Captura 4 | Hay que ver el motivo |

**Mi lectura:** la app mide muy bien **lo que pasó** (ventas, cobros, impuestos, almacén) y
casi nada de **lo que hay que decidir** (precio, pedido mínimo, a qué cliente cuidar, cuánto
gastar en publicidad, cuándo falta caja). Es el sesgo típico de un sistema que nace de la
facturación.

---

## 5. Dónde se equivocan hoy las cifras de margen y de cobro

### 5.1 El coste por metro es un número a mano y le faltan partidas

`useCosteMetroActual()` (`src/lib/gerencia.ts:182`) suma tres columnas de `empresas`:
consumibles, embalaje y electricidad por metro. Se congela en cada pedido
(`coste_metro_snapshot`), lo cual está muy bien, pero **lo que se congela es una estimación**.
No incluye:

| Partida | Por qué importa | Orden de magnitud a contrastar |
| --- | --- | --- |
| **Merma** (pruebas, repeticiones, purgas, cabezales) | En DTF se tira entre un 5 y un 15 % del film y tinta según el operario y la máquina | +0,2 a +0,5 €/m |
| **Mano de obra directa** | Montar el archivo, imprimir, cortar, embalar | Fijo hoy; variable por pedido (ver 6.3) |
| **Comisiones de cobro** | Pasarela y TPV cobran un % más un fijo por operación; en tickets pequeños, el fijo pesa | 1-3 % del cobro |
| **Mantenimiento y cabezales** | Un cabezal es un gasto grande y periódico | Prorratear por metros impresos |
| **Amortización de la máquina** | Está en compras como «maquinaria» al 12 % anual, pero como fijo | Fijo; entra en el punto muerto |

Además, **el contraste con la realidad está roto**: la comparación «compras de consumibles
frente a lo estimado» (`comparacionCompras`) existe, pero se alimenta de las facturas de
compra registradas, y el lector de facturas no funcionaba (captura 1, 7-10: faltaba
`ANTHROPIC_API_KEY`; captura 9, 16-10: ya respondía, pero con error 400). Sin compras registradas, la comparación sale a cero y
nadie se entera de que el coste real es otro. **Las compras se pueden dar de alta a mano
mientras tanto**: es la acción de más valor y menos esfuerzo de todo este informe.

### 5.2 Los metros estimados hacen trampa sin querer

Cuando DTFBuild no devuelve la longitud, `medirLineaWoo` (`src/dominio/metros-woo.ts:240`)
estima los metros como `subtotal ÷ precio por metro`. Es razonable para tener algún número,
pero tiene una consecuencia económica: **en esos pedidos el «€ por metro» sale exactamente el
precio de referencia**, y el margen por metro sale igual al de manual. Si hay descuentos por
volumen o pedidos a medida, no se ven. La app ya marca esos pedidos como estimados; **el
indicador «€ por metro» debería calcularse solo con metros medidos** (o enseñar qué parte es
estimada). Antes de este arreglo (F5) también se tomaba la cantidad como metros: la captura 3
(«1 m a 12,27 €») es ese fallo; serían 1,75 m a 7 €.

### 5.3 El envío no es neutro

El Resumen y la pestaña Margen suponen que el envío se cobra y se paga por lo mismo
(`costeVariable` en `src/dominio/kpis.ts:193`). El Resumen diario, en cambio, usa 5,00 € de
coste por envío frente a 5,99 € cobrados (`rd_margen_neto`). Son dos verdades distintas sobre
lo mismo. Con 20 envíos en 8 días, la diferencia es pequeña en euros, pero **la decisión de
envío gratis a partir de X € depende de saber cuánto cuesta de verdad cada envío** (factura de
CTT entre envíos del mes). Y los pedidos que se envían sin cobrar el envío no aparecen en
ningún sitio como coste.

### 5.4 Los días de cobro salen mejor de lo que son

`diasMediosCobro` cuenta los cobros web con **0 días** y pesa por importe. Como la web es la
mayoría, el indicador saldrá cercano a cero aunque los clientes manuales (los B2B, los que
importan) tarden 45 días. Hace falta el **DSO clásico**: lo pendiente hoy ÷ la venta diaria
media, y además **el DSO solo de clientes con crédito** (manual y textil). La consulta 4 de la
sección 9 lo calcula.

### 5.5 Clientes partidos en dos

El mismo cliente que compra DTF y textil cuenta como dos (`claveCliente` añade el prefijo
`textil:`), y no hay `UNIQUE (empresa_id, email)` (tabla de estado de `CLAUDE.md`). Eso infla
«clientes nuevos», baja la recurrencia y, sobre todo, **esconde a los mejores clientes**, que
son justo los que compran las dos cosas.

---

## 6. Economía unitaria: el punto muerto, en escenarios

No tengo tus gastos fijos ni tu coste real por metro. Lo que sigue es **la cuenta que tienes
que hacer**, con supuestos explícitos para ver el orden de magnitud. Sustituye cada supuesto
por tu número y la conclusión cambia o no; esa es la gracia.

### 6.1 Fórmula

```
Margen de contribución por metro  = precio medio del metro − coste variable por metro
Punto muerto (metros al mes)      = gastos fijos del mes ÷ margen de contribución por metro
Ocupación necesaria               = punto muerto ÷ capacidad mensual (≈ 5.880 m)
```

### 6.2 Escenarios (precio 7 €/m, el de las capturas)

| Coste variable por metro (supuesto) | Margen por metro | Fijos 1.500 €/mes | Fijos 3.000 €/mes | Fijos 5.000 €/mes |
| --- | --- | --- | --- | --- |
| 2,50 € | 4,50 € | 333 m | 667 m | 1.111 m |
| 3,50 € | 3,50 € | 429 m | 857 m | 1.429 m |
| 4,50 € (con merma y comisiones) | 2,50 € | 600 m | 1.200 m | 2.000 m |

Ritmo actual visto en las capturas: **~320 m al mes**. El precio medio real es 6,88 €/m, un
poco por debajo de los 7 € de la tabla: los márgenes reales son unos 0,12 €/m más bajos.

**Lectura:** el punto muerto más bajo de la tabla (333 m) ya está por encima de lo que se vende,
así que **en ningún escenario la parte DTF cubre hoy su estructura**. Para cubrirla con el
volumen actual harían falta, a la vez, un coste variable de 2,50 €/m y unos fijos de menos de
1.440 € al mes (320 m × 4,50 €), lo que exige que nadie cobre sueldo de ella. La buena noticia es que el punto muerto, en cualquier escenario razonable, está
entre el 6 % y el 35 % de la capacidad: **es alcanzable sin invertir en máquina**. Es un
problema de ventas, no de producción.

### 6.3 Economía por pedido

Con el mismo precio, un coste variable de 3 €/m y un **coste fijo de servir cada pedido** de 3 €
(preparar archivo, imprimir, cortar, embalar, gestionar el cobro: unos 10-15 minutos; supuesto):

| Metros del pedido | Base (7 €/m) | Material (3 €/m) | Servir el pedido | Queda |
| --- | --- | --- | --- | --- |
| 1 m | 7,00 € | 3,00 € | 3,00 € | **1,00 €** |
| 3,6 m (medio actual) | 25,20 € | 10,80 € | 3,00 € | 11,40 € |
| 10 m | 70,00 € | 30,00 € | 3,00 € | 37,00 € |
| 30 m | 210,00 € | 90,00 € | 3,00 € | 117,00 € |

Sin el coste de servirlo, el pedido de 1 m deja 4 € (7 − 3). A 20 €/hora de coste empresa, eso
paga 12 minutos de trabajo: con 10 minutos deja 0,67 €; con 15 minutos (5 €) **pierde 1 €**, y
aún sin contar la comisión de cobro.
La consulta 1 de la sección 9 te dice cuántos pedidos tienes en cada tramo: si una parte grande
está por debajo de 2 m, el pedido mínimo (o un cargo de preparación de 2-3 €) es la medida de
más impacto inmediato.

### 6.4 El precio

7 €/m sin IVA está, en mi experiencia, en la parte baja del mercado español de DTF por metros
a ~58 cm de ancho. No te digo que lo subas a ciegas: te digo que **lo compares con cinco
competidores** (precio del metro, pedido mínimo, envío gratis desde, plazo) y que decidas una
escalera explícita, por ejemplo: precio de 1-4 m, de 5-19 m y de 20 m en adelante, con el
envío gratis a partir de un importe que cubra su coste. Un metro más caro en los tramos bajos y
más barato en los altos sube el margen **y** empuja al cliente a juntar pedidos.

---

## 7. Riesgos

Ordenados por lo que pueden costar, no por lo probables que son.

### 7.1 Fiscales (los más caros)

| Riesgo | Por qué | Qué cuesta si sale mal |
| --- | --- | --- |
| **Verifactu el 1-1-2027 (72 días)** | El CRM ya emite tickets y facturas con NIF y numeración (captura 5). Si emite, es sistema de facturación sujeto (informe 01, H1) | Multa fija de **50.000 € por ejercicio** a quien use un programa no conforme (art. 201 bis LGT; a confirmar con la gestoría), más que la venta de un año; y tener que parar de facturar en enero |
| **Doble factura** | La tienda tiene el plugin WowInvoice instalado (captura 2; en ese pedido dice «Invoice not published», hay que confirmar que no emite) además del CRM, y la gestoría emite las suyas | Dos facturas por una venta: IVA repercutido de más o inspección |
| **«Grupo B»** | La app separa lo documentado (A) de pedidos sin documento y gastos sin justificante (B). El IVA se devenga igual (informe 01, H6). Que el ticket del 24-9 sea el número 3 es un indicio de pedidos sin documento, no una prueba: también puede que se documenten con factura (serie F) o que la serie empezara tarde. Lo confirma o desmiente la consulta B6 de `consultas-cuadre.sql` | En una inspección, el B se presume venta no declarada. Objetivo: **B = 0** |
| **Fecha de los documentos** | Llevan la fecha del pedido, no la de expedición (informe 01, H2) | Antedatar; cambiar trimestres ya presentados |

**Mi recomendación:** que la gestoría o un proveedor certificado sea el único sistema que emite
desde el 1-1-2027, y que el CRM le pase los datos. Es más barato que convertir el CRM en un
sistema certificado y quita la responsabilidad de encima.

### 7.2 Concentración de clientes

No puedo medirla (la app no la calcula). Por el perfil (micro-B2B, ticket de 35 €) espero
**poca concentración en clientes** y **mucha en canal**: una tienda, Google como fuente
principal (en la barra del navegador de la captura 8 se ven Google Ads y Metricool). Si Google
sube el coste por clic o cambia el algoritmo, se cae la entrada de pedidos. La consulta 2 mide
la concentración de clientes; la de canal se mide etiquetando el origen de cada cliente.

### 7.3 Proveedores

Una impresora DTF depende de un proveedor de tinta y film compatibles, y a veces de uno solo
para los cabezales. El textil depende de uno o dos mayoristas. La consulta 6 te dice qué parte
de las compras va a cada proveedor. Si uno pasa del 50 %, conviene tener homologado un segundo
(con una prueba de color hecha) antes de necesitarlo.

### 7.4 Tecnológicos y de dependencia de la app

- **La app ya se ha caído** (captura 8, 16-10; la auditoría lo atribuye a que la integración
  continua no probaba la versión que se despliega; la causa exacta no se ha confirmado con el
  registro del servidor). El día que se cae, no se puede facturar ni
  ver la cola de producción. **Plan B en papel**: cómo se cobra, se imprime y se envía un día
  sin CRM.
- **Dependencia de personas:** el CRM lo ha construido un socio con un asistente de IA. Es
  mucho código (100 migraciones contando las 11 nuevas del 21-10, unos 80 módulos de dominio) para el tamaño del negocio. Si esa
  persona no está, nadie lo mantiene. Hace falta documentación de operación (cómo se despliega,
  cómo se restaura una copia, a quién se llama) y no añadir funciones que no paguen su
  mantenimiento.
- **WordPress y plugins:** 10 plugins por actualizar y un montador de terceros (DTFBuild) del
  que depende saber los metros. Si DTFBuild cambia su API, los metros pasan a estimados sin que
  nadie lo note (5.2). Recomiendo un aviso cuando el porcentaje de metros estimados de la semana
  pase de, por ejemplo, el 20 %.
- **El lector de facturas con IA** no funcionaba en las capturas 1 y 9 (no sé si ya funciona). Es un ejemplo de
  automatización que, cuando falla, **deja de alimentar el margen sin avisar**.
- **Rapidez de la app:** importa (tiempo de los socios cada día), y ya hay un plan en
  `docs/rendimiento/plan.md`. Pero económicamente vale más que la app **no se caiga** que que
  vaya un segundo más rápida: priorizaría la prueba de arranque en CI (fase 0 del plan y punto
  técnico de la auditoría) antes que las fases de optimización.

### 7.5 Tesorería

No hay previsión de caja. En un negocio que arranca, con aportaciones de socios (pantalla
Inversión) y textil con anticipos a proveedores, **el riesgo no es perder dinero, es quedarse
sin caja**. Los pagos fraccionados del 202 (abril, octubre, diciembre) y el 303 trimestral son
salidas grandes y fechadas que la app ya conoce y no proyecta.

---

## 8. Qué más deberíamos hacer

Priorizado por impacto ÷ esfuerzo. El impacto es una estimación de orden de magnitud con el
volumen actual (~300 m/mes); donde depende de un dato que no tengo, lo digo.

### 8.1 Ya (próximas 4 semanas). Sin programar o casi

| # | Acción | Impacto estimado | Esfuerzo |
| --- | --- | --- | --- |
| 1 | **Dar de alta a mano las facturas de compra de septiembre y octubre** (tinta, film, polvo, envíos, publicidad) mientras el lector no funcione, y poner la clave del lector | Saber el margen real. Si el coste real por metro es 1 € mayor que el configurado, el margen de la app está inflado unos 300 €/mes | 2-3 horas |
| 2 | **Apuntar todos los gastos fijos** en Gerencia › Ajustes, incluidos sueldos o lo que cobren los socios, cuota de autónomos que pague la empresa, alquiler, seguros, software, gestoría | Sin esto, «Beneficio estimado» no significa nada | 1 hora |
| 3 | **Ejecutar las seis consultas de la sección 9** y las del Anexo A de la auditoría | Pasar de escenarios a cifras | 30 minutos |
| 4 | **Calcular el punto muerto** con 1-3 y ponerlo como objetivo de metros (ya existe la función de objetivos) | Un número para todo el equipo: «necesitamos X m al mes» | 15 minutos |
| 5 | **Pedido mínimo o cargo de preparación** en la web (por ejemplo, 2-3 € por pedido o mínimo de 2 m), si la consulta 1 confirma muchos pedidos de menos de 2 m | Con un 40 % de pedidos pequeños y 3 €/pedido: +100-150 €/mes de margen puro, ~5 % de la base | Configuración de WooCommerce |
| 6 | **Mirar los 4 cancelados de octubre**: si son pagos no completados, activar recuperación de carrito | Recuperar 1 de cada 4: ~+3-4 % de venta | 1 hora |
| 7 | **Decidir quién emite desde el 1-1-2027** (gestoría o proveedor certificado) y apagar la emisión que sobre (WowInvoice o CRM) | Evitar la sanción y la doble factura: el riesgo más caro del informe | Una reunión con la gestoría |
| 8 | **Plan B de un día sin CRM** (una hoja) | Seguir cobrando y produciendo si se cae | 1 hora |

### 8.2 Este trimestre. Comercial y precio

| # | Acción | Impacto estimado | Esfuerzo |
| --- | --- | --- | --- |
| 9 | **Plan comercial B2B con objetivo en metros**: lista de 100 talleres, tiendas de personalización, clubes y empresas de merchandising a menos de 24 h; muestra gratuita (1 m con su diseño); seguimiento en Presupuestos. Ya tenéis el marcador «Captación de talleres» | Cada cliente B2B de 30 m/mes a 4 €/m de margen son 120 €/mes. Con 10 así, el DTF duplica su volumen | Una persona, 1 día a la semana |
| 10 | **Escalera de precios por tramos** y envío gratis a partir de un importe que cubra el coste real del envío | Subir el pedido medio de 3,6 m a 5 m reduce el coste de servir por metro un 28 % (de 0,83 a 0,60 €/m con 3 € por pedido) | Medio día de análisis + Woo |
| 11 | **Medir el coste de captación por tienda**: apuntar la publicidad por tienda y mes, y dividir entre clientes nuevos | Saber si cada euro de Google Ads deja dinero o lo quema | Bajo (ver 8.3, nº 14) |
| 12 | **Ficha de cliente unificada y reactivación de dormidos** (mejoras 5 y 10 de la auditoría) | Un cliente recuperado cuesta 5-7 veces menos que uno nuevo | Medio |
| 13 | **Avisos de cobro a 7, 15 y 30 días y pago por enlace** (mejoras 1 y 9) | Solo si hay venta a crédito relevante; la consulta 4 dirá cuánto | Medio |

### 8.3 Indicadores nuevos en la app (cuando lo anterior esté en marcha)

Todos son lógica pura que cabe en `src/dominio/` con sus pruebas, y la mayoría **no necesita
migración** porque los datos ya están. Los pongo en orden de utilidad para decidir:

| # | Indicador | Fórmula | Datos que ya existen |
| --- | --- | --- | --- |
| 14 | **Punto muerto** (m y €/mes) y distancia a él | fijos del mes ÷ margen por metro | Gastos fijos, margen por metro |
| 15 | **Coste real del consumible por metro** (media móvil de 3 meses) | compras «consumibles» ÷ metros impresos | `comprasParaComparar` + metros |
| 16 | **Margen por tamaño de pedido** (tramos de metros) | Como la consulta 1, con coste de servir configurable | Pedidos |
| 17 | **Margen por cliente** y Pareto por margen, no por ventas | `margenPor(ventas, cliente)` ya sirve casi tal cual | `margen.ts` |
| 18 | **DSO real** y DSO de clientes con crédito | pendiente ÷ venta diaria de 90 días | Pedidos y cobros |
| 19 | **Previsión de caja a 30/60/90 días** | saldo banco + caja + cobros esperados − fijos − impuestos del calendario − pagos a proveedores | Todo existe ya en Gerencia |
| 20 | **Rotación del stock textil** y días de stock | coste de lo vendido ÷ stock medio | Libro de almacén |
| 21 | **Concentración** (top 1/5/10 y HHI) de clientes y proveedores | Consultas 2 y 6 | Pedidos y compras |
| 22 | **Rentabilidad por tienda** de verdad | margen − publicidad de la tienda − parte de los fijos | Falta asignar la publicidad a tienda |
| 23 | **LTV y cohortes por mes de alta** | margen acumulado por cohorte | Pedidos; fiable a partir de 6-12 meses de historia |
| 24 | **Variación con base mínima** | no enseñar % cuando el periodo anterior es diminuto | `variacion()` ya devuelve nulo con 0; ampliar a bases pequeñas |
| 25 | **Porcentaje de metros estimados** con aviso | metros estimados ÷ metros totales | `pedidoConMetrosEstimados` |

### 8.4 Más adelante (6-12 meses)

- **Segunda tienda real** solo cuando DTF Culture pase su punto muerto y se sepa su coste de
  captación.
- **Textil + DTF en un solo pedido con su margen completo** (hoy la personalización DTF queda
  fuera de la línea textil por decisión). Es el producto de más valor y hoy no se sabe qué deja.
- **Segunda jornada o turno** solo si la ocupación pasa del 70 % durante dos meses seguidos. Con
  los números de hoy, falta muchísimo.
- **No construir más módulos en el CRM sin un caso de negocio**: cada pantalla nueva es
  mantenimiento para siempre. La regla que propongo: una función nueva tiene que ahorrar o
  ganar al menos lo que cuesta mantenerla.

---

## 9. Cómo obtener los datos que faltan

Seis consultas de **solo lectura** para pegar en Supabase › SQL Editor. Ninguna escribe nada.
Si quieres asegurarte, ejecútalas precedidas de `BEGIN; SET TRANSACTION READ ONLY;` y acaba con
`ROLLBACK;`. Las he probado contra el esquema completo de las migraciones (en local, sin
datos); **no contra producción**. Cubren solo tiendas (no textil) salvo la 5 y la 6, y no
restan devoluciones parciales: son para dimensionar, no para cuadrar al céntimo.

```sql
-- 1. Economía del pedido por tamaño (12 meses)
WITH p AS (
  SELECT metros_total AS metros, total - iva - envio AS base_sin_envio, envio
  FROM public.pedidos
  WHERE estado <> 'cancelado' AND fecha_pedido >= now() - interval '12 months'
)
SELECT CASE
         WHEN metros = 0  THEN '0 · sin metros'
         WHEN metros < 1  THEN '1 · menos de 1 m'
         WHEN metros < 3  THEN '2 · de 1 a 3 m'
         WHEN metros < 10 THEN '3 · de 3 a 10 m'
         WHEN metros < 30 THEN '4 · de 10 a 30 m'
         ELSE                  '5 · 30 m o más'
       END                                                    AS tramo,
       count(*)                                               AS pedidos,
       round(sum(metros), 1)                                  AS metros,
       round(sum(base_sin_envio), 2)                          AS base_sin_envio,
       round(sum(base_sin_envio) / nullif(sum(metros), 0), 2) AS euro_metro,
       round(avg(base_sin_envio), 2)                          AS base_media_pedido,
       round(sum(envio), 2)                                   AS envio_cobrado
FROM p GROUP BY 1 ORDER BY 1;

-- 2. Concentración de clientes (12 meses)
WITH v AS (
  SELECT coalesce(lower(trim(c.email)), 'pedido:' || p.id::text) AS cliente,
         sum(p.total - p.iva - p.envio)                          AS base
  FROM public.pedidos p LEFT JOIN public.clientes c ON c.id = p.cliente_id
  WHERE p.estado <> 'cancelado' AND p.fecha_pedido >= now() - interval '12 months'
  GROUP BY 1
), r AS (
  SELECT base, sum(base) OVER () AS tot, row_number() OVER (ORDER BY base DESC) AS n FROM v
)
SELECT count(*)                                                               AS clientes,
       round(100 * sum(base) FILTER (WHERE n = 1)   / nullif(max(tot), 0), 1) AS pct_cliente_1,
       round(100 * sum(base) FILTER (WHERE n <= 5)  / nullif(max(tot), 0), 1) AS pct_top_5,
       round(100 * sum(base) FILTER (WHERE n <= 10) / nullif(max(tot), 0), 1) AS pct_top_10,
       round(sum((base / nullif(tot, 0)) ^ 2) * 10000)                        AS hhi
FROM r;

-- 3. Mes a mes: pedidos, metros, base, clientes y nuevos
WITH v AS (
  SELECT p.*, coalesce(lower(trim(c.email)), 'pedido:' || p.id::text) AS cli,
         date_trunc('month', p.fecha_pedido AT TIME ZONE 'Europe/Madrid') AS mes
  FROM public.pedidos p LEFT JOIN public.clientes c ON c.id = p.cliente_id
  WHERE p.estado <> 'cancelado'
), primero AS (SELECT cli, min(mes) AS mes_alta FROM v GROUP BY cli)
SELECT to_char(v.mes, 'YYYY-MM')                                     AS mes,
       count(*)                                                      AS pedidos,
       round(sum(v.metros_total), 1)                                 AS metros,
       round(sum(v.total - v.iva - v.envio), 2)                      AS base_sin_envio,
       count(DISTINCT v.cli)                                         AS clientes,
       count(DISTINCT v.cli) FILTER (WHERE primero.mes_alta = v.mes) AS clientes_nuevos
FROM v JOIN primero USING (cli)
GROUP BY v.mes ORDER BY v.mes;

-- 4. DSO real: lo pendiente hoy frente a la venta diaria de 90 días
WITH cob AS (
  SELECT pedido_id, sum(importe) AS c FROM public.cobros WHERE pedido_id IS NOT NULL GROUP BY 1
), pend AS (
  SELECT sum(greatest(p.total - coalesce(cob.c, 0), 0)) AS pendiente
  FROM public.pedidos p LEFT JOIN cob ON cob.pedido_id = p.id
  WHERE p.estado <> 'cancelado'
), ventas AS (
  SELECT sum(total) / 90.0 AS diaria FROM public.pedidos
  WHERE estado <> 'cancelado' AND fecha_pedido >= now() - interval '90 days'
)
SELECT round(pendiente, 2) AS pendiente_hoy, round(diaria, 2) AS venta_diaria_90d,
       round(pendiente / nullif(diaria, 0), 1) AS dso_dias
FROM pend, ventas;

-- 5. Coste real del consumible por metro, mes a mes
WITH m AS (
  SELECT date_trunc('month', fecha_pedido AT TIME ZONE 'Europe/Madrid')::date AS mes,
         sum(metros_total) AS metros
  FROM public.pedidos WHERE estado <> 'cancelado' GROUP BY 1
), c AS (
  SELECT date_trunc('month', fecha)::date AS mes, sum(base) AS consumibles
  FROM public.textil_compras
  WHERE estado = 'registrada' AND borrada_en IS NULL AND categoria = 'consumibles'
  GROUP BY 1
)
SELECT to_char(mes, 'YYYY-MM') AS mes, round(coalesce(metros, 0), 1) AS metros,
       round(coalesce(consumibles, 0), 2) AS consumibles,
       round(consumibles / nullif(metros, 0), 2) AS consumible_por_metro
FROM m FULL JOIN c USING (mes) ORDER BY mes;

-- 6. Dependencia de proveedores (12 meses)
SELECT coalesce(nif_proveedor, proveedor, '(sin proveedor)') AS proveedor, categoria,
       count(*) AS facturas, round(sum(base), 2) AS base,
       round(100 * sum(base) / nullif(sum(sum(base)) OVER (), 0), 1) AS pct
FROM public.textil_compras
WHERE estado = 'registrada' AND borrada_en IS NULL AND fecha >= current_date - 365
GROUP BY 1, 2 ORDER BY base DESC LIMIT 15;
```

Cómo leerlas:

- **1:** si los tramos 1 y 2 (menos de 3 m) son más del 40 % de los pedidos, el pedido mínimo
  es prioritario. Si el `euro_metro` de los tramos altos es mucho menor que 7, hay descuentos
  por volumen que la app no enseña.
- **2:** un cliente por encima del 15 % o un HHI por encima de 1.500 es concentración que hay
  que vigilar.
- **3:** la serie que falta para ver tendencia de verdad. Los clientes nuevos de cada mes
  frente al gasto en publicidad de ese mes dan el coste de captación.
- **4:** por encima de 30 días, hay que ponerse con los avisos de cobro.
- **5:** compáralo con el coste por metro configurado. Las compras van a saltos: mira la media
  de tres meses, no un mes suelto.
- **6:** un proveedor por encima del 50 % de su categoría pide un segundo homologado.

**Datos que no están en ninguna tabla y hay que traer de fuera:** gasto en Google Ads y
Metricool por mes y tienda; factura de CTT del mes (coste real por envío); comisiones de la
pasarela y del TPV; horas de trabajo dedicadas a producción; precio de cinco competidores. Con
eso y las consultas, el punto muerto deja de ser un escenario.

---

## 10. Lo que está bien y conviene no tocar

- **Importes y costes congelados por pedido**: el pasado no se reescribe. Es la base de
  cualquier análisis serio.
- **Una definición por cifra con su ⓘ**: evita la discusión de «qué es facturación».
- **Grupos A/B separados por el sistema**, no a mano: el riesgo está en que exista B, no en
  cómo se calcula.
- **Prorrateo de gastos fijos por días** y beneficio «hasta hoy» en periodos en curso: está mejor
  hecho que en la mayoría de cuadros de mando comerciales.
- **Capacidad de la máquina** en el Resumen diario: es el dato que más dice de este negocio hoy.
  Lo subiría al Resumen de Gerencia.
- **Libro de almacén con coste medio y mermas** en textil.

---

## 11. Ficheros

- Creado: `docs/informe-empresa/06-economista.md` (este informe).
- No he tocado ningún otro fichero del repositorio, ni migraciones, ni código. No me he
  conectado a producción.
- Leídos, entre otros: `src/dominio/gerencia.ts`, `margen.ts`, `kpis.ts`, `clientela.ts`,
  `compras.ts`, `metros-woo.ts`, `precio-recomendado.ts`, `definiciones.ts`,
  `src/lib/gerencia.ts`, `src/routes/panel/gerencia.tsx`, `docs/pendiente_auditoria.md` y
  `.pdf`, `docs/informe-empresa/01-contable-fiscal.md`, `docs/rendimiento/plan.md`,
  `docs/escaner-textil/contrato.md` y las nueve capturas.

### Encontrado por el camino (sin arreglar; tareas aparte)

1. `useCosteMetroActual()` (`src/lib/gerencia.ts:182`) lee la primera empresa activa por
   `created_at`, no la del usuario: con una segunda empresa, el coste por metro sería el de
   otra.
2. «€ por metro» y «margen por metro» mezclan metros medidos y estimados (5.2).
3. El Resumen supone envío cobrado = coste del envío; el Resumen diario usa 5 €: dos criterios
   para lo mismo (5.3).
4. `diasMediosCobro` cuenta la web con 0 días y no hay DSO clásico (5.4).
5. La pantalla Facturación enseña variaciones de miles de por cien sobre bases de 14 €
   (captura 4): conviene un umbral de base mínima.
