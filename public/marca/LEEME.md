# La marca

Deja aquí los ficheros y la aplicación los coge sola. No hay que tocar código.

| Fichero | Para qué | Formato |
| --- | --- | --- |
| `logo.svg` | El logotipo del menú y de la pantalla de acceso | SVG, o PNG cuadrado con fondo transparente renombrado a `.svg` no vale: si es PNG, dilo y se cambia la referencia |
| `favicon.png` | El icono de la pestaña del navegador | PNG cuadrado, 32×32 o 180×180 |
| `og.png` | La imagen que sale al compartir un enlace | PNG 1200×630 |

Mientras `logo.svg` no exista, el menú pinta un monograma con las iniciales.
No sale una imagen rota: el componente solo cambia al logotipo si la imagen
carga de verdad.

`og.png` todavía no está referenciado en `__root.tsx`: una imagen de
previsualización rota se ve peor que ninguna. Cuando esté el fichero, se añade
la etiqueta.
