# 08 · Usabilidad y lectura de un vistazo

**Para:** Javier (DTI S.L.)
**Fecha:** 21-10-2026
**Pregunta:** ¿se entiende la aplicación de un vistazo y se usa sin esfuerzo? ¿Qué se mejora ya?

Parte del informe `02-ux-visual.md` (20-10), que sigue valiendo pantalla por pantalla, y lo
contrasta con la aplicación de hoy. Este documento dice qué pesa más, qué se ha cambiado en esta
rama y qué queda para que lo decidas tú.

---

## 0. Respuesta corta

Los datos están bien y las tablas son buenas (totales al pie, agrupado por día, el ⓘ de cada
cifra). Lo que cuesta es **orientarse y ver de un golpe lo que importa**:

1. **El menú no dice por dónde entrar.** Doce entradas seguidas bajo «Global / Consolidado», sin
   orden de tarea, con nombres que no dicen qué hay dentro («Dashboard Global», «Facturación
   Consolidada», «Pedidos Consolidados»), y el selector de tienda repetido.
2. **Los estados no tienen semáforo.** Procesando, Imprimiendo, Listo y Enviado salen en el mismo
   gris; «Completado» en el mismo azul oscuro que la etiqueta «WooCommerce», que pesa más que el
   propio estado. En Facturas de compra, lo que importa (si se debe) es texto suelto y lo que no
   (`registrada`) va en etiqueta oscura.
3. **Ruido en las cifras.** «Sin datos en 1–5 sep 2026» sale ocho veces en la misma pantalla; las
   barras de objetivo son siempre del mismo azul, vayas por delante o por detrás; las gráficas
   dibujan los días que aún no han llegado (medio gráfico vacío).
4. **Lo urgente, abajo.** En Gerencia, los avisos van después de once tarjetas; en el móvil, al
   final de 3 100 px.
5. **El móvil cansa.** Una cifra por pantalla y los filtros ocupando un tercio de la primera vista.
6. **Detalles que restan confianza.** Fechas `2026-10-04` en Compras, «Confianza 72 / %» partido
   en dos líneas, errores en jerga («Falta el secreto `facturas_key` en el Vault»).

## 1. Cómo se ha mirado

- `pruebas-visuales/capturar.mjs` con el Supabase de prueba y los datos sintéticos de
  `pruebas-visuales/datos.mjs` (ningún dato real): las 49 pantallas a 1440 × 900 (ordenador),
  390 × 844 (móvil) y 820 × 1180 (tablet), 147 capturas. Las capturas no se suben al
  repositorio; se regeneran con el mismo script.
- El código de la interfaz (`src/components`, `src/routes`): dónde se pintan estados, fechas,
  esperas y errores.
- Criterios: que lo urgente se vea primero, que el color signifique siempre lo mismo, que cada
  pantalla diga dónde estás y que el texto lo entienda quien no programa.

## 2. Diagnóstico, por peso

| #   | Qué falla                                    | Dónde se ve                                         | Por qué molesta                                                                   |
| --- | -------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Menú sin agrupar por tarea, nombres opacos   | Barra lateral, todas las pantallas                  | Quien no es Javier no sabe dónde está «lo cobrado» ni dónde está «lo que se debe» |
| 2   | Estados casi todos grises                    | Pedidos, Textil, Facturas, Compras, Presupuestos    | No se ve qué está parado ni qué hay que sacar                                     |
| 3   | «Sin datos en…» repetido y % absurdos        | Inicio, Gerencia (8 veces por pantalla)             | Ruido que tapa las cifras; «+5 992 %» no informa                                  |
| 4   | Avisos debajo de las cifras                  | Gerencia › Resumen                                  | Lo único que pide actuar es lo último que se ve                                   |
| 5   | Objetivos sin color                          | Gerencia › Resumen                                  | Hay que leer el texto pequeño para saber si vas bien                              |
| 6   | Gráficas con días futuros                    | Inicio, Gerencia                                    | Medio gráfico vacío; las barras reales salen apretadas a la izquierda             |
| 7   | Móvil: una cifra por pantalla, filtros altos | Inicio, Gerencia, Cobros y tesorería                | Para ver cuatro cifras hay que desplazar cuatro pantallas                         |
| 8   | Sin título de pantalla en la cabecera        | Móvil (el título se va al desplazar), tiendas       | En una tienda no se sabe en cuál estás; el botón del menú no son las tres rayas   |
| 9   | Fechas ISO, unidades partidas, minúsculas    | Facturas de compra, Gerencia › Ventas, Facturas     | Parece otro programa dentro del programa                                          |
| 10  | Errores en jerga técnica                     | Lector de facturas, sincronización, avisos de error | Quien sube una factura no sabe qué hacer con «Vault» o «fuera de rango»           |

## 3. Qué ha cambiado en esta rama

Un commit por punto. Todo es interfaz: sin migraciones ni cambios de datos ni de servidor.

