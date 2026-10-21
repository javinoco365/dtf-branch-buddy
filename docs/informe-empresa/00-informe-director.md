# 00 · Informe del director de operaciones

**Para:** Javier (DTI S.L. / RONOCA DESARROLLOS S.L.)
**Fecha:** 21-10-2026 (revisado el mismo día)
**Qué es:** el resumen de los informes 01 a 07 de esta carpeta, revisados y corregidos; las
decisiones que te tocan; lo que tienes que hacer esta semana; y lo que se ha construido entre
el 20 y el 21 de octubre.

**Cómo leerlo:** si tienes diez minutos, lee las secciones 1 y 2. Si vas a actuar, la 3. El
resto es el respaldo.

---

## De dónde sale cada cosa

Nadie del equipo ha visto **datos reales de producción**. Cada afirmación va marcada con su
fuente:

| Marca           | Fuente                                                                                                                                                               | Cuánto vale                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **[Capturas]**  | Las 9 imágenes que mandaste (Facturación de DTF Culture del 1 al 8 de octubre, un ticket, pedidos, presupuestos, WooCommerce, el panel caído, el lector de facturas) | Datos reales, pero de **8 días y una tienda**                       |
| **[Código]**    | El código y las migraciones del repositorio                                                                                                                          | Dice cómo se calcula, no cuánto dinero mueve                        |
| **[Banco]**     | El PostgreSQL local con datos sintéticos y las pruebas                                                                                                               | Demuestra que algo pasa o no pasa, no con qué frecuencia en tu base |
| **[Escenario]** | Supuestos del economista, a la vista                                                                                                                                 | Orden de magnitud; cambia con tus números                           |
| **[Norma]**     | Ley o reglamento citado por artículo                                                                                                                                 | Lectura de un asesor; **confírmala con la gestoría**                |

**Entre las capturas no hay ningún informe anual en PDF.** Si existe (cuentas anuales, modelo
200, un informe de la gestoría), mándalo: es lo que convertiría los escenarios en cifras.

---

## 1. Resumen ejecutivo

**La herramienta es buena; el negocio que mide es todavía muy pequeño; y hay tres riesgos que
pueden costar más que toda la venta del año.**

Para dar escala: a ritmo de las capturas, DTF Culture vende unos **2.200-2.700 € de base al
mes**, unos **26.500-32.000 € al año** [Capturas, extrapolando 8 días]. Los tres riesgos:

| Riesgo                                                                               | Qué puede costar                                                                                                                                                                                                            | Fuente                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **R1. Nadie ha decidido quién factura** y el 1-1-2027 entra Verifactu (72 días)      | Hoy, doble factura: sanción del 1 % de las operaciones afectadas (art. 201 LGT). Desde 2027, usar un programa de facturación no conforme: **50.000 € por ejercicio** (art. 201 bis LGT). Más que la venta de un año entero  | Código, Capturas, Norma |
| **R2. Ventas sin documento («grupo B»)** que la app no lleva al IVA                  | El IVA se devenga igual (art. 75 LIVA); en una inspección lo no documentado se presume venta no declarada. Importe: **no se sabe** hasta ejecutar la consulta B6                                                            | Código, Norma           |
| **R3. Producción expone datos de clientes** sin iniciar sesión (correo, NIF, nombre) | Si alguien lo ha usado, es una brecha de datos personales con obligación de notificar a la AEPD en 72 h desde que se sabe (art. 33 RGPD). **No se sabe si ha pasado**: hay que mirar los registros (paso 3 de la sección 3) | Banco, Norma            |

Y tres cosas más que conviene saber:

1. **El CRM está bien construido en lo difícil.** Numeración sin huecos, lo emitido no se toca,
   costes congelados en cada pedido, almacén con libro inmutable [Código, Banco]. Desde el 21-10,
   además, es más rápido, tiene tres niveles de usuario y se han cerrado casi todos los agujeros
   de seguridad del informe 03. **Nada de eso está en producción todavía**: depende de que
   apliques 11 migraciones y despliegues (sección 3).
2. **El negocio vende muy por debajo de lo que puede producir.** Unos 320 m al mes frente a una
   capacidad de unos 5.900 m con la jornada por defecto del código (70 m/h × 4 h × 21 días):
   **en torno al 5 %** [Capturas + Escenario: no sé qué jornada tienes puesta en producción].
   **No se sabe el punto muerto**; con supuestos razonables está entre **330 y 2.000 m al mes**,
   es decir, **por encima del ritmo actual en todos los escenarios** (informe 06, §6.2).
