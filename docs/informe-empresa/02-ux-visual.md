# 02 · Experiencia de uso y presentación visual

Informe del experto en UX/UI. Fecha: 20-10-2026. Solo diagnóstico y propuesta: **no se ha
cambiado ni una línea de la aplicación.**

## De dónde salen estas conclusiones (y qué no puedo saber)

- **98 capturas**: las 49 pantallas de `pruebas-visuales/capturar.mjs`, a 1440 × 900 (ordenador)
  y 390 × 844 (móvil), más 11 capturas sueltas (menú del móvil, tableta de 820 px y la parte de
  arriba de las pantallas largas en el móvil). Todas con el Supabase de prueba y los **datos
  sintéticos** de `pruebas-visuales/datos.mjs`, ampliados con las proformas de
  `visual-proformas/falso-proformas.mjs`. La fecha está fijada al lunes 5-10-2026.
- Las 9 imágenes que ha mandado Javier (pantallas reales de producción, un ticket y la ficha de
  un pedido en WooCommerce). Las uso para contrastar, pero **no copio aquí ningún nombre de
  cliente real** que salga en ellas.
- El código de `src/`, leído sin tocarlo.

**Límites.** No he visto datos reales de producción ni he medido tiempos reales: los de la
aplicación en modo desarrollo (3–5 s por pantalla al capturar) no sirven para saber la
velocidad real. Con 2 tiendas y 10 clientes de prueba, las tablas largas (un año de pedidos,
cientos de clientes) **no se han visto** con su tamaño real. Tampoco he hablado con el equipo:
lo de que «Javier adora las tablas y el resto entiende mejor lo visual» es la premisa del
encargo, no algo que haya medido.

**Dónde están las capturas.** Todas en
`/tmp/claude-0/-home-user-dtf-branch-buddy/6486619b-6048-50f0-93e1-d917981aeb74/scratchpad/ux/`
(no se suben al repositorio). En el texto se citan así:

| Cita         | Ruta dentro de `…/scratchpad/ux/` |
| ------------ | --------------------------------- |
| `[E:nombre]` | `capturas/escritorio/nombre.png`  |
| `[M:nombre]` | `capturas/movil/nombre.png`       |
| `[X:nombre]` | `extra/nombre.png`                |
| `[J:n]`      | imagen `n` que mandó Javier       |

---

## Resumen para Javier

1. **La base es buena.** Hay cosas que muchos ERP no tienen: el ⓘ que explica cada cifra,
   totales al pie de casi todas las tablas, los pedidos agrupados por día con su subtotal,
   tarjetas en el móvil en vez de tablas cortadas, y estados vacíos honrados («Todo cobrado:
   no hay pedidos pendientes»). Para alguien que piensa en tablas, la app ya habla su idioma.
2. **Lo que más falla es la orientación, no los datos.** 18 entradas de primer nivel en el
   menú (más de 40 con los submenús de cada tienda y del textil), cuatro sitios
   donde están los «ajustes», dos paneles que enseñan casi las mismas cifras («Dashboard
   Global» y «Gerencia › Resumen») y cada tienda repite las pantallas generales con un filtro
   puesto. Quien no es Javier no sabe por dónde entrar.
3. **Faltan semáforos.** Casi todos los estados del pedido se pintan en el mismo gris
   (Procesando, Imprimiendo, Listo, Enviado), «Completado» sale en el mismo azul oscuro que la
   etiqueta «WooCommerce», y los avisos importantes (un pedido de hace 18 días, una deuda de
   proveedor de más de 90 días) se ven igual que todo lo demás. Es lo más barato de arreglar y
   lo que más ayuda al equipo.
4. **El móvil funciona, pero cansa.** Cada cifra ocupa una tarjeta a lo ancho: Gerencia mide
   3 160 px de alto y la primera pantalla solo enseña filtros y **una** cifra. Facturas de
   compra llega a 6 042 px. Los avisos, que es lo que hay que mirar, quedan al final.