| Punto | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 8  | **Menú por tareas**: Inicio y Gerencia arriba; Ventas; Dinero; Tiendas; Textil; Sistema. «Dashboard Global» pasa a «Inicio», «Pedidos Consolidados» a «Pedidos», «Facturación Consolidada» a «Lo cobrado». Fuera el desplegable de tienda repetido. La cabecera dice dónde estás («Dinero › Lo cobrado», «Tienda Uno › Facturas») y en el móvil el botón del menú son las tres rayas. Un solo mapa (`src/dominio/navegacion.ts`) para menú y cabecera |
| 2, 9  | **Semáforo único de estados** (`src/dominio/estados.ts` + `EtiquetaEstado`): gris lo que no pide nada, azul en marcha, ámbar hay que hacer algo, verde terminado, rojo torcido. En Pedidos, Textil, Facturas, Presupuestos, Compras, Conciliación y Archivo. «WooCommerce» pasa a texto discreto                                                                                                                                                      |
| 2     | **Facturas de compra**: la columna Estado dice si se debe («Por pagar» / «Pagada»). Antes el botón de cada fila, que es una acción, decía «Pagada» en las que estaban sin pagar; ahora dice «Marcar pagada» / «Marcar por pagar»                                                                                                                                                                                                                      |
| 3     | Sin «Sin datos en…» en cada tarjeta; con base pequeña, «×61» en vez de «+5 992,9 %»                                                                                                                                                                                                                                                                                                                                                                   |
| 4, 5  | Gerencia › Resumen: **avisos lo primero**, con color por gravedad; barras de objetivo verde / ámbar / rojo                                                                                                                                                                                                                                                                                                                                            |
| 6     | Gráficas del periodo en curso hasta hoy; «Top productos por metros» como lista con barra                                                                                                                                                                                                                                                                                                                                                              |
| 7     | Móvil: cifras dos por fila en todas las pantallas; en Gerencia, filtros plegados en una línea y aviso de que hay más pestañas. Gerencia › Resumen pasa de 3 112 a unos 1 700 px de alto                                                                                                                                                                                                                                                               |
| 8     | Panel de cada tienda con título, «Este mes» y «Desde el principio» separados, y las tarjetas de siempre                                                                                                                                                                                                                                                                                                                                               |
| 9     | Fechas `02/10/2026` en los avisos de compras, unidades que no se parten («57,5 %», «12,50 m»), «Venta de mostrador» en los tickets sin cliente                                                                                                                                                                                                                                                                                                        |
| 10    | **Errores para personas** (`src/dominio/errores.ts`): los técnicos («Failed to fetch», «row-level security», «duplicate key»…) se dicen en llano y con qué hacer, con el original en pequeño debajo. En 103 avisos y en los errores de las pantallas. El lector de facturas explica qué hacer y pliega el detalle técnico                                                                                                                             |

## 4. Qué probar a mano

1. **Menú**: en el ordenador, los grupos Ventas, Dinero, Tiendas, Textil y Sistema; al entrar en
   una tienda, la cabecera dice «Tienda X › Pantalla» y su entrada se ve marcada en el menú.
2. **Pedidos**: cada estado con su color; el desplegable del estado sigue cambiándolo.
3. **Facturas de compra**: una compra sin pagar dice «Por pagar» y el botón «Marcar pagada»;
   al pulsarlo pide la fecha y pasa a «Pagada».
4. **Gerencia** en el móvil: arriba, la línea de filtros («Octubre 2026 · Todas las tiendas»),
   que se despliega al tocarla; debajo, los avisos y las cifras de dos en dos.
5. **Un error**: sin conexión (modo avión) y pulsando guardar en cualquier sitio, el aviso dice
   «No hay conexión con el servidor…», no «Failed to fetch».

## 5. Lo que queda

**Para que lo decidas** (cambian la forma de trabajar, no solo cómo se ve):

- **Tablero de pedidos** (columnas Pendiente · En marcha · Listo · Enviado) como alternativa a la
  tabla, para el taller.
- **Inicio por perfil** (Gerencia, Taller, Administración), sin enseñar nada que el nivel del
  usuario no permita.
- **La tienda como filtro** en vez de repetir siete pantallas por tienda en el menú, con los
  enlaces viejos redirigidos.
- **Agrupar las once pestañas de Gerencia** en cuatro (Resumen · Ventas y clientes · Dinero ·
  Producción) y llevar «Ajustes» a Ajustes generales.

**Retoques pendientes** (sin decisión, en una rama aparte):

- Pedidos: una sola cabecera de columnas fija en vez de repetirla en cada día.
- Facturas de tienda: la flecha roja de anular sin texto, mejor dentro de un menú «⋮».
- Conciliación: el alta de cuenta, detrás de un botón «Añadir cuenta».
- Tiendas: «Borrar» no al lado de «Editar» con el mismo peso.
- Caja e Inversión: el mismo ancho y margen de página que el resto.
- Pedidos en el móvil: los filtros plegados como en Gerencia.