3. **El margen que enseña la app está inflado sin saber cuánto.** El coste por metro es un número
   escrito a mano y no se registran las compras reales de tinta y film [Código]. Cada euro de error
   en el coste por metro son unos **320 € al mes** de margen que no existe.

**Qué haría esta semana:** mirar los registros de la vista de clientes, apagar el registro libre,
aplicar lo de hoy (sección 3), reunirte con la gestoría por lo de quién factura, ejecutar las
consultas de cuadre y dar de alta a mano las compras de septiembre y octubre. Con eso, en un mes
sabremos tu punto muerto y si el CRM cuadra con la gestoría.

---

## 2. Decisiones que te tocan

Ordenadas por fecha límite. «Qué falta» es lo que hay que traer para poder decidir con datos.

| #   | Decisión                                                                        | Opciones                                                                                                                                                              | Recomendación                                                                                                          | Qué falta para decidir                                                                                         | Antes de                         |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| D1  | **Quién expide las facturas desde el 1-1-2027** (01 H1)                         | (a) La gestoría o un programa certificado; el CRM solo hace documentos internos sin serie fiscal. (b) El CRM, integrando un proveedor certificado por API (CLAUDE.md) | **(a)** salvo que la gestoría cobre mucho por emitir: es más barato y quita la responsabilidad de DTI                  | Qué cobra la gestoría por emitir; precio mensual de dos proveedores certificados; si WowInvoice emite algo hoy | Reunión: 15-11. Hecho: 31-12     |
| D2  | **Hasta entonces, ¿se siguen mandando tickets del CRM al cliente?** (01 H1, H2) | (a) Sí, y la gestoría no emite por esas ventas. (b) No: el CRM deja de enviar y emite la gestoría                                                                     | La que diga la gestoría; lo que no puede pasar es que emitan los dos                                                   | Lo mismo que D1                                                                                                | Con D1                           |
| D3  | **Fecha de los documentos** (01 H2; tu decisión del 9-10)                       | (a) Mantener la fecha del pedido. (b) Fecha de expedición = día de emisión, con la del pedido aparte                                                                  | **(b)** si el CRM sigue expidiendo después del 1-1-2027; con (a) de D1, da igual                                       | Resultado de la consulta A7 (cuántos documentos se han expedido tarde)                                         | Con D1                           |
| D4  | **Límite del ticket**: 3.000 € a «particular» o 400 € para todos (01 H15)       | Depende de si la impresión DTF por encargo cuenta como «venta al por menor» (art. 4.1 RD 1619/2012)                                                                   | 400 € hasta que la gestoría diga otra cosa (es un ajuste, sin migración)                                               | Opinión de la gestoría; consulta A8                                                                            | Reunión con la gestoría          |
| D5  | **Cuentas que no reconozcas en P4**                                             | Desactivar (Ajustes › Usuarios, sin borrar) o borrar                                                                                                                  | Desactivar y mandarme la lista; borrar solo con tu autorización expresa                                                | Ejecutar P4                                                                                                    | Antes de aplicar las migraciones |
| D6  | **Pedido mínimo o cargo de preparación** (06 §6.3)                              | (a) Mínimo de 2 m. (b) Cargo de 2-3 € por pedido. (c) Nada                                                                                                            | Decidir **después** de ver la consulta 1 del informe 06: si más del 40 % de los pedidos son de menos de 3 m, (a) o (b) | Consulta 1 del 06; precio de cinco competidores                                                                | 30-11                            |
| D7  | **Borrar `bun.lock` y `bunfig.toml`** (05 W3)                                   | Borrar en una rama / dejarlos                                                                                                                                         | Borrar: no se usan y apuntan a un registro que no resuelve fuera de Lovable                                            | Confirmar en Vercel que instala con `npm ci`                                                                   | 20-11                            |
| D8  | **Plazos de conservación de datos de clientes** (05 W6)                         | Ejemplo: facturas, el legal; presupuestos sin venta, 2 años; imágenes y correos, 1 año                                                                                | Fijarlos con la gestoría y escribirlos en el registro de actividades                                                   | Plazo legal que confirme la gestoría                                                                           | 19-04-2027                       |

---

