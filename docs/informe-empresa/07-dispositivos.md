# 07 · La aplicación en todos los dispositivos

**Para:** Javier (DTI S.L.)
**Fecha:** 21-10-2026
**Punto de vista:** diseño adaptable (móvil, tablet, portátil y ordenador)
**Pregunta:** ¿se puede trabajar con el CRM en cualquier pantalla?

---

## 0. Respuesta corta

**En el móvil ya se podía trabajar, y en el ordenador de 1440 no cambia nada. El problema
estaba en la tablet.** La barra lateral ocupaba 256 px fijos: en una tablet en vertical
(820 px) dejaba 564 px para el contenido, y las tablas de Pedidos, Cobros, Stock o Compras se
salían por la derecha. Las pestañas de Gerencia se cortaban (en vertical no se veían
«Producción», «Margen» ni las siguientes, y en horizontal faltaba «Ajustes»). En un portátil de
1366 la tabla de Pedidos se desplazaba de lado por 44 px.

Ahora:

- Por debajo de 1280 px la barra lateral es un **cajón** que se abre con el botón de arriba a
  la izquierda y se cierra solo al elegir una pantalla. El contenido gana todo el ancho.
- En la tablet en vertical, **Pedidos sale en tarjetas a dos columnas**, y Cobros, Stock textil,
  Pedidos textil y Facturas de compra, en tarjetas de una fila por dato.
- En el portátil de 1366 la tabla de Pedidos cabe sin barra horizontal.
- **Ningún diálogo se sale ya de la pantalla**: si no cabe, se desplaza por dentro. Antes,
  «Nuevo artículo» de Stock medía 914 px y en un ordenador de 900 px de alto el botón de guardar
  quedaba fuera.
- Los ⓘ, las casillas y los interruptores tienen una **zona táctil más grande** en pantallas de
  dedo, sin cambiar cómo se ven.

Las 49 pantallas a 1440 × 900 y a 1920 × 1080 salen **idénticas píxel a píxel** antes y después
(la única diferencia que salió, la vista previa del PDF, es ruido: repetida, sale igual).

## 1. Cómo se ha mirado

- `pruebas-visuales/capturar.mjs` ampliado con `--tamanos todos`: 49 pantallas en 7 tamaños,
  343 capturas antes y 343 después, con el Supabase de prueba y los datos sintéticos de
  `pruebas-visuales/datos.mjs` (más las proformas de `visual-proformas/falso-proformas.mjs`).
  Ningún dato real.
- Un medidor aparte que, en cada pantalla y tamaño, lista las tablas que se desplazan de lado,
  lo que sale por la derecha de la ventana y los botones de menos de 24 px.
- Ocho diálogos abiertos en seis tamaños (Nuevo usuario, Nuevo pedido de tienda y textil, Nuevo
  artículo, Factura de compra a mano, Facturar, Nuevo presupuesto, Resumen diario), midiendo si
  caben.
- El cajón del menú, abierto y navegando, en móvil, tablet vertical, tablet horizontal y
  portátil.

| Nombre          | Tamaño      | Qué es                |
| --------------- | ----------- | --------------------- |
| `movil`         | 390 × 844   | Móvil                 |
| `movil-pequeno` | 360 × 780   | Móvil Android pequeño |
| `tablet-v`      | 820 × 1180  | Tablet en vertical    |
| `tablet-h`      | 1180 × 820  | Tablet en horizontal  |
| `portatil`      | 1366 × 768  | Portátil              |
| `escritorio`    | 1440 × 900  | Ordenador             |
| `grande`        | 1920 × 1080 | Pantalla grande       |

Capturas (no se suben al repositorio):
`/tmp/claude-0/-home-user-dtf-branch-buddy/6486619b-6048-50f0-93e1-d917981aeb74/scratchpad/dispositivos/`
— `antes/<tamaño>/`, `despues/<tamaño>/`, `dialogos/` y `dialogos2/` (diálogos),
`cajon-*.png` (menú), `medir-antes.log` y `medir-2.log` (medidas).

