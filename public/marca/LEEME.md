# Los ficheros de la marca

Ya están puestos. Salen del logotipo que mandó Javier el 5 de septiembre de 2026.

| Fichero | Dónde sale | Qué es |
| --- | --- | --- |
| `logo.png` | Menú lateral y pantalla de acceso | 512×512, fondo transparente |
| `favicon.png` | Pestaña del navegador y icono en el móvil | 180×180, fondo transparente |
| `og.png` | Vista previa al pegar un enlace en WhatsApp, Slack o un correo | 1200×630, logotipo sobre el navy de marca |

## Cómo se prepararon

Del original, en tres pasos:

1. **El fondo blanco se quitó propagando la transparencia desde el borde**, no
   sustituyendo todo el blanco de la imagen. Las letras del logotipo también son
   blancas: un reemplazo global las habría dejado transparentes y el logotipo
   habría salido hueco.
2. **Se recortó el margen** hasta la caja de lo que queda opaco, para que el
   logotipo llene su hueco y no se vea pequeño rodeado de aire.
3. Se escaló a cada tamaño con un poco de margen, y para `og.png` se compuso
   sobre el navy `#2A2260`.

## Si hay que cambiarlos

Se sustituyen los tres ficheros y ya está: no hay que tocar código. El componente
`src/components/Marca.tsx` pinta un monograma con las iniciales si `logo.png` no
carga, así que un fichero que falte no deja un hueco ni una imagen rota.