## 3. Lo que te toca hacer, en este orden

Todo el trabajo del 20-21 de octubre está en la rama `claude/crm-dtf-app-review-ftg3di`, con
commits locales **sin subir**. No se ha tocado producción.

1. **Copia de seguridad.** Comprueba que el PITR de Supabase está activo o haz un volcado antes
   de tocar nada.
2. **Mira qué tiene producción.** En el SQL Editor:
   `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;`
   La última tiene que ser `20261030100000` (presupuestos con imágenes, ya en `main`). Si falta
   alguna anterior, aplícala primero. La captura 1 («falta ANTHROPIC_API_KEY») hace sospechar
   que en su día faltaba `20261018100000`.
3. **Cierra la puerta y mira quién ha entrado.**
   - Supabase › Authentication › Sign In / Providers: apaga «Allow new users to sign up» (la app
     no lo usa).
   - Ejecuta la consulta **P1** de `03-seguridad-bd-consultas-produccion.sql`: dice si la vista
     de clientes sigue abierta.
   - En Supabase › Logs › API, busca peticiones a `clientes_duplicados_por_email` hechas sin
     sesión (rol `anon`) en el periodo que guarde tu plan. Si sale alguna que no sea vuestra,
     **para y consúltalo**: es el riesgo R3 de la sección 1.
   - Ejecuta la consulta **P4**. La migración de niveles da nivel _editor_ a toda cuenta que no
     tenga rol. Si sale alguna que no reconoces, es la decisión D5: no la borro yo.
4. **Aplica las 11 migraciones, una a una y en este orden.** Cada una tiene su reversión en
   `supabase/reversiones/` con el mismo nombre (comprobado: están las 11).

   | #   | Migración                                          | Qué hace                                                                                                                                                                 | ¿Reversible?                                                 |
   | --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
   | 1   | `20261031100000_rendimiento_indices`               | Índices que faltaban                                                                                                                                                     | Sí                                                           |
   | 2   | `20261031100100_rendimiento_rls`                   | Lecturas con `mis_tiendas()` / `mis_empresas()`                                                                                                                          | Sí                                                           |
   | 3   | `20261031200000_roles_niveles`                     | Añade `editor` y `visor` (va sola)                                                                                                                                       | **No** (Postgres no quita valores de un enum; no hacen daño) |
   | 4   | `20261031200100_roles_permisos`                    | Un nivel por usuario, columna `activo`, funciones de nivel y la guardia en 55 tablas. `info@ronocadesarrollos.com` queda administrador; los admin de hoy siguen siéndolo | Sí                                                           |
   | 5   | `20261031200200_roles_politicas_escritura`         | 100 políticas de escritura exigen el nivel; se para con error si queda alguna sin él                                                                                     | Sí                                                           |
   | 6   | `20261031200300_roles_funciones`                   | 24 funciones comprueban el nivel; borrar la última factura, solo administrador                                                                                           | Sí                                                           |
   | 7   | `20261031300000_seguridad_funciones_y_privilegios` | Vista de clientes cerrada, autor de conciliación, funciones por empresa, sin TRUNCATE                                                                                    | Sí                                                           |
   | 8   | `20261031300100_seguridad_lectura_por_empresa`     | Banco, contadores y stock se leen solo en tu empresa                                                                                                                     | Sí                                                           |
   | 9   | `20261031300200_roles_desactivado_sin_acceso`      | Un usuario desactivado no ve ni escribe                                                                                                                                  | Sí                                                           |
   | 10  | `20261031300300_compras_borrado_solo_admin`        | Borrar una factura recibida registrada: solo administrador                                                                                                               | Sí                                                           |
   | 11  | `20261031300400_seguridad_escritura_por_empresa`   | Banco y stock se escriben solo en tu empresa                                                                                                                             | Sí                                                           |

   Si una falla, para y mándame el error: varias se detienen a propósito si encuentran algo
   inesperado en producción (políticas con otro nombre, por ejemplo).

5. **Sube la rama, abre el pull request y despliega.** El código aguanta los dos órdenes
   (desplegar antes o después de las migraciones), pero lo limpio es migraciones primero.
   Después, en Ajustes › Usuarios, comprueba que los tres socios tenéis el nivel que toca.