## 2. Lo que se veía mal y cómo queda

### Tablet en vertical (820 px)

| Pantalla                          | Antes                                                          | Ahora                                     |
| --------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Todas                             | Barra lateral fija de 256 px; 564 px para el contenido         | Cajón; 772 px                             |
| Pedidos (consolidados y tienda)   | Tabla de 1104 px en 514: Estado cortado, resto fuera           | Tarjetas a dos columnas, total en tarjeta |
| Gerencia (13 vistas)              | Pestañas cortadas a partir de «Producción»                     | Las pestañas pasan a dos líneas           |
| Cobros pendientes                 | Tabla de 802 px; «Ver» y «Cobrar» cortados                     | Tarjetas                                  |
| Stock textil                      | Tabla de 881 px; filas de 200 px (cinco botones uno bajo otro) | Tarjetas                                  |
| Pedidos textil                    | Tabla de 808 px                                                | Tarjetas                                  |
| Facturas de compra (lista)        | Tabla de 805 px                                                | Tarjetas                                  |
| Compras, Archivo, Caja, Usuarios… | Tablas de 550–650 px en 466–514                                | Caben en los 772 px                       |
| Cabecera                          | «Gestión multi-tienda» y el correo montados uno sobre otro     | Se leen los dos                           |

### Tablet en horizontal (1180 px)

- Barra lateral: ahora también es cajón (corte en 1280). Con ella fija quedaban 924 px y la
  tabla de Pedidos se desplazaba 230 px de lado; sin ella caben los 1104 px.
- Gerencia: «Ajustes» quedaba fuera de la fila de pestañas. Arreglado con el ancho que gana.

### Portátil (1366 px)

- Pedidos: la tabla (1104 px) no cabía en los 1060 que deja la barra. Por debajo de 1440,
  Total, Cobrado y Pendiente bajan de 112 a 96 px y la tabla a 1056: cabe. En 1440 sigue igual.
- Stock textil: los cinco botones de cada fila se partían en dos líneas y cada fila medía el
  doble. Ahora van en una línea (en 1440 ya iban en una; no cambia).

### Móvil (390 y 360 px)

- **Selector de periodo vacío** en Pedidos textil, Presupuestos textil, Facturas, Archivo… : con
  «Todo» elegido el desplegable se quedaba en una cajita de 30 px sin texto. Ahora ocupa su fila.
- Presupuestos textil: el botón «Nuevo presupuesto» se salía 32 px por la derecha. Ahora baja
  debajo del título.
- Pedidos a 360 px: la cabecera de un día con cancelados («+ 1 cancelado») se cortaba 8 px.
  Ahora se parte en dos líneas.
- Factura de compra a mano: el diálogo medía 458 px de ancho en una pantalla de 390 y había que
  desplazarlo de lado. Arreglado para todos los diálogos (ver abajo).
- El menú del móvil **no se cerraba al elegir una pantalla**: había que cerrarlo a mano. Ahora
  se cierra solo (también en la tablet).

### Diálogos (todos los tamaños)

`DialogContent` no tenía alto máximo. Los que lo ponían a mano (`max-h-[90vh]`) estaban bien;
unos 20 no. Con datos de prueba, «Nuevo artículo» de Stock mide 914 px y no cabía ni en el
ordenador de 900 (ni en el portátil de 768 ni en la tablet en horizontal). Ahora todo diálogo mide como mucho el alto de la pantalla menos 2 rem y se desplaza por
dentro, y su contenido no puede ser más ancho que el propio diálogo.

### Objetivos táctiles

Lo más repetido por debajo de 24 px: los ⓘ de las cifras (16 × 16, unas 100 veces en las 49
pantallas), los interruptores (36 × 20) y las casillas (16 × 16). Con puntero de dedo
(`pointer: coarse`) llevan una zona de toque invisible alrededor; con ratón no cambia nada.

