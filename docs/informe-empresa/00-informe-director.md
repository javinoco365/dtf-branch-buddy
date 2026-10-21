# 00 · Informe del director de operaciones

**Para:** Javier (DTI S.L. / RONOCA DESARROLLOS S.L.)
**Fecha:** 21-10-2026
**Qué es:** el resumen de los informes 01 a 07 de esta carpeta, revisados y corregidos, más lo
que se ha construido entre el 20 y el 21 de octubre y lo que te toca hacer a ti.

---

## De dónde sale cada cosa (léelo primero)

Nadie del equipo ha visto **datos reales de producción**. Todo sale de cuatro fuentes, y cada
afirmación de este informe va marcada con la suya:

| Marca           | Fuente                                                                                                                                                               | Cuánto vale                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **[Capturas]**  | Las 9 imágenes que mandaste (Facturación de DTF Culture del 1 al 8 de octubre, un ticket, pedidos, presupuestos, WooCommerce, el panel caído, el lector de facturas) | Datos reales, pero de **8 días y una tienda**                       |
| **[Código]**    | El código y las migraciones del repositorio                                                                                                                          | Dice cómo se calcula, no cuánto dinero mueve                        |
| **[Banco]**     | El PostgreSQL local con datos sintéticos y las pruebas                                                                                                               | Demuestra que algo pasa o no pasa, no con qué frecuencia en tu base |
| **[Escenario]** | Supuestos del economista, a la vista                                                                                                                                 | Orden de magnitud; cambia con tus números                           |

**Entre las capturas no hay ningún informe anual en PDF.** Las he mirado las nueve: son pantallas
del CRM, de WooCommerce, un ticket y dos errores. Si existe (cuentas anuales, modelo 200, un
informe de la gestoría), mándalo: es lo que convertiría los escenarios en cifras.

Para pasar del código a tus números hay tres paquetes de consultas **de solo lectura**, listos
para el SQL Editor de Supabase (ver «Lo que te toca hacer», paso 6).

---

## 1. Resumen ejecutivo

**La herramienta es buena; el negocio que mide es todavía muy pequeño; y hay tres asuntos que
pueden costar más que todo el margen del año.**

1. **El CRM está bien construido en lo difícil.** La numeración de facturas no deja huecos, lo
   emitido no se puede tocar, los costes se congelan en cada pedido y el almacén lleva un libro
   inmutable [Código, Banco]. Desde hoy, además, es más rápido, tiene tres niveles de usuario
   (administrador, editor, solo lectura) y se cerraron casi todos los agujeros de seguridad
   encontrados ayer. **Pero nada de lo de hoy está en producción todavía**: depende de que
   apliques 11 migraciones y despliegues (sección 3).

2. **Lo fiscal es lo urgente, y es una decisión, no código.** El CRM ya imprime «FACTURA
   SIMPLIFICADA» con vuestro NIF y la manda al cliente [Capturas, Código], aunque la decisión del
   9-10 diga que factura la gestoría. Si la gestoría emite también, una venta tiene dos facturas.
   Y el **1 de enero de 2027 (dentro de 72 días)** entra Verifactu: el programa que expide
   facturas tiene que cumplirlo. Hay que decidir con la gestoría **quién emite** antes de
   diciembre. Además, los documentos llevan la fecha del pedido en vez de la del día en que se
   emiten, y los tickets de pedidos web con cupón o sin IVA no coinciden con lo cobrado.

3. **El negocio vende muy por debajo de lo que puede producir.** Del 1 al 8 de octubre, DTF
   Culture vendió 853 € con IVA en 24 pedidos y 85,56 m [Capturas]. A ese ritmo son unos 300 m
   al mes. Con la jornada por defecto del CRM (70 m/h, 4 h al día) la máquina da para unos
   5.900 m: estaría al **5 %** [Escenario: no sé qué jornada tienes puesta en producción]. El
   margen que enseña la app está **inflado sin saber cuánto**, porque el coste por metro es un
   número escrito a mano y no se registran las compras reales de tinta y film [Código]. **No se
   sabe el punto muerto**, que es la cifra que decide todo lo demás.

4. **Qué haría esta semana:** aplicar lo de hoy (con las precauciones de la sección 3), apagar
   el registro libre de Supabase, reunirte con la gestoría por lo de quién factura, ejecutar las
   consultas de cuadre y dar de alta a mano las facturas de compra de septiembre y octubre.
   Con eso, el mes que viene sabremos tu punto muerto y si el CRM cuadra con la gestoría.

---

## 2. La empresa vista desde la app