6. **Ejecuta las consultas de cuadre** (todas de solo lectura) y mándame los resultados:
   - `consultas-cuadre.sql` (informe 01): numeración, IVA por trimestre, tickets frente a
     pedidos, cobros, banco, almacén. Cada bloque dice el resultado esperado. **B6** (ventas sin
     documento) y **A7** (expedidos tarde) son las que deciden R2 y D3.
   - Las seis de la sección 9 de `06-economista.md`: pedidos por tamaño, concentración de
     clientes, mes a mes, días de cobro, coste real por metro, proveedores.
   - `03-seguridad-bd-consultas-produccion.sql` (P1 a P10). **Guarda fuera de Supabase el hash
     de P9** (un correo a los tres socios vale) y repítelo cada semana.
7. **Ajustes de panel:** activa MFA para los tres; comprueba el hook de límite de intentos de
   inicio de sesión (Authentication › Hooks), «Prevent use of leaked passwords», la duración de
   la sesión y la región del proyecto. En Vercel (la captura 8 tiene abierta una pestaña de
   Vercel; el `CLAUDE.md` dice que la compilación por defecto apunta a Cloudflare: confírmalo),
   comprueba que la instalación es `npm ci` y no bun.
8. **Prueba a mano** (10 minutos): entrar, navegar Pedidos y Gerencia con `?medir=1`; emitir un
   ticket de prueba y borrarlo; crear un usuario de solo lectura y comprobar que no puede
   guardar nada; abrir el CRM en una tablet.

---

## 4. Los diez hallazgos más importantes

Escala común a todos los informes: **Crítica** = puede traer una sanción, exponer datos de
clientes o romper la facturación ya; **Alta** = error de dinero o de seguridad probable que hay
que cerrar este trimestre; **Media** = cifra engañosa o riesgo con condiciones; **Baja** =
mejora. «Cuánto» dice lo que se sabe del importe; casi siempre es «no se sabe hasta ejecutar la
consulta».

| #   | Gravedad | Hallazgo                                                                                                                                                                                           | Cuánto                                                                             | Fuente                           | Informe               |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------- | --------------------- |
| 1   | Crítica  | **No está decidido quién factura.** El CRM expide tickets con NIF y numeración y los manda al cliente; según la decisión del 9-10, la gestoría también emite; la tienda tiene WowInvoice instalado | R1: hasta 50.000 €/ejercicio desde 2027 (a confirmar)                              | Capturas 2 y 5, Código           | 01 H1, 06 §7.1        |
| 2   | Crítica  | **Producción enseña correo, NIF y nombre de clientes sin iniciar sesión**, y deja leer y escribir banco y stock a cualquier sesión. Arreglado en la rama; **sin aplicar**                          | R3: depende de si alguien lo ha usado (paso 3)                                     | Código, Banco                    | 03 SEG-01 a 03        |
| 3   | Crítica  | **Fecha de expedición = fecha del pedido.** Un ticket de noviembre de un pedido de septiembre cambia un trimestre ya presentado. Es tu decisión del 9-10; vale mientras el CRM no declare          | Complementarias del 303; consulta A7                                               | Código                           | 01 H2                 |
| 4   | Alta     | **Tickets de pedidos web que no coinciden con lo cobrado:** líneas antes del cupón y siempre al 21 %. Con un cupón del 10 %, ticket de 121 € por un pedido de 108,90 €                             | 2,10 € de IVA de más por cada 100 € con cupón del 10 %; volumen: consultas D2 y D3 | Código; indicio en captura 4     | 01 H4, H5             |
| 5   | Alta     | **El IVA que enseña el CRM no es el 303.** Solo cuenta lo documentado, Fiscal y Resultados dan cifras distintas y Resultados deduce IVA de gastos sin factura                                      | Ejemplo del 01: 504 € de diferencia en un trimestre con un alquiler de 800 €/mes   | Código                           | 01 H6, H8, H9         |
| 6   | Alta     | **Devoluciones y cancelados sin rectificativa; y borrar la última factura no sabe si ya salió** al cliente o a la gestoría                                                                         | IVA ingresado de más por cada devolución; consultas D4 y D5                        | Código                           | 01 H3, H7             |
| 7   | Alta     | **Cualquiera puede crearse una cuenta** si el registro libre sigue activo, y no se exige segundo factor                                                                                            | Control total con una contraseña robada                                            | Código (el panel no lo he visto) | 03 SEG-06, 04 S2, S4  |
| 8   | Alta     | **No se sabe el punto muerto** y la máquina estaría al 5 %. Un pedido de 1 m deja unos 4 € tras material: pierde dinero si prepararlo lleva más de 12 minutos a 20 €/h                             | Punto muerto 330-2.000 m/mes frente a ~320 vendidos                                | Capturas + Escenario             | 06 §2, §6             |
| 9   | Alta     | **El margen está inflado:** coste por metro a mano, compras reales sin registrar, metros estimados dividiendo entre 7 €                                                                            | ~320 €/mes por cada euro de error en el coste por metro                            | Código, Capturas 1 y 9           | 06 §5                 |
| 10  | Alta     | **Despliegue y dependencias:** `nodemailer` con fallo conocido, `bun.lock` del registro de Lovable, la CI no audita dependencias ni arranca el servidor                                            | La caída del 16-10 (captura 8) es de este tipo, sin confirmar la causa             | Código, Captura 8                | 04 S3, 05 W3, W4, W12 |