## 3. Qué se ha cambiado (ficheros)

| Fichero                                                     | Qué                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/ui/sidebar.tsx`, `src/hooks/use-mobile.tsx` | Barra lateral en cajón por debajo de 1280 (`xl:`)                                       |
| `src/components/AppSidebar.tsx`                             | El cajón se cierra al navegar; en el cajón el menú sale siempre entero                  |
| `src/components/ui/table.tsx`, `src/styles.css`             | `movil="tarjetas-tablet"`: tarjetas también de 768 a 1023 px                            |
| `src/hooks/use-es-movil.ts`                                 | `useEsMovil(CONSULTA_TABLET)` para montar una sola vista hasta 1023 px                  |
| `src/components/PedidosTable.tsx`                           | Tarjetas hasta 1023 (dos columnas en la tablet); columnas más justas por debajo de 1440 |
| `src/components/ui/dialog.tsx`                              | Alto máximo y desplazamiento dentro; una columna que no se ensancha                     |
| `src/components/filtros/SelectorPeriodo.tsx`                | Fila entera en el móvil                                                                 |
| `src/routes/panel/gerencia.tsx`                             | Pestañas en dos líneas de 768 a 1023                                                    |
| Cobros, Stock, Pedidos textil, Facturas de compra           | Sus tablas, `tarjetas-tablet`; botones de Stock en una línea                            |
| `src/routes/panel/textil/presupuestos.tsx`                  | La cabecera se parte en el móvil                                                        |
| `ui/switch.tsx`, `ui/checkbox.tsx`, `Explicacion.tsx`       | Zona táctil con dedo                                                                    |
| `pruebas-visuales/capturar.mjs`, `comparar.mjs`, `LEEME.md` | Siete tamaños, aviso de desborde, comparar cualquier tamaño                             |

Sin migraciones, sin cambios de datos ni de servidor.

## 4. Qué probar a mano

1. En una tablet (o el navegador a 820 px): el botón de arriba a la izquierda abre el menú;
   al tocar «Pedidos» se cierra y Pedidos sale en tarjetas a dos columnas. Abrir el detalle de
   una tarjeta, cobrar y emitir ticket desde el menú «⋮».
2. Girar la tablet: a 1180 px la lista de Pedidos es la tabla de siempre, entera.
3. En un portátil de 1366: Pedidos sin barra horizontal bajo cada día.
4. En el ordenador de 1440: la barra lateral está fija como siempre y nada se ha movido.
5. Stock textil → «Nuevo artículo» en un ordenador de 900 px de alto: el botón de guardar se
   alcanza desplazando el diálogo.
6. En el móvil: Pedidos textil con periodo «Todo» muestra el desplegable con su texto.

## 5. Lo que queda (sin arreglar)

- **Ventanas de 1280 a 1365 px** (portátiles pequeños o el navegador sin maximizar) tienen la
  barra lateral fija y la tabla de Pedidos (1056 px) no cabe en los ~976 que quedan: se desplaza
  de lado. No está entre los tamaños pedidos; arreglarlo pide decidir qué columna sobra
  (Origen o Cobrado).
- El botón del menú dice «Toggle Sidebar» a los lectores de pantalla (texto de shadcn en
  inglés). El botón que abre el menú mide 28 px.
- Las cifras con «Ver →» y el botón del documento emitido en las tarjetas de Pedidos miden
  16–22 px de alto. Se tocan, pero justos.
- La vista previa del PDF de presupuestos y la cinta de lemas del diseñador se salen de su caja
  a propósito (están recortadas): el medidor las marca, pero no son un fallo.
- Las pestañas de Gerencia en el móvil se desplazan de lado sin indicarlo (no hay sombra ni
  flecha). Ya era así.
- Solo se ha visto con datos de prueba (2 tiendas, 10 clientes). Nombres de cliente muy largos
  o cien pedidos por día no se han probado en la tablet.