5. **Propuesta en tres escalones** (detalle al final): primero semáforos, formatos y textos
   (sin migración, días); luego el conmutador **«Tabla / Visual»** en cuatro pantallas y un
   **inicio por perfil** («Gerencia», «Taller», «Administración»); y por último reordenar el
   menú. Todo encaja con el plan de rendimiento, que va primero: una pantalla bonita y lenta
   no sirve.

---

## Cómo está montada la app

### Navegación

- **Barra lateral con 18 entradas de primer nivel** en cuatro grupos (Global, Tiendas,
  Textil, Sistema) más los submenús de cada tienda (7 entradas cada una), del textil (8) y de
  Gestión de Tiendas (2): más de 40 con dos tiendas. A 900 px de
  alto el final del menú (Usuarios, Ajustes) ya no cabe sin desplazar `[E:inicio]`.
- **Selector de tienda duplicado**: hay un desplegable «Selecciona una tienda…» y justo debajo
  la lista de tiendas con su flecha `[E:tienda-inicio]`. Hacen lo mismo.
- **Nombres que no dicen la tarea**: «Dashboard Global», «Facturación Consolidada», «Pedidos
  Consolidados». Para el equipo, «consolidado» no significa nada; «Pedidos» sí.
- **Cada tienda repite las pantallas globales** (Pedidos, Facturas, Facturación, Cobros,
  Clientes, Productos) con el filtro de tienda ya puesto. Son dos caminos para lo mismo y el
  usuario tiene que saber cuál es «el bueno».
- **«Ajustes» está en cuatro sitios**: «Ajustes generales» `[E:configuracion]`, «Ajustes de la
  tienda» `[E:tienda-ajustes]`, «Textil › Ajustes» y la pestaña «Ajustes» de Gerencia, más
  «Gestión de Tiendas» y «Usuarios» sueltos en el menú.
- **En el móvil no hay título de pantalla** en la cabecera (solo el botón del menú, el tema y
  «Salir») `[M:inicio]`, y el botón del menú es el icono de panel, no las tres rayas que todo el
  mundo reconoce `[X:movil-menu-abierto]`.
- **La etiqueta «Admin»** en Ajustes generales `[E:configuracion]` no aporta nada: los tres
  usuarios son administradores y el único rol que existe es `admin`.

### Consistencia visual

| Qué                | Lo que se ve                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colores de estado  | `estadoVariant()` en `src/components/PedidosTable.tsx:189` solo distingue cuatro casos: entregado (oscuro), cancelado (rojo), pendiente (borde) y **todo lo demás en gris**. `StatusBadge` (`src/components/StatusBadge.tsx`) tiene otra paleta y casi no se usa (2 componentes). |
| Estados en textil  | El desplegable enseña el valor interno: `en_produccion`, `entregado`, `pendiente` `[E:textil-pedidos]`. Y los estados del textil no son los de DTF (`pendiente/en_produccion/listo/enviado/entregado` frente a `pendiente/procesando/imprimiendo/listo/enviado/completado`).      |
| Mayúsculas         | «pagada», «registrada», «borrador», «pendiente» en minúscula `[E:tienda-facturas]` `[E:compras]`; «Procesando», «Completado» con mayúscula en Pedidos.                                                                                                                            |
| Fechas             | Facturas de compra pinta `2026-10-04` (`src/components/compras/PaginaCompras.tsx:796`, sin pasar por `src/lib/format.ts`); el resto de la app, `04/10/2026`.                                                                                                                      |
| Tarjetas de cifra  | Tres estilos: icono a la derecha (Gerencia, Dashboard), icono a la izquierda (panel de tienda `[E:tienda-inicio]`), icono pequeño junto al título (Cobros `[E:cobros]`). Caja usa otro ancho de página y otro margen superior `[E:caja]`.                                         |
| Unidades partidas  | En tablas estrechas, «60,00 / m» y «57,5 / %» se parten en dos líneas `[E:gerencia-ventas]`; «Confianza 64 / %» igual `[E:compras]`.                                                                                                                                              |
| Botones de acción  | Hasta cinco iconos sin texto por fila (Stock `[E:textil-stock]`, Facturas `[E:tienda-facturas]`). El de deshacer es una flecha roja que no dice qué hace.                                                                                                                         |
| Semántica de color | En Conciliación, «Sin saldos» (falta un dato, no es un error) sale en **rojo** y «Cuadra» (lo bueno) en **gris** `[E:conciliacion]`. Al revés de lo que se espera.                                                                                                                |