Justo por debajo: semáforos y orden del menú para el equipo (02), tres «beneficios» y cuatro
«facturaciones» que no cuadran entre sí (01 H12), clientes partidos en dos (06 §5.5), RGPD sin
plazos ni forma de borrar a nadie (05 W6), y la empresa elegida como «la primera activa» en vez
de la del usuario (04 S7).

---

## 5. La empresa vista desde la app

| Qué                   | Lo que se ve                                                                                                                                                                                                                                  | Fuente   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Tamaño                | 853 € con IVA, 24 pedidos, 85,56 m en 8 días; ticket medio 35,54 € (853 ÷ 24); 3,6 m por pedido                                                                                                                                               | Capturas |
| Ritmo                 | 85,56 m ÷ 8 × 30 ≈ 320 m/mes. Base: 2.200 €/mes sin envío (588,95 ÷ 8 × 30) y 2.660 € con envío (709,26 ÷ 8 × 30)                                                                                                                             | Cálculo  |
| Precio                | 7 € el metro sin IVA (6,88 € de media real); envío 24 h 5,99 € sin IVA, el 46 % de la base en un pedido de 1 m (5,99 ÷ 12,99)                                                                                                                 | Capturas |
| Cancelados            | 4 de 28 (14 %): hay que mirar si son pagos no terminados                                                                                                                                                                                      | Capturas |
| Tiendas               | Solo una real (DTF Culture); la otra se llama «prueba»                                                                                                                                                                                        | Capturas |
| Comercial             | Un presupuesto, en borrador, de 60,61 €                                                                                                                                                                                                       | Capturas |
| Documentos            | El ticket T2026/0003 es del 24-9, cuando ya había pedidos de septiembre. **Indicio**, no prueba: puede que muchas ventas no tengan documento, o que se documenten con factura (serie F) o que la serie empezara tarde. La consulta B6 lo dice | Capturas |
| IVA                   | En la captura de octubre el IVA es el 20,27 % de la base (143,74 ÷ 709,26), no el 21 %: faltan 5,20 € de IVA, unos 24,76 € de base sin IVA o con cupón (consulta D3)                                                                          | Capturas |
| Fiabilidad            | La captura 8 enseña «This page didn't load» el 16-10 (no sabemos cuánto duró ni por qué); el lector de facturas falló el 7-10 y el 16-10 (capturas 1 y 9)                                                                                     | Capturas |
| Margen                | Coste por metro a mano, sin merma, mano de obra, comisiones ni amortización                                                                                                                                                                   | Código   |
| Lo que la app no mide | Punto muerto, coste real por metro, economía por tamaño de pedido, margen por cliente, previsión de caja, coste de captación                                                                                                                  | Código   |

**Lectura:** micro-B2B recién arrancado (autónomos y pequeños talleres que pagan por Bizum),
con mucha capacidad libre. El problema de hoy es vender y saber el coste real, no producir.
**Ojo:** son 8 días al principio de la vida de la tienda; septiembre en las mismas fechas fueron
unos 14 €. No saques tendencias hasta tener tres meses (consulta 3 del informe 06).

---

## 6. Lo que se ha hecho entre el 20 y el 21 de octubre

Al terminar: `npm run verify` en verde (**3.877 pruebas**, recontadas el 21-10 al revisar este
informe) y el banco SQL «TODO EN VERDE». No se ha tocado producción ni aplicado ninguna
migración.

