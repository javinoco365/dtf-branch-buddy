# Presupuestos con IA (documento o texto) e imágenes

Petición de Javier: en los presupuestos de cada tienda (DTF por metros) y en los de Textil
personalizado, tres formas de crear uno:

1. **A mano**, como siempre (no cambia).
2. **Desde un documento** (PDF o imagen, que puede llevar fotos de diseños o prendas): la IA
   monta el presupuesto con el modelo de siempre.
3. **Escribiéndolo** en texto libre, como en un chat («50 camisetas Gildan negras talla M con
   logo en pecho, 10 € cada una, para Pepe SL»): la IA lo monta igual.

Las imágenes se guardan con el presupuesto y salen en el PDF que se manda al cliente.

## Principio: la IA propone, Javier guarda

La IA **no escribe nada**. Devuelve un borrador con la misma forma que el editor de siempre
(cliente, fecha, validez, envío, IVA, notas y líneas), que abre ese editor relleno. Arriba
salen sus dudas y los avisos de lo que hay que mirar. Nada se guarda hasta pulsar **Guardar**,
y se guarda por el mismo camino que un presupuesto a mano (`guardarPresupuesto`,
`upsertPresupuesto`), con los mismos totales e IVA del dominio (`totalesPresupuesto`,
`calcularTotales`).

## Flujo

```
Nuevo presupuesto ▾
 ├─ Rellenarlo a mano          → editor de siempre (vacío)
 ├─ Desde un documento (IA)    → diálogo: documento + indicaciones + imágenes
 └─ Escribiéndolo (IA)         → diálogo: texto + imágenes
                                   │  proponerPresupuesto (server fn, no escribe)
                                   ▼
                          editor de siempre, relleno, con avisos e imágenes
                                   │  Guardar
                                   ▼
             guardar presupuesto → subir/quitar imágenes → PDF (con imágenes)
```

## Piezas

| Capa               | Fichero                                                       | Qué hace                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dominio            | `src/dominio/presupuesto-ia.ts`                               | Esquema JSON para la API (sin uniones ni opcionales), validación zod, catálogo en texto para la IA, casar el cliente, precios y borradores de tienda y textil.                       |
| Dominio            | `src/dominio/imagenes-presupuesto.ts`                         | Tipos admitidos, medidas por los bytes (JPEG/PNG/WEBP), revisión de una imagen, ruta en el bucket, fotos JPEG de un PDF y colocación en el PDF.                                      |
| IA (solo servidor) | `src/lib/lector-presupuestos.server.ts`                       | Llamada a la API con el patrón y la clave del lector de facturas (`claveLector`, `MODELO_LECTURA` o `claude-opus-5-5`, salida `json_schema`), validación y un reintento.             |
| Server functions   | `src/lib/presupuestos-ia.functions.ts`                        | `hayIaPresupuestos`, `proponerPresupuesto` (lee catálogo/stock y clientes con la sesión del usuario; no escribe).                                                                    |
| Server functions   | `src/lib/presupuesto-imagenes.functions.ts`                   | `listarImagenesPresupuesto` (URL firmadas), `subirImagenPresupuesto`, `quitarImagenPresupuesto`. Filas con la sesión del usuario (RLS + auditoría); ficheros con `adminComoUsuario`. |
| Datos del PDF      | `src/lib/presupuesto-imagenes-datos.ts`                       | Leer filas y bajar los ficheros para el PDF; tolera la migración sin aplicar.                                                                                                        |
| PDF                | `src/lib/pdf-presupuesto.ts`                                  | Sección «Imágenes» tras las observaciones, dos por fila, sin deformar.                                                                                                               |
| Pantallas          | `src/components/presupuestos/CrearPresupuestoIa.tsx`          | Menú «Nuevo presupuesto» con las tres formas, diálogo de documento/texto y panel de avisos.                                                                                          |
| Pantallas          | `src/components/presupuestos/ImagenesPresupuesto.tsx`         | Miniaturas, añadir y quitar en el editor; se sincroniza al guardar.                                                                                                                  |
| Migración          | `supabase/migrations/20261030100000_presupuesto_imagenes.sql` | Tabla `presupuesto_imagenes` y bucket privado `presupuestos`.                                                                                                                        |

## Reglas de la IA

- **Catálogo**: se le pasa en texto (tienda: productos activos de la tienda y generales;
  textil: variantes de stock vendibles con precio y disponible). La IA devuelve el
  `catalogo_id` exacto o vacío. Un id que no existe, o una variante apagada, va como línea
  libre y se avisa.
- **Precios**, en este orden: el que diga el documento o el texto (si dice IVA incluido, se pasa
  a base y se avisa; si solo da el importe de la línea, se divide entre la cantidad); si no, el
  del catálogo (precio del producto / precio de venta de la variante), igual que al elegirlo a
  mano; si tampoco, **vacío y aviso**. Nunca uno inventado.
- **Cliente**: la IA extrae los datos; el servidor lo casa con la ficha por correo, NIF o nombre
  exacto, solo si hay uno. Si no, va sin ficha con aviso.
- **Cantidad** que no aparece: vacía y aviso; el editor no deja guardar sin ella.
- Esquema sin uniones (límite de 16 de la API) ni opcionales: todo texto, `""` si falta. Lo
  comprueba `presupuesto-ia.test.ts` (uniones ≤ 16, opcionales ≤ 24).

## Imágenes

- Subidas: JPG, PNG y WEBP, hasta 5 MB, como mucho 8 por presupuesto. El tipo se comprueba por
  los bytes, no por el nombre. Las JPG en CMYK se rechazan (salen mal en el PDF).
- De un **PDF subido**: se lee su contenido y, además, se proponen las fotos JPEG que lleva
  dentro (objetos imagen con `DCTDecode` solo: el JPEG va tal cual, sin dependencias). Se
  descartan iconos (< 150 px), repetidas, CMYK, máscaras y las de filtros encadenados. Las
  imágenes en otros formatos internos del PDF no se sacan: se añaden aparte.
- De una **imagen subida** como documento: se guarda también como imagen del presupuesto.
- En el editor se ven, se añaden y se quitan; los cambios se aplican al guardar, antes de sacar
  el PDF. Al borrar un presupuesto se borran también sus ficheros.

## Base de datos (migración 20261030100000)

`presupuesto_imagenes`: `empresa_id` (la copia un trigger del presupuesto), `presupuesto_id` o
`textil_presupuesto_id` (exactamente uno, con borrado en cascada), `ruta`, `nombre`,
`tipo_mime`, `bytes`, `ancho`, `alto`, `orden`, `created_at timestamptz`. RLS con una política
por operación (ninguna `FOR ALL`), misma condición que las líneas de cada presupuesto; trigger
de auditoría. Bucket `presupuestos` privado (solo imágenes, 5 MB): leer, quien ve la fila;
subir y borrar, administradores (la app lo hace en el servidor con `adminComoUsuario`).

Sin la migración: los presupuestos y la IA funcionan; las imágenes no salen
(`faltaLaTabla`).

Reversión: `supabase/reversiones/20261030100000_presupuesto_imagenes.sql`. Prueba:
`supabase/pruebas/C20_presupuesto_imagenes.sql`.