### Cómo se ven los datos

- **Tablas: buenas.** Totales al pie, números alineados a la derecha, sumatorios por día en
  Pedidos `[E:pedidos]`, desplegable con líneas, direcciones y desglose `[J:3]`. Para Javier,
  esto ya funciona.
- **Gráficos: pocos y poco útiles.** Solo 6 ficheros usan la librería de gráficas. El de «Top productos por
  metros» con un único producto es una barra gigante que no dice nada `[E:inicio]`. Las barras
  diarias de un mes en curso dejan medio gráfico vacío. El de «Cobrado por semana» pinta las
  semanas pasadas en gris y la actual en azul sin leyenda `[E:consolidada]`.
- **Comparaciones que confunden.** Cada tarjeta dice «Sin datos en 1–5 sep 2026» cuando el
  periodo anterior está vacío: en Gerencia sale **once veces** en la misma pantalla
  `[E:gerencia]`. Y cuando el anterior tiene muy poco, el porcentaje se dispara: en producción
  Javier ve «↗ 5992,9 % frente a 1–8 sep 2026» `[J:4]`. Es verdad, pero no informa.
- **Objetivos sin semáforo.** «Objetivo de ventas 101,9 %» y «Objetivo de metros 195 %» tienen
  barra, pero del mismo azul siempre, vayas por delante o por detrás `[E:gerencia]`.
- **Errores técnicos a la vista.** «El lector de facturas ha respondido 400 (tras un
  reintento)» `[J:9]`, «Falta el secreto `facturas_key` en el Vault de Supabase» `[E:compras]`,
  «Falta la variable ANTHROPIC_API_KEY» `[J:1]`, «confianza está fuera de rango». Útiles para
  quien programa, no para quien sube una factura.

### Móvil

- **Lo bueno:** desde la fase de arreglos móviles, las listas grandes pasan a tarjetas
  (Pedidos `[M:pedidos]`, Productos `[M:productos]`, Facturas de compra
  `[X:movil-compras-arriba]`), y en las capturas de 390 px nada se sale por la derecha.
- **Una cifra por pantalla.** Las tarjetas de cifras van de una en una a todo el ancho:
  Dashboard 2 416 px `[M:inicio]`, Gerencia 3 160 px `[M:gerencia]`, Tesorería 4 661 px.
- **Filtros que se comen la pantalla.** En Gerencia, filtros y descripción ocupan la mitad de
  la primera vista; solo se ve **una** cifra sin desplazar `[X:movil-tesoreria-arriba]`.
- **Once pestañas en Gerencia** con desplazamiento lateral: en el móvil se ven cuatro y nada
  indica que haya más `[M:gerencia]`.
- **Tarjetas «etiqueta: valor» de 13 filas** en Stock `[X:movil-stock-arriba]`: siete
  variantes miden 3 170 px. En el almacén lo que se busca es «Camiseta Beagle blanca S → quedan
  18».
- **Los avisos, al final.** En Gerencia, «1 pedido web sin pagar» o «4 proformas sin factura»
  aparecen después de once tarjetas `[M:gerencia]`.

### Tableta y ventana a media pantalla (768–1023 px)

Es el caso que nadie ha mirado y el que peor sale: con el menú abierto, la tabla de Pedidos se
corta a la altura de «Estado» y hay que desplazar dentro de la tabla para ver importes; en la
cabecera, «Gestión multi-tienda» y el correo se montan uno encima del otro
`[X:tableta-pedidos]`. Pasa también con el portátil y el navegador a media pantalla.