- **Rendimiento** (fases 0 a 9 y 12 de `docs/rendimiento/plan.md`): menos consultas por clic,
  lecturas en paralelo, caché que no enseña cifras viejas, Gerencia que pide solo la pestaña
  abierta, Pedidos en una consulta por página, índices y permisos de lectura que se evalúan una
  vez por consulta. Con `?medir=1` en la URL sale un medidor para comparar antes y después.
  **No se ha medido en el navegador con datos reales**: la mejora está demostrada en el banco
  (una consulta de pedidos de 1.150 ms a 6 ms con 50.000 pedidos sintéticos), no en tu cuenta.
  Faltan las fases 10 y 11.
- **Usuarios y permisos:** tres niveles (administrador, editor, solo lectura) que la base hace
  cumplir por los tres caminos (navegador, servidor y funciones). Ajustes › Usuarios permite
  crear, cambiar el nivel, elegir tiendas y desactivar sin borrar. Siempre queda al menos un
  administrador activo.
- **Seguridad:** cerrados la vista que enseñaba clientes sin iniciar sesión, la firma falsa en
  la conciliación, las políticas abiertas de banco y stock, las funciones que tocaban lo ajeno,
  las server functions que usaban la clave de servicio sin comprobar acceso, las cabeceras de
  seguridad, los CSV con fórmulas, las subidas sin comprobar y las URL de logos y seguimiento.
- **Pantallas en todos los tamaños:** en la tablet el menú pasa a cajón y las tablas a tarjetas;
  ningún diálogo se sale; arreglos en el móvil. El ordenador de 1440 y 1920 sale idéntico.

**Nada fiscal ni económico se ha cambiado.** Los hallazgos de los informes 01 y 06 siguen todos
abiertos.

---

## 7. Hoja de ruta

Una tarea por rama, como dice el `CLAUDE.md`. «Desarrollo» es el trabajo en rama con pull
request, que revisas tú antes de fusionar; las migraciones las aplicas tú. Fechas contadas desde
el 21-10-2026.

### 30 días (hasta el 20-11)

| Qué                                                                                                                          | Área      | Quién                         |
| ---------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------- |
| Pasos 1 a 8 de la sección 3                                                                                                  | Seguridad | Javier                        |
| Reunión con la gestoría: decisiones D1 a D4, con lo que pide la columna «Qué falta»                                          | Fiscal    | Javier                        |
| Dar de alta a mano las compras de septiembre y octubre, todos los gastos fijos y la jornada real de la máquina               | Economía  | Javier                        |
| Calcular el punto muerto con las consultas y ponerlo como objetivo de metros                                                 | Economía  | Javier, con el informe 06     |
| Rama «dependencias»: `nodemailer` 10, `npm audit` en la CI, prueba de arranque del servidor en la CI, quitar `bun.lock` (D7) | Seguridad | Desarrollo                    |
| Tickets que coinciden con lo cobrado: cupones, recargos y tipo de IVA de WooCommerce (01 H4, H5)                             | Fiscal    | Desarrollo                    |
| MFA exigido en la base y en el servidor                                                                                      | Seguridad | Desarrollo, tras activarlo tú |

### Antes del 31-12-2026 (Verifactu el 1-1-2027)

| Qué                                                                                                                                                                                                  | Área   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ejecutar D1: o el CRM deja de expedir (documentos internos, sin serie fiscal), o se integra un proveedor certificado. En los dos casos, retirar la excepción de borrar la última factura el 1-1-2027 | Fiscal |
| Si el CRM sigue expidiendo: fecha de expedición = día de emisión, con la fecha del pedido aparte (01 H2, D3), y no borrar documentos que ya han salido (01 H3)                                       | Fiscal |

### 90 días (hasta el 19-01-2027; el 303 del 4T se presenta hasta el 30-1)

