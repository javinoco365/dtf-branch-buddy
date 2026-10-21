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

## 3. Qué cambia en esta rama

Se va completando en el pull request; cada punto es un commit aparte.

| Punto | Cambio                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 8  | **Menú por tareas** (Inicio · Ventas · Dinero · Tiendas · Textil · Sistema) con nombres claros, sin el selector de tienda repetido; **título de la pantalla en la cabecera** |
| 2, 9  | **Semáforo único de estados**: una regla en `src/dominio/` y un solo componente, en todas las pantallas; etiquetas legibles y con mayúscula                                  |
| 3     | Comparaciones: sin «Sin datos en…»; con base pequeña, «×60» en vez de «5 992 %»                                                                                              |
| 4, 5  | Gerencia: **avisos arriba**, con color por gravedad; barras de objetivo con semáforo                                                                                         |
| 6     | Gráficas solo hasta hoy                                                                                                                                                      |
| 7     | Móvil: cifras en dos columnas, más compactas                                                                                                                                 |
| 9, 10 | Fechas con `src/lib/format.ts`, unidades sin partir, errores para personas con el detalle técnico plegado                                                                    |

## 4. Lo que queda para que lo decidas

Cambian la forma de trabajar, no solo cómo se ve, así que van aparte y con tu visto bueno:

- **Tablero de pedidos** (columnas Pendiente · En marcha · Listo · Enviado) como alternativa a la
  tabla, para el taller.
- **Inicio por perfil** (Gerencia, Taller, Administración), sin enseñar nada que el nivel del
  usuario no permita.
- **La tienda como filtro** en vez de repetir siete pantallas por tienda en el menú, con los
  enlaces viejos redirigidos.
- **Agrupar las once pestañas de Gerencia** en cuatro (Resumen · Ventas y clientes · Dinero ·
  Producción) y llevar «Ajustes» a Ajustes generales.