---

## Pantalla por pantalla

Lo bueno (✓), lo malo (✗) y la propuesta concreta (→).

### Dashboard Global — `/panel` `[E:inicio]` `[M:inicio]`

- ✓ Selector de periodo común a toda la app; exportar CSV a mano.
- ✗ Repite casi todas las cifras de Gerencia › Resumen con otro diseño. Es la pantalla de
  entrada y no tiene avisos ni nada que hacer.
- → Convertirla en el **inicio por perfil** (ver propuesta B2) y quitar del menú «Dashboard
  Global» como entrada aparte.

### Gerencia — `/panel/gerencia` (11 pestañas) `[E:gerencia]` … `[E:gerencia-ajustes]`

- ✓ La pantalla más trabajada: filtros comunes, ⓘ en todas las cifras, cuenta de resultados
  A/B `[E:gerencia-resultados]`, antigüedad de deudas `[E:gerencia-tesoreria]`, «quién más
  compra» con acumulado de Pareto `[E:gerencia-clientes]`, taller por estado con «el más
  antiguo» en rojo `[E:gerencia-produccion]`. Para Javier es el sitio natural.
- ✗ Once pestañas son demasiadas; «Ajustes» no es un análisis y «Textil» mezcla un negocio con
  vistas temáticas.
- ✗ «Sin datos en…» once veces; porcentajes absurdos con base pequeña `[J:4]`.
- ✗ Los avisos están debajo de las cifras; en móvil, al final de todo.
- ✗ En «Clientes», el mismo cliente sale dos veces si compra por dos canales (web y textil)
  `[E:gerencia-clientes]`. Encaja con «Clientes globales: a medias» del `CLAUDE.md`.
- ✗ «Producción» es lo que el taller necesita, pero está escondido dentro de un panel de
  dirección.
- → **Avisos primero**, arriba del todo y con color por gravedad.
- → Agrupar pestañas: _Resumen · Ventas y clientes · Dinero (cobros, margen, resultados,
  fiscal) · Producción_; «Ajustes» pasa a Ajustes generales.
- → Comparación: no pintar nada si no hay datos en el periodo anterior (el ⓘ ya lo explica), y
  con base pequeña escribir «×60» o «nuevo» en vez de «5992,9 %». La regla, en
  `src/dominio/` con pruebas.
- → Barras de objetivo con semáforo: verde si el ritmo llega, ámbar si se queda corto por
  menos de un 10 %, rojo si no.

### Pedidos — `/panel/pedidos` y `/panel/tiendas/$id/pedidos` `[E:pedidos]` `[M:pedidos]`

- ✓ Agrupado por día con subtotal y metros; columna de metros con «≈ estimado»; documento
  emitido en verde; buen paso a tarjetas en el móvil. Es la mejor pantalla de la app.
- ✗ Estados casi todos en gris: no se distingue de un vistazo qué está parado.
- ✗ La cabecera de columnas se repite en cada día (seis veces en una pantalla).
- ✗ «Completado» y «WooCommerce» comparten el azul oscuro.
- ✗ En tableta, la tabla se corta `[X:tableta-pedidos]`.
- ✗ El desplegable del pedido no enseña los **ficheros de impresión** ni la vista previa del
  diseño que DTFBuild deja en WooCommerce («Ver el diseño», «Descargar ZIP», «Hoja 1 PDF»
  `[J:2]`). En el código solo he visto que de DTFBuild se leen los metros
  (`src/dominio/metros-woo.ts`); no he podido comprobarlo con un pedido real.
- → Semáforo de producción (propuesta A1).
- → Una sola cabecera fija arriba (`sticky`) y los días como filas separadoras.
- → **Vista «Tablero»** como alternativa (propuesta B1): columnas por estado y tarjetas con
  cliente, metros y días de espera.

### Facturación Consolidada — `/panel/facturacion-global` `[E:consolidada]`