| Qué                   | Lo que se ve                                                                                                                 | Fuente   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| Tamaño                | 853 € con IVA, 24 pedidos, 85,56 m en 8 días; ticket medio 35,54 €; 3,6 m por pedido                                         | Capturas |
| Precio                | 7 € el metro sin IVA; envío 24 h 5,99 € sin IVA, el 46 % de la base en un pedido de 1 m                                      | Capturas |
| Cancelados            | 4 de 28 (14 %): hay que mirar si son pagos no terminados                                                                     | Capturas |
| Tiendas               | Solo una real (DTF Culture); la otra se llama «prueba»                                                                       | Capturas |
| Comercial             | Un presupuesto, en borrador, de 60,61 €                                                                                      | Capturas |
| Documentos            | El ticket T2026/0003 es del 24-9, con muchos pedidos ya hechos: sugiere muchas ventas sin documento (la consulta B6 lo dice) | Capturas |
| IVA                   | En la captura de octubre el IVA es el 20,27 % de la base, no el 21 %: o hay ventas sin IVA o cupones (consulta D3)           | Capturas |
| Fiabilidad            | El panel se cayó el 16-10 («This page didn't load»); el lector de facturas no funcionaba ni el 7-10 ni el 16-10              | Capturas |
| Margen                | Coste por metro a mano, sin merma, mano de obra, comisiones ni amortización                                                  | Código   |
| Lo que la app no mide | Punto muerto, coste real por metro, economía por tamaño de pedido, margen por cliente, previsión de caja, coste de captación | Código   |

**Lectura:** micro-B2B recién arrancado (autónomos y pequeños talleres que pagan por Bizum),
con mucha capacidad libre. El problema de hoy es vender y saber el coste real, no producir.

---

## 3. Lo que se ha hecho entre el 20 y el 21 de octubre

Todo está en la rama `claude/crm-dtf-app-review-ftg3di`, con commits locales **sin subir**.
Al terminar: `npm run verify` en verde (3.877 pruebas) y el banco SQL «TODO EN VERDE». No se ha
tocado producción ni aplicado ninguna migración.

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

**Nada fiscal ni económico se ha cambiado hoy.** Los hallazgos de los informes 01 y 06 siguen
todos abiertos.

### Lo que te toca hacer, en este orden

1. **Copia de seguridad.** Comprueba que el PITR de Supabase está activo o haz un volcado antes
   de tocar nada.
2. **Mira qué tiene producción.** En el SQL Editor:
   `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;`
   La última tiene que ser `20261030100000` (presupuestos con imágenes, ya en `main`). Si falta
   alguna anterior, aplícala primero. La captura 1 («falta ANTHROPIC_API_KEY») hace sospechar
   que en su día faltaba `20261018100000`.
3. **Cierra la puerta y mira quién hay dentro.**
   - Supabase › Authentication › Sign In / Providers: apaga «Allow new users to sign up» (la app
     no lo usa).
   - Ejecuta la consulta **P4** de `03-seguridad-bd-consultas-produccion.sql`. La migración de
     niveles da nivel _editor_ a toda cuenta que no tenga rol. Si sale alguna que no reconoces,
     dímelo antes de seguir: no la borro yo.
4. **Aplica las 11 migraciones, una a una y en este orden.** Cada una tiene su reversión en
   `supabase/reversiones/` con el mismo nombre.

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
6. **Ejecuta las consultas de cuadre** (todas de solo lectura):
   - `consultas-cuadre.sql` (informe 01): numeración, IVA por trimestre, tickets frente a
     pedidos, cobros, banco, almacén. Cada bloque dice el resultado esperado.
   - Las seis de la sección 9 de `06-economista.md`: pedidos por tamaño, concentración de
     clientes, mes a mes, días de cobro, coste real por metro, proveedores.
   - `03-seguridad-bd-consultas-produccion.sql` (P1 a P10). **Guarda fuera de Supabase el hash
     de P9** (un correo a los tres socios vale) y repítelo cada semana.
7. **Ajustes de panel:** activa MFA para los tres; comprueba el hook de límite de intentos de
   inicio de sesión (Authentication › Hooks), «Prevent use of leaked passwords», la duración de
   la sesión y la región del proyecto. En Vercel (la captura 8 sugiere que despliegas ahí),
   comprueba que la instalación es `npm ci` y no bun.
8. **Prueba a mano** (10 minutos): entrar, navegar Pedidos y Gerencia con `?medir=1`; emitir un
   ticket de prueba y borrarlo; crear un usuario de solo lectura y comprobar que no puede
   guardar nada; abrir el CRM en una tablet.

---

## 4. Los diez hallazgos más importantes

Escala común a todos los informes: **Crítica** = puede traer una sanción, exponer datos de
clientes o romper la facturación ya; **Alta** = error de dinero o de seguridad probable que hay
que cerrar este trimestre; **Media** = cifra engañosa o riesgo con condiciones; **Baja** =
mejora.

| #   | Gravedad | Hallazgo                                                                                                                                                                                                             | Fuente                           | Informe               |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------- |
| 1   | Crítica  | **No está decidido quién factura.** El CRM expide tickets con NIF y numeración y los manda al cliente; la gestoría también emite; la tienda tiene WowInvoice instalado. Verifactu el 1-1-2027                        | Capturas 2 y 5, Código           | 01 H1, 06 §7.1        |
| 2   | Crítica  | **Lo de hoy no está en producción.** Hasta aplicar las 11 migraciones, producción sigue con la vista que enseña correo, NIF y nombre de clientes sin iniciar sesión, y con banco y stock abiertos a cualquier sesión | Código, Banco                    | 03 SEG-01 a 03        |
| 3   | Crítica  | **Fecha de expedición = fecha del pedido.** Un ticket de noviembre de un pedido de septiembre cambia un trimestre ya presentado. Es decisión tuya del 8-10; vale mientras el CRM no declare, y no con Verifactu      | Código                           | 01 H2                 |
| 4   | Alta     | **Tickets de pedidos web que no coinciden con lo cobrado:** líneas antes del cupón y siempre al 21 %. Con un cupón del 10 %, ticket de 121 € por un pedido de 108,90 €                                               | Código; indicio en captura 4     | 01 H4, H5             |
| 5   | Alta     | **El IVA que enseña el CRM no es el 303.** Solo cuenta lo documentado (el IVA se devenga igual), Fiscal y Resultados dan cifras distintas y Resultados deduce IVA de gastos sin factura                              | Código                           | 01 H6, H8, H9         |
| 6   | Alta     | **Devoluciones y cancelados sin rectificativa; y borrar la última factura no sabe si ya salió** al cliente o a la gestoría                                                                                           | Código                           | 01 H3, H7             |
| 7   | Alta     | **Cualquiera puede crearse una cuenta** si el registro libre sigue activo, y no se exige segundo factor                                                                                                              | Código (el panel no lo he visto) | 03 SEG-06, 04 S2, S4  |
| 8   | Alta     | **No se sabe el punto muerto**, la máquina estaría al 5 % y los pedidos de 1-2 m probablemente pierden dinero                                                                                                        | Capturas + Escenario             | 06 §2, §6             |
| 9   | Alta     | **El margen está inflado:** coste por metro a mano, compras reales sin registrar, metros estimados dividiendo entre 7 €                                                                                              | Código, Capturas 1 y 9           | 06 §5                 |
| 10  | Alta     | **Despliegue y dependencias:** `nodemailer` con fallo conocido, `bun.lock` del registro de Lovable, la CI no audita dependencias ni arranca el servidor (la caída del 16-10)                                         | Código, Captura 8                | 04 S3, 05 W3, W4, W12 |

Justo por debajo: semáforos y orden del menú para el equipo (02), tres «beneficios» y cuatro
«facturaciones» que no cuadran entre sí (01 H12), clientes partidos en dos (06 §5.5), RGPD sin
plazos ni forma de borrar a nadie (05 W6), y la empresa elegida como «la primera activa» en vez
de la del usuario (04 S7).

---

## 5. Hoja de ruta

Una tarea por rama, como dice el `CLAUDE.md`. Fechas contadas desde hoy, 21-10-2026.

### 30 días (hasta el 20-11)

| Qué                                                                                                                                      | Área      | Quién                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| Pasos 1 a 8 de la sección 3                                                                                                              | Seguridad | Javier                    |
| Reunión con la gestoría: quién emite desde el 1-1-2027, límite de 3.000 € del ticket (01 H15), WowInvoice                                | Fiscal    | Javier                    |
| Dar de alta a mano las compras de septiembre y octubre, todos los gastos fijos y la jornada real de la máquina                           | Economía  | Javier                    |
| Calcular el punto muerto con las consultas y ponerlo como objetivo de metros                                                             | Economía  | Javier + economista       |
| Rama «dependencias»: `nodemailer` 10, `npm audit` en la CI, prueba de arranque del servidor en la CI, quitar `bun.lock` (con tu permiso) | Seguridad | Equipo                    |
| Tickets que coinciden con lo cobrado: cupones, recargos y tipo de IVA de WooCommerce (01 H4, H5)                                         | Fiscal    | Equipo                    |
| MFA exigido en la base y en el servidor                                                                                                  | Seguridad | Equipo, tras activarlo tú |

### 90 días (hasta el 19-01-2027: Verifactu el 1-1 y el 303 del 4T el 30-1)

| Qué                                                                                                                                                                                                        | Área      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Ejecutar la decisión de la gestoría: o el CRM deja de expedir (documentos internos, sin serie fiscal), o se integra un proveedor certificado. Retirar la excepción de borrar la última factura el 1-1-2027 | Fiscal    |
| Fecha de expedición = día de emisión, con la fecha del pedido aparte (01 H2)                                                                                                                               | Fiscal    |
| Rectificativas parciales desde las devoluciones y aviso de cancelados con documento (01 H7)                                                                                                                | Fiscal    |
| Un solo cálculo de IVA para Fiscal y Resultados, con lo pendiente de documentar a la vista (01 H6, H8, H9)                                                                                                 | Fiscal    |
| Pedido mínimo o cargo de preparación, escalera de precios y envío gratis con umbral, si la consulta 1 lo confirma                                                                                          | Economía  |
| Plan comercial B2B con objetivo en metros                                                                                                                                                                  | Economía  |
| Indicadores: punto muerto, coste real por metro, % de metros estimados, variación con base mínima                                                                                                          | Economía  |
| Alcance por empresa (04 S7, 03 SEG-09) y `UNIQUE (empresa_id, email)` en clientes: antes de tocar pantallas, como pide el `CLAUDE.md`                                                                      | Datos     |
| Semáforos de estado y antigüedad, errores para personas, avisos arriba en Gerencia (02 A1-A5, A8)                                                                                                          | UX        |
| Restos de seguridad: lectura del bucket `compras`, PDF de facturas emitidas que un editor puede sustituir, CSP obligatoria                                                                                 | Seguridad |

### 180 días (hasta el 19-04-2027)

| Qué                                                                                                    | Área        |
| ------------------------------------------------------------------------------------------------------ | ----------- |
| Tres estados de pedido en la aplicación (hoy solo en la base)                                          | Datos       |
| Previsión de caja a 30/60/90 días, días de cobro reales, margen por cliente, rotación del stock textil | Economía    |
| Conmutador «Tabla / Visual», inicio por perfil y menú por tareas (02 B y C)                            | UX          |
| Rendimiento, fases 10 y 11                                                                             | Rendimiento |
| RGPD: plazos de conservación, anonimizar clientes, contratos con encargados (05 W6, W11)               | Legal       |
| Rotar claves de WooCommerce y quitar las columnas en claro (03 SEG-12)                                 | Seguridad   |
| Paquete para la gestoría: 347, 390, bienes de inversión, cálculo del 202 (01 H20, H24)                 | Fiscal      |
| Segunda tienda real, solo si la primera pasa su punto muerto                                           | Economía    |

---

## 6. Cómo he revisado los informes y qué he cambiado

Comprobé contra el código al menos cinco afirmaciones de cada informe. Todas las de fondo son
ciertas; lo que he corregido son números de línea movidos, afirmaciones que ya no valen tras el
trabajo de hoy, contradicciones entre informes y tres exageraciones.

- **01 (contable-fiscal):** comprobados H2, H4, H5, H8, H13, H16, H19 y H20. Corregidos siete
  números de línea. Nota nueva: nada de lo fiscal se ha arreglado hoy; H3 solo cambia en que
  ahora borrar exige administrador; WowInvoice está instalado pero no consta que emita.
- **02 (UX):** comprobados `estadoVariant()`, `StatusBadge`, las fechas de Compras y los
  recuentos. Nota de qué se arregló el 21-10 (tableta, diálogos, móvil), tachada la etiqueta
  «Admin» (ya hay niveles), y unificada la causa de la caída del 16-10 con lo que dice la
  auditoría (sin confirmar).
- **03 (seguridad de la base):** comprobadas las correcciones de SEG-01, 02, 03 y 10 en las
  migraciones. Tabla de estado nueva al principio, con lo que sigue abierto (lectura del bucket
  `compras`, PDF de facturas sustituibles, `empresas` legible, funciones de pertenencia con
  cualquier uuid) y el aviso de ejecutar P4 antes de la migración de niveles.
- **04 (seguridad de la aplicación):** tabla de estado nueva. Corregidas dos contradicciones con
  03 y 05: «ninguna política abierta» no estaba hecho (SEG-03), y el SSRF por logos solo estaba
  cerrado para el logo de la plantilla (W8). S11 ya no aplica.
- **05 (seguridad web):** tabla de estado nueva; pista de que producción está en Vercel
  (captura 8).
- **06 (economista):** comprobadas las cifras de las capturas (todas bien). Corregido: la
  capacidad es el valor por defecto del código, no un ajuste visto en producción, así que el
  5 % es condicional; el lector «no funcionaba» en las capturas, no «no funciona»; WowInvoice
  no consta que emita; el ticket n.º 3 «sugiere», no «indica»; 100 migraciones, no 89.
- **07 (dispositivos):** comprobados el corte de 1280 px y el alto máximo de los diálogos. Sin
  cambios.

Criterio de gravedad: los siete informes usaban ya Crítica, Alta, Media y Baja; la escala de la
sección 4 es la que vale para compararlos entre sí.