| Qué                                                                                                                                   | Área      |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Rectificativas parciales desde las devoluciones y aviso de cancelados con documento (01 H7)                                           | Fiscal    |
| Un solo cálculo de IVA para Fiscal y Resultados, con lo pendiente de documentar a la vista (01 H6, H8, H9)                            | Fiscal    |
| Pedido mínimo o cargo de preparación, escalera de precios y envío gratis con umbral, según D6                                         | Economía  |
| Plan comercial B2B con objetivo en metros                                                                                             | Economía  |
| Indicadores: punto muerto, coste real por metro, % de metros estimados, variación con base mínima                                     | Economía  |
| Alcance por empresa (04 S7, 03 SEG-09) y `UNIQUE (empresa_id, email)` en clientes: antes de tocar pantallas, como pide el `CLAUDE.md` | Datos     |
| Semáforos de estado y antigüedad, errores para personas, avisos arriba en Gerencia (02 A1-A5, A8)                                     | UX        |
| Restos de seguridad: lectura del bucket `compras`, PDF de facturas emitidas que un editor puede sustituir, CSP obligatoria            | Seguridad |

### 180 días (hasta el 19-04-2027)

| Qué                                                                                                    | Área        |
| ------------------------------------------------------------------------------------------------------ | ----------- |
| Tres estados de pedido en la aplicación (hoy solo en la base)                                          | Datos       |
| Previsión de caja a 30/60/90 días, días de cobro reales, margen por cliente, rotación del stock textil | Economía    |
| Conmutador «Tabla / Visual», inicio por perfil y menú por tareas (02 B y C)                            | UX          |
| Rendimiento, fases 10 y 11                                                                             | Rendimiento |
| RGPD: plazos de conservación (D8), anonimizar clientes, contratos con encargados (05 W6, W11)          | Legal       |
| Rotar claves de WooCommerce y quitar las columnas en claro (03 SEG-12)                                 | Seguridad   |
| Paquete para la gestoría: 347, 390, bienes de inversión, cálculo del 202 (01 H20, H24)                 | Fiscal      |
| Segunda tienda real, solo si la primera pasa su punto muerto                                           | Economía    |

---

## 8. Anexo: cómo se han revisado los informes

**Primera revisión (21-10, mañana).** Comprobé contra el código al menos cinco afirmaciones de
cada informe. Todas las de fondo son ciertas; corregí números de línea movidos, afirmaciones que
ya no valían tras el trabajo del día, contradicciones entre informes y tres exageraciones del 06
(la capacidad es el valor por defecto del código, no un ajuste visto en producción; el lector
«no funcionaba» en las capturas, no «no funciona»; WowInvoice no consta que emita). Cada informe
lleva al principio una nota o una tabla de estado con lo que cambió.

**Segunda revisión (21-10, tarde), de calidad.** Leída como la leería un socio que tiene que
decidir. Cambios:

- **Este informe:** sección nueva de **decisiones** (D1 a D8) con opciones, recomendación, qué
  falta y fecha; los «tres asuntos» del resumen, nombrados y con lo que pueden costar; columna
  «Cuánto» en los diez hallazgos; el hallazgo 2 describe el riesgo y no el estado del trabajo;
  paso nuevo para mirar si alguien ha usado la vista de clientes; la decisión de las fechas es
  del 9-10, no del 8-10; «el panel se cayó» pasa a lo que enseña la captura; el ticket n.º 3 es
  un indicio con tres explicaciones posibles; la hoja de ruta separa lo que tiene que estar
  **antes del 31-12** (Verifactu), que antes quedaba en el tramo de 90 días; recontadas las
  3.877 pruebas y comprobado que existen las 11 reversiones.
- **01:** la fecha de la decisión, aviso de que los bloques de consultas (A-J) no son los
  hallazgos (H1-H24), la sanción del art. 201 bis LGT en H1, los días que faltan con su fecha.
- **02:** las capturas citadas están en una carpeta temporal que no llega a Javier: dicho, y
  cómo regenerarlas; B2 y A7 al día con los niveles y el cajón.
- **03, 04 y 05:** frases que contradecían su propia tabla de estado (la decisión de borrar la
  última factura, `crearUsuarioInvitado`, «sin cabeceras»), marcadas como superadas.
- **06:** tres cuentas mal hechas: el punto muerto más bajo de la tabla (333 m) ya está por
  encima del ritmo actual, así que **ningún** escenario cubre la estructura (antes decía «salvo
  fijos por debajo de 1.500 €»); con 10 minutos a 20 €/h el pedido de 1 m no pierde dinero, gana
  0,67 € (pierde a partir de 12 minutos); subir el pedido medio de 3,6 a 5 m baja el coste de
  servir por metro un 28 %, no un 25 %. Además, la venta anual (26.500-32.000 €) y la sanción de
  Verifactu en la tabla de riesgos.
- **07:** sin cambios.