- ✓ Desglose por tienda y por método con base, IVA, envíos y propinas: muy completo para quien
  lleva las cuentas.
- ✗ Nombre poco claro (es «lo cobrado», no «lo facturado»: su propio subtítulo lo dice).
- ✗ «Cobrado por semana» sin leyenda; «↘ 85,8 % vs anterior» compara una semana a medias con
  una entera.
- → Renombrar a «Cobros» o «Lo cobrado»; leyenda en el gráfico; no comparar semanas
  incompletas o compararlas a igual número de días, como ya hace el selector de periodo.

### Facturas de compra — `/panel/compras` `[E:compras]` `[X:movil-compras-arriba]` `[J:9]`

- ✓ La cola «Por revisar» con «Qué mirar» en lenguaje claro («La IA duda: el papel dice
  “Pedido”…») es un buen patrón.
- ✗ Fechas en formato `2026-10-04`.
- ✗ Errores técnicos (400, Vault, `ANTHROPIC_API_KEY`).
- ✗ El estado de pago va como texto suelto («Pagada», «Pendiente»), mientras «registrada» va
  en etiqueta oscura: lo que importa (si se debe) se ve menos que lo que no.
- ✗ En el móvil, 6 042 px de alto.
- → Fechas con `src/lib/format.ts`; mensajes de error para personas («No se ha podido leer el
  PDF. Prueba otra vez o dalo de alta a mano») y el detalle técnico en un «ver detalle»;
  semáforo en el pago.

### Archivo — `/panel/archivo` `[E:archivo]`

- ✓ Contadores por tipo arriba y descarga en ZIP: claro.
- ✗ «Se genera al descargar» y «Sin fichero» en el mismo naranja: uno es normal y el otro un
  problema.
- → Gris para «se genera al descargar»; ámbar solo para «sin fichero».

### Cobros pendientes — `/panel/cobros` `[E:cobros]` `[X:movil-cobros-arriba]`

- ✓ Tres cifras claras, «hace 20 días» bajo la fecha, total al pie, buen estado vacío en la
  tienda `[E:tienda-cobros]`.
- ✗ Las filas viejas no destacan; la acción unas veces es «Ver» y otras «Cobrar».
- → Semáforo por antigüedad (≤ 15 días normal, 16–30 ámbar, > 30 rojo, umbrales en
  `src/dominio/`); vista visual de barras por antigüedad (B1).

### Clientes — `/panel/clientes` `[E:clientes]`

- ✓ Una ficha por cliente para toda la empresa, buscador amplio.
- ✗ La tabla no dice nada de negocio: ni lo comprado, ni el último pedido, ni la deuda. Para
  decidir hay que ir a Gerencia › Clientes.
- → Añadir «Comprado (12 meses)», «Último pedido» (con semáforo si pasa de 60 días) y
  «Pendiente», que ya calcula Gerencia.

### Productos generales — `/panel/productos` `[M:productos]`

- ✓ Corta y clara; buena tarjeta en el móvil.
- Sin cambios necesarios.

### Conciliación bancaria — `/panel/conciliacion` `[E:conciliacion]`

- ✓ Verde / a revisar / traspasos con contadores, explicación al pie.
- ✗ Colores invertidos («Sin saldos» rojo, «Cuadra» gris). El alta de cuenta está siempre
  abierta en medio de la pantalla.
- → «Cuadra» en verde, «Sin saldos» en gris o ámbar; el alta de cuenta detrás de un botón
  «Añadir cuenta».

### Caja — `/panel/caja` `[E:caja]` e Inversión — `/panel/inversion`

- ✓ Ingresos en verde y gastos en rojo, aporte por socio: claro.
- ✗ Otro ancho y otro margen de página que el resto.
- → Usar el mismo contenedor de página que las demás.

### Panel de tienda — `/panel/tiendas/$id` `[E:tienda-inicio]`

- ✗ Sin título (no pone de qué tienda es), sin selector de periodo, mezcla «del mes» con
  «totales» y otro estilo de tarjeta. El plan de rendimiento ya avisa de que estas cifras se
  cortan en 1 000 filas.
