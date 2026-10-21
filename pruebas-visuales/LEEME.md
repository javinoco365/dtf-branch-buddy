# Pruebas visuales

Capturas automáticas de todas las pantallas del panel, a tamaño ordenador
(1440 × 900) y a tamaño móvil (390 × 844), con datos fijos. Sirven para una
cosa: **comprobar que un cambio pensado para el móvil no mueve ni un píxel en
el ordenador.**

Nada de esto habla con la base de datos real. La aplicación arranca contra un
Supabase de mentira que sirve los datos de `datos.mjs` y responde «hecho» a
cualquier alta o cambio sin guardar nada.

## Piezas

| Fichero              | Qué hace                                                            |
| -------------------- | ------------------------------------------------------------------- |
| `datos.mjs`          | Los datos de prueba: empresa, dos tiendas, clientes, pedidos, etc.  |
| `supabase-falso.mjs` | Un servidor que imita a Supabase (sesión, tablas y `rpc`) con ellos |
| `capturar.mjs`       | Abre cada pantalla en Chromium y guarda la captura                  |
| `comparar.mjs`       | Compara dos tandas de capturas píxel a píxel                        |

Los datos son inventados y no se parecen a ningún cliente real a propósito
(«Tienda Uno», `cliente1@ejemplo.com`, CIF `B00000000`).

## Cómo se usa

Necesita Playwright y Chromium. No están en `package.json` para no engordar la
instalación de todo el mundo; donde no estén, `npx playwright install chromium`.
Si ya hay un Chromium instalado, se le indica con `CHROMIUM_PATH` y, si
Playwright está fuera del proyecto, con `PLAYWRIGHT_MODULE` (la ruta a su
`index.mjs`).

1. Un `.env` que apunte al Supabase de prueba (no se sube nunca a git):

   ```sh
   VITE_SUPABASE_URL=http://localhost:54399
   VITE_SUPABASE_PROJECT_ID=prueba
   VITE_SUPABASE_PUBLISHABLE_KEY=clave-de-prueba
   SUPABASE_URL=http://localhost:54399
   SUPABASE_PROJECT_ID=prueba
   SUPABASE_PUBLISHABLE_KEY=clave-de-prueba
   SUPABASE_SERVICE_ROLE_KEY=clave-de-prueba
   ```

2. En una terminal, el Supabase de prueba:

   ```sh
   node pruebas-visuales/supabase-falso.mjs 54399
   ```

3. En otra, la aplicación:

   ```sh
   npx vite dev --host localhost --port 8090
   ```

4. Capturas del código **antes** del cambio (en `main`, o con el cambio
   guardado aparte con `git stash`):

   ```sh
   node pruebas-visuales/capturar.mjs /tmp/antes
   ```

5. Capturas **después** del cambio, y comparación:

   ```sh
   node pruebas-visuales/capturar.mjs /tmp/despues
   node pruebas-visuales/comparar.mjs /tmp/antes /tmp/despues --solo escritorio
   ```

   Tiene que acabar en «0 con cambios». Si no, al lado de cada captura que
   cambia queda un `.diff.png` con los píxeles distintos en rojo, y la salida
   dice en qué zona están.

Opciones de `capturar.mjs`: `--solo escritorio|movil` y
`--rutas pedidos,tienda-pedidos` (los nombres están en `RUTAS`, dentro del
propio fichero). Si una pantalla da un error de JavaScript, sale en la línea de
esa captura.

`--tamanos todos` (o una lista, `--tamanos tablet-v,portatil`) captura además
el resto de dispositivos, cada uno en su carpeta:

| Nombre          | Tamaño      | Qué es                    |
| --------------- | ----------- | ------------------------- |
| `escritorio`    | 1440 × 900  | Ordenador (la referencia) |
| `movil`         | 390 × 844   | Móvil                     |
| `movil-pequeno` | 360 × 780   | Móvil pequeño (Android)   |
| `tablet-v`      | 820 × 1180  | Tablet en vertical        |
| `tablet-h`      | 1180 × 820  | Tablet en horizontal      |
| `portatil`      | 1366 × 768  | Portátil                  |
| `grande`        | 1920 × 1080 | Pantalla grande           |

Si la página se sale de ancho, la línea de esa captura dice `DESBORDE` y qué
elemento llega más lejos. Ojo: el `<main>` del panel corta lo que sobra
(`overflow-x-hidden`), así que un recorte dentro de él no sale como desborde:
hay que mirar la captura.

## Detalles que importan

- **La fecha está fijada** al lunes 5 de octubre de 2026 a las 10:00 (hora de
  Madrid), y los datos están alrededor de esa fecha. Si se cambia una, hay que
  cambiar la otra.
- **Ruido de un tono.** Entre dos pasadas del mismo código, Chromium a veces
  alisa distinto el borde de un menú: un canal cambia en 1 a 3 de 255.
  `comparar.mjs` no cuenta como cambio una diferencia de 4 o menos por canal;
  `--umbral 0` lo hace estricto.
- **El móvil no se compara contra nada fijo**: es lo que se está arreglando. Se
  mira a ojo.
- Si una pantalla nueva pide una tabla que no está en `datos.mjs`, el Supabase
  de prueba devuelve una lista vacía y la pantalla sale en su estado vacío. La
  salida del servidor apunta cada petición, así se ve qué falta.

## Regla para la tablet

Por debajo de 1280 px (`xl:`) la barra lateral es un cajón que se abre con el
botón de la cabecera, como en el móvil: en una tablet el contenido tiene todo
el ancho. Las tablas que tampoco caben en la tablet en vertical (768–1023 px)
se leen como tarjetas con `<Table movil="tarjetas-tablet">`; la lista de
Pedidos, con `useEsMovil(CONSULTA_TABLET)`. Todo con clases `max-lg:` /
`lg:hidden` o `max-xl:`, así que el ordenador de 1440 no cambia.

## Regla para el móvil

Todo arreglo para el móvil se escribe solo para pantallas estrechas: clases con
`max-md:` o bloques con `md:hidden` / `max-md:hidden`. Así, por construcción,
en el ordenador (768 px o más) no cambia nada, y estas capturas lo demuestran.