- → Sustituir por Gerencia filtrada a esa tienda, o como mínimo título, selector de periodo y
  la tarjeta común.

### Facturas de tienda — `/panel/tiendas/$id/facturas` `[E:tienda-facturas]`

- ✓ Aviso de «3 documentos sin PDF» con botón para generarlos.
- ✗ Cinco iconos sin texto; «pagada» en minúscula y del color de «WooCommerce».
- → Dejar uno o dos iconos y el resto en el menú «⋮», como ya hace Pedidos.

### Ajustes de la tienda — `/panel/tiendas/$id/ajustes` `[E:tienda-ajustes]`

- ✗ Mezcla ajustes con **herramientas de diagnóstico** («Qué trae WooCommerce en las líneas»,
  «De dónde sale el número de pedido», «Recuperar envíos»). Dos botones de guardar distintos
  («Guardar credenciales» y «Guardar cambios», este último fuera de las tarjetas).
- → Una pestaña «Diagnóstico» aparte; un único «Guardar» visible al cambiar algo.

### Tiendas — `/panel/tiendas` `[E:tiendas]`

- ✓ Tarjeta por tienda con estado de sincronización.
- ✗ «Borrar» al lado de «Editar», con el mismo peso.
- → «Borrar» dentro de «⋮» o en la ficha, con confirmación.

### Textil — `/panel/textil/*` `[E:textil-inicio]` `[E:textil-pedidos]` `[E:textil-stock]`

- ✓ Stock con «Disponible 4» en rojo bajo mínimo: el único semáforo real de la app.
- ✗ El inicio de textil es un índice de botones con contadores; «este mes» compara solo el mes
  sin el año (lo recoge el plan de rendimiento).
- ✗ Estados en jerga interna (`en_produccion`).
- ✗ En Stock, el total «Coste 382,40 €» al pie de una columna de coste **unitario** no se
  entiende (¿es el valor del stock?).
- ✗ En el móvil, tarjetas de 13 filas `[X:movil-stock-arriba]`.
- → Etiquetas legibles y colores del mismo semáforo que DTF; renombrar el pie a «Valor del
  stock»; tarjeta de stock compacta con barra «disponible frente a mínimo».

### Ajustes generales, Usuarios, PDF, Empresa — `[E:configuracion]` `[E:configuracion-pdf]` …

- ✓ Ordenados en tarjetas con descripción.
- ✗ Repartidos con los otros tres «Ajustes».
- → Un único **Ajustes** con secciones: Empresa · Tiendas · Textil · Gerencia (objetivos,
  jornada) · Caja · PDF · Usuarios.

---

## Propuesta priorizada

Orden pensado para que cada paso sirva solo, y respetando el `CLAUDE.md`: lógica de colores,
umbrales y comparaciones en `src/dominio/` con pruebas; formato con `src/lib/format.ts`; los
arreglos móviles con `max-md:` / `md:hidden` para que el ordenador no cambie (salvo donde se
diga lo contrario, y entonces con el antes y el después en capturas).

**Antes que nada: la rapidez.** El plan de `docs/rendimiento/plan.md` va primero. Lo que
añade la parte visual a ese plan, y no está en él:

- **Esqueletos en vez de «Cargando…».** Hay 29 ficheros con un «Cargando…» de texto y solo 10
  usan `Skeleton`. Un esqueleto con la forma de la tabla hace que la espera se note menos.
- **Mantener las cifras anteriores al cambiar de periodo** (atenuadas) en vez de vaciar la
  pantalla. Encaja con la fase 4 (caché) del plan.
- **Cambio de estado al momento** (actualización optimista): el desplegable de estado de un
  pedido cambia de color al tocarlo y se deshace si falla.
- Medir las mejoras visuales con el mismo protocolo de la fase 0 del plan.

### A · Rápido, sin migración, mucho efecto (días)

| #   | Qué                                                                                                                                                                                                                                                                                                                                                                | Dónde                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| A1  | **Semáforo único de estados.** Una función pura `nivelEstado(estado) → "espera" \| "en_marcha" \| "listo" \| "hecho" \| "problema"` en `src/dominio/` y un solo componente que la pinta. Pendiente gris, Procesando/Imprimiendo azul, Listo ámbar (hay que sacarlo), Enviado/Completado/Entregado verde, Cancelado rojo. Textil con las mismas etiquetas legibles. | Pedidos, Textil, Facturas, Compras, Conciliación          |
| A2  | **Semáforo por antigüedad**: «el que más espera», cobros y deudas de proveedor con umbrales configurables en Gerencia › Ajustes.                                                                                                                                                                                                                                   | Cobros, Producción, Tesorería                             |
| A3  | **Comparaciones sensatas**: sin «Sin datos en…» repetido; con base pequeña, «×60» o «nuevo».                                                                                                                                                                                                                                                                       | `TarjetaKpi` (`LineaVariacion`) + regla en `src/dominio/` |
| A4  | **Formatos**: fechas de Compras con `format.ts`; `whitespace-nowrap` en «m», «%» y «€»; mayúscula inicial en todas las etiquetas de estado.                                                                                                                                                                                                                        | Compras, Gerencia › Ventas, Facturas                      |
| A5  | **Errores para personas** con el detalle técnico plegado.                                                                                                                                                                                                                                                                                                          | Compras (lector de facturas), sincronización              |
| A6  | **Móvil**: cifras en 2 columnas y más compactas; filtros plegados en una sola línea («Octubre 2026 · Todas ▾»); avisos arriba en Gerencia; tarjeta de stock compacta.                                                                                                                                                                                              | Dashboard, Gerencia, Stock (solo `max-md:`)               |
| A7  | **Tableta 768–1023 px**: menú plegado a iconos por defecto en ese ancho; correo de la cabecera oculto.                                                                                                                                                                                                                                                             | `AppShell`, `AppSidebar`                                  |
| A8  | **Gerencia**: avisos arriba; barras de objetivo con semáforo.                                                                                                                                                                                                                                                                                                      | Gerencia › Resumen                                        |

### B · El conmutador «Tabla / Visual» y el inicio por perfil (1–2 semanas)

**B1. Conmutador «Tabla / Visual»** en la cabecera de cada pantalla que lo merezca, con dos
botones (icono de tabla e icono de tarjetas) que recuerdan la elección **por usuario y por
pantalla**. La tabla sigue siendo la de hoy (para Javier no cambia nada si no lo toca).

| Pantalla           | Vista «Visual»                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pedidos            | **Tablero por estado** (Pendiente · En marcha · Listo · Enviado), una tarjeta por pedido con cliente, metros, días de espera en semáforo y botón de pasar al siguiente estado. |
| Cobros             | Barras por antigüedad (verde, ámbar, rojo) y tarjetas de los diez más grandes.                                                                                                 |
| Stock textil       | Tarjeta por prenda con barra «disponible frente a mínimo» en semáforo.                                                                                                         |
| Gerencia › Resumen | Ya es visual; la vista «Tabla» sería una sola tabla con cifra, periodo anterior y variación, que es lo que Javier exporta a mano hoy.                                          |

Dónde guardar la preferencia, en dos pasos:

1. **Primero en el navegador** (`localStorage`, envuelto en `try/catch`, con «Tabla» por
   defecto si falla). Es una comodidad personal y el `CLAUDE.md` lo permite para eso. Pega: no
   se comparte entre el ordenador y el móvil del mismo usuario.
2. **Después, si se quiere que siga al usuario a cualquier dispositivo**, una tabla
   `preferencias_usuario (empresa_id, usuario_id, clave, valor jsonb, actualizado_en
timestamptz)` con `UNIQUE (usuario_id, clave)`, RLS por operación (cada uno lee y escribe
   solo lo suyo; **sin `FOR ALL`**) y el trigger de auditoría, como toda tabla nueva. Migración
   solo como fichero, con su reversión y su prueba; la aplica Javier. **No la he escrito.**

**B2. Inicio por perfil.** El «perfil» es una **preferencia de presentación**, no un permiso:
los tres usuarios siguen siendo administradores con acceso a todo, y cualquiera puede cambiar
de perfil desde el propio inicio.

| Perfil             | Qué ve al entrar                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gerencia**       | Avisos en semáforo, una tabla resumen del periodo (vendido, cobrado, margen, beneficio, frente al anterior) y accesos a las pestañas de Gerencia. Pensado para Javier.                                                                                      |
| **Taller**         | «Hoy»: metros por hacer frente a la capacidad del día (`metros_hora` × jornada, que ya existen en Gerencia › Ajustes), pedidos que entraron después de la hora de corte, el que más espera, y el tablero de Pedidos. Botones grandes, sin cifras de dinero. |
| **Administración** | Cobros vencidos, facturas de compra por revisar, documentos sin PDF, movimientos del banco sin casar y el próximo impuesto con su plazo.                                                                                                                    |

Todo lo que enseñan estos inicios ya se calcula hoy en Gerencia (Producción, Tesorería, Avisos,
Resultados): es reordenar, no calcular de nuevo. Si alguna cifra no tiene datos, estado vacío,
nunca un número de ejemplo.

**B3. Ficheros de impresión en el pedido** (vista previa del diseño y enlaces de DTFBuild),
si la API los devuelve. Antes hay que comprobar con un pedido real qué trae `meta_data`.

### C · Reordenar la navegación (cuando B esté asentado)

Menú por tareas, en seis grupos y sin submenús repetidos por tienda:

```
Inicio            (el del perfil)
Ventas            Pedidos · Presupuestos · Clientes · Cobros
Taller            Tablero · Stock textil · Compras de textil
Dinero            Facturas emitidas · Facturas de compra · Caja · Banco · Inversión · Archivo
Análisis          Gerencia
Ajustes           (uno solo, con secciones)
```

- La **tienda pasa a ser un filtro** (que se recuerda) en cada pantalla, no un árbol que repite
  las pantallas. El textil, un «canal» más en ese filtro; sus pantallas propias (stock,
  marcas) se quedan en «Taller» y «Ajustes».
- En el móvil, una **barra inferior** con cuatro accesos (Inicio, Pedidos, Cobros, Menú) y el
  título de la pantalla en la cabecera.
- Los enlaces viejos (`/panel/tiendas/$id/pedidos`, etc.) redirigen a la pantalla nueva con el
  filtro puesto, para no romper marcadores.

Esto cambia la vista de ordenador a propósito: va en su propia rama, con capturas de antes y
después de todas las pantallas para que Javier lo vea antes de aceptarlo.

---

## Encontrado por el camino (sin arreglar)

1. **«Clientes globales» se nota en pantalla**: el mismo cliente aparece dos veces en Gerencia
   › Clientes si compra por web y por textil `[E:gerencia-clientes]`.
2. **«Días medios de cobro: 0,0 días»** en Tesorería `[E:gerencia-tesoreria]` con pedidos
   cobrados en parte durante días: puede ser correcto con estos datos de prueba, pero merece
   una comprobación con datos reales.
3. **Error de carga de la página en producción** `[J:8]` («This page didn't load»): no he podido
   reproducirlo con los datos de prueba. Encaja con el `__exportAll is not a function` que
   describe el `CLAUDE.md`, pero sin el registro del servidor no puedo confirmarlo.
4. El clic para desplegar un pedido en la tabla de ordenador no respondió al botón que probé
   en la captura automática `[X:escritorio-pedido-desplegado]`; puede ser mi selector y no un
   fallo. Lo dejo anotado para comprobarlo a mano.
5. Tickets sin cliente salen como «—» en Facturas y Archivo; una etiqueta «Venta de mostrador»
   se entendería mejor.
