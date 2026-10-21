# 03 · Seguridad de la base de datos (Postgres / Supabase)

Informe del auditor de seguridad de base de datos. Fecha: 20-10-2026. Solo diagnóstico y
propuesta: **no se ha cambiado ni una línea de la aplicación, ni de las migraciones, ni de
las pruebas.** Los únicos ficheros nuevos son este informe y sus dos anexos:

- `docs/informe-empresa/03-seguridad-bd-demostraciones.sql`: las demostraciones, que se
  reproducen en el banco local (instrucciones en su cabecera).
- `docs/informe-empresa/03-seguridad-bd-consultas-produccion.sql`: diez consultas **de solo
  lectura** para que Javier compruebe en el SQL Editor de Supabase lo que yo no he podido ver.

## De dónde salen estas conclusiones (y qué no puedo saber)

- **Las 89 migraciones** de `supabase/migrations/` aplicadas sobre PostgreSQL 16 con el
  banco del repositorio. `PG_DIR=/tmp/pg-segbd PG_PUERTO=55505 bash
supabase/pruebas/probar-migraciones.sh` termina **TODO EN VERDE**: las pruebas existentes
  pasan. Los fallos de este informe no los mira ninguna prueba.
- Una **segunda base, `seg`**, con las mismas migraciones pero **sin las pruebas** y con los
  privilegios por defecto que Supabase fija en el esquema `public` de cualquier proyecto
  (`ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated, service_role`). El
  simulador `00_entorno_supabase.sql` no los reproduce y varias pruebas hacen
  `GRANT ALL ON ALL TABLES` (ver SEG-11), así que el banco tal cual **no puede** ver los
  fallos de permisos. Todas las demostraciones se hacen en `seg`.
- El código de `src/lib/*.functions.ts` y `src/integrations/supabase/`, leído sin tocarlo,
  para saber qué funciones llama la aplicación y con qué cliente.
- Las capturas de Javier: no aportan nada a la seguridad de la base. Solo anoto que la 1
  muestra «Falta la variable ANTHROPIC_API_KEY», cuando la migración `20261018100000`
  guarda esa clave en Vault (lo verá el informe técnico, no es de este).

**Límites, dicho claro:**

1. **No he visto producción.** No sé qué migraciones están aplicadas allí, ni si alguien
   creó políticas a mano en el editor de Lovable. Todo lo que digo es «el repositorio,
   aplicado entero, hace esto». Las consultas P1–P10 del anexo lo confirman o desmienten.
2. **No sé si el registro público de Supabase está abierto** (Authentication → Sign In /
   Providers → «Allow new users to sign up»). Es la palanca que más cambia la gravedad: con
   él abierto, cualquiera con la clave pública (va en el JavaScript de la web) se crea una
   cuenta y pasa a ser `authenticated`. Lo trato en SEG-06.
3. No he podido leer `docs/pendiente_auditoria.pdf` (no hay herramientas de PDF en el
   contenedor), así que no conozco las consultas exactas de su «Anexo B». Las de mi anexo
   cubren lo mismo que el `.md` describe.
4. Los tiempos de R1 son de este contenedor con 50.000 pedidos sintéticos; la proporción
   vale, los milisegundos no.

## Resumen para Javier

La base está **mucho mejor de lo normal** en lo difícil: RLS activada en las 58 tablas, ningún
`FOR ALL`, facturas inmutables por trigger, numeración con bloqueo, auditoría con trigger en
53 tablas, credenciales leídas solo por la clave de servicio, y la cabecera `x-usuario-id`
**no se puede falsificar** desde el navegador (lo he comprobado). Pero hay cinco agujeros que
sí importan:

1. **Una vista enseña clientes (correo, NIF, nombre) a quien no ha iniciado sesión**
   (SEG-01). Solo hace falta la clave pública de la web.
2. **El registro de quién hizo qué se puede falsificar**: `banco_conciliar()` acepta el
   autor como parámetro y cualquier usuario la puede llamar directamente. Un socio puede
   marcar facturas como pagadas firmando como otro (SEG-02). Ataca justo «el único control»
   que dice `CLAUDE.md`.
3. **Las tablas de dinero del banco y del stock no miran quién eres**: cualquier cuenta con
   sesión lee todos los movimientos bancarios e inserta movimientos falsos (SEG-03). El punto
   de `pendiente_auditoria.md` «ninguna política abierta en las tablas de dinero» **no está
   cumplido** en el repositorio.
4. **Funciones y server functions que actúan sin comprobar pertenencia ni rol** (SEG-04 y
   SEG-05): entregar pedidos textiles ajenos, retirar stock, borrar apuntes de caja o gastos
   fijos con la clave de servicio.
5. **La cadena de auditoría se puede reescribir entera** desde el SQL Editor sin que
   `auditoria_verificar()` lo note (SEG-08): no hay ancla fuera de Supabase.

Hoy los tres usuarios son administradores, y para un administrador las políticas de
pertenencia ya dejan pasar todo; por eso 3, 4 y 5 **no cambian lo que un socio puede ver**.
Lo que cambian es lo que puede **hacer sin dejar su nombre** (2), lo que puede hacer **una
cuenta que no debería existir** (si el registro está abierto o se crea un usuario de tienda)
y lo que pasará **el día que haya una segunda empresa**.

## Tabla de hallazgos

| Id     | Gravedad | Qué                                                                                                               | Demostrado en el banco  |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SEG-01 | Crítica  | `clientes_duplicados_por_email` se salta la RLS y la lee `anon`                                                   | Sí (S1)                 |
| SEG-02 | Alta     | `banco_conciliar` / `banco_desconciliar`: autor por parámetro, ejecutables por usuarios                           | Sí (S2c–S2f)            |
| SEG-03 | Alta     | Políticas `USING (true)` / `WITH CHECK (true)` en banco, conciliaciones, stock, contadores                        | Sí (S2a, S2b, S3c, S4)  |
| SEG-04 | Alta     | Funciones `SECURITY DEFINER` sin comprobación de pertenencia, ejecutables por usuarios                            | Sí (S3a, S3b, S3d, S3e) |
| SEG-05 | Alta     | Server functions que escriben con la clave de servicio sin comprobar rol ni pertenencia                           | No (código)             |
| SEG-06 | Alta*    | Quién es `authenticated`: registro público sin verificar y sin MFA en la base                                     | No (configuración)      |
| SEG-07 | Media    | Storage: `compras` legible por cualquier sesión y sin límites; PDF de facturas reemplazables                      | Sí (S6)                 |
| SEG-08 | Media    | La cadena de auditoría no tiene ancla externa: el rol propietario la reescribe                                    | Sí (S8)                 |
| SEG-09 | Media    | El rol admin es global: no hay aislamiento entre empresas para administradores                                    | Por lectura             |
| SEG-10 | Baja     | `TRUNCATE`, `TRIGGER`, `REFERENCES` concedidos a `anon` y `authenticated` en 51 tablas                            | Sí (S5)                 |
| SEG-11 | Baja     | El banco de pruebas no puede ver fallos de permisos                                                               | Sí                      |
| SEG-12 | Baja     | Credenciales de WooCommerce: columnas en claro y lectura de respaldo siguen                                       | Por lectura             |
| SEG-13 | Baja     | Endurecimientos: `search_path` sin `pg_temp`, `rls_auto_enable` solo `CREATE TABLE`, `empresas` legible por todos | Por lectura             |
| R1     | (rend.)  | Las políticas llaman a la función de pertenencia fila a fila: 1.150 ms → 6 ms                                     | Sí (R1)                 |

\* Alta si el registro está abierto; si está cerrado, baja.

---

## SEG-01 · Crítica · Una vista enseña los clientes a quien no ha iniciado sesión

**Dónde.** `supabase/migrations/20260902120400_clientes_globales.sql:80-102`, vista
`public.clientes_duplicados_por_email`.

**Qué pasa.** La vista se creó sin `security_invoker`, así que se ejecuta con los permisos de
su dueño (`postgres`), que se salta la RLS de `clientes`, `pedidos`, `facturas` y `tiendas`.
La migración solo hace `GRANT SELECT … TO authenticated`, creyendo que así `anon` no la ve;
pero Supabase concede por defecto `ALL` sobre toda relación nueva de `public` a `anon`, y
nadie lo revoca. Resultado: con la clave pública (`SUPABASE_PUBLISHABLE_KEY`, que va en el
navegador), una petición a `/rest/v1/clientes_duplicados_por_email` devuelve correo, NIF,
nombres y tienda de **todos los clientes con correo repetido**, de todas las empresas.

**Demostración (S1).**

```
DEMOSTRADO S1. anon (sin sesión) lee la vista clientes_duplicados_por_email:
  compras@cliente-demo.test B00000000 Cliente Demo / Cliente Demo SL
control S1. anon NO lee la tabla clientes directamente (la RLS sí funciona ahí): 0 filas
```

Las otras dos vistas (`clientes_posibles_duplicados`, `pedidos_pendientes_cobro`) sí tienen
`security_invoker = true` y no fugan.

**Por qué es crítica.** Son datos personales de clientes B2B (RGPD) accesibles sin
contraseña, y la vista existe para el caso exacto en que hay duplicados (las fichas de
WooCommerce los generan). No depende del registro público.

**Arreglo propuesto** (migración nueva; **no la he escrito**: lo pide Javier):

```sql
ALTER VIEW public.clientes_duplicados_por_email SET (security_invoker = true);
REVOKE ALL ON public.clientes_duplicados_por_email,
              public.clientes_posibles_duplicados,
              public.pedidos_pendientes_cobro FROM anon;
```

Reversible (`ALTER VIEW … RESET (security_invoker)`), sin tocar datos. Prueba: como `anon`,
0 filas; como socio, las mismas filas que antes. **Comprobar en producción con P1.**

---

## SEG-02 · Alta · El autor de una conciliación se pasa como parámetro

**Dónde.** `banco_conciliar(_usuario_id, _movimiento_id, _factura_id, _motivo)` y
`banco_desconciliar(_usuario_id, _movimiento_id)`: creadas en
`20260903280000_conciliacion_bancaria.sql:125-153`, repuestas en
`20261003100000_reponer_borrado_tiendas_y_banco.sql:181-203` con
`GRANT EXECUTE … TO authenticated` y reescritas en `20261017100000_conciliacion_motor.sql:406-440`
(el `CREATE OR REPLACE` conserva ese permiso). La aplicación las llama con el JWT del usuario
(`src/lib/banco.functions.ts:312` y `:325`, `context.supabase`), pasando `context.userId`.

**Qué pasa.** Son `SECURITY DEFINER`, reciben el autor como argumento y lo fijan en
`app.usuario_id`, que `auditoria_autor()` mira **antes** que `auth.uid()`. Nada comprueba
que el autor sea quien llama. Cualquiera con sesión puede saltarse la server function y
llamar a `/rest/v1/rpc/banco_conciliar` con el uuid de otro socio. El uuid se obtiene de la
propia base: `banco_conciliaciones.conciliado_por` es legible por cualquiera (SEG-03).

**Demostración (S2c–S2f).** Una cuenta sin rol ni tienda:

```
DEMOSTRADO S2c. la cuenta sin rol inserta un movimiento bancario falso en la empresa (WITH CHECK (true))
DEMOSTRADO S2d. y con banco_conciliar(_usuario_id => socio, ...) lo concilia contra una factura ajena
DEMOSTRADO S2e. la factura emitida (numero 2) queda «pagada» sin haber cobrado nada
DEMOSTRADO S2f. la auditoría firma 4 cambio(s) de ese movimiento/factura como hechos por el SOCIO
```

Entre los tres socios no hace falta ni cuenta falsa: cualquiera firma como otro.

**Arreglo propuesto.** Dentro de las dos funciones, antes de nada:

```sql
IF auth.uid() IS NOT NULL AND _usuario_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'El autor tiene que ser quien llama' USING ERRCODE = '42501';
END IF;
```

Compatible con la aplicación actual (pasa su propio `context.userId`). Alternativa más limpia:
`REVOKE EXECUTE … FROM authenticated` y que `banco.functions.ts` use `banco_enlazar` /
`banco_desenlazar`, que ya toman el autor de `auth.uid()`. Regla general para el futuro:
**una función con `_usuario_id` nunca se concede a `authenticated`** (hoy solo estas dos lo
incumplen; P3 lo vigila).

---

## SEG-03 · Alta · Políticas abiertas en las tablas de dinero y de stock

**Dónde.** Consulta P2. En el repositorio quedan doce políticas abiertas:

| Tabla                       | Operaciones abiertas                                        | Migración                                      |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `banco_movimientos`         | SELECT `true`, INSERT `true`, DELETE (solo «no conciliado») | `20261003100000_…:213-226`                     |
| `banco_conciliaciones`      | SELECT `true`                                               | `20261003100000_…:228-230`                     |
| `textil_stock_movimientos`  | SELECT `true`, INSERT `true`                                | `20260903200000_stock_movimientos.sql:206-212` |
| `textil_stock_reservas`     | SELECT, INSERT, UPDATE, DELETE `true`                       | `20260903220000_stock_reservas.sql:168-185`    |
| `contadores`                | SELECT `true`                                               | `20260903300000_contadores.sql:151-153`        |
| `empresas`                  | SELECT `true`                                               | `20260902120000_empresas.sql:234-236`          |
| `storage.objects` (compras) | SELECT por `bucket_id` solo                                 | ver SEG-07                                     |

Todas tienen `empresa_id` (o la heredan del movimiento), así que la condición correcta
existe; simplemente no se puso. `20261023100000_politicas_por_operacion.sql` quitó los
`FOR ALL` «con el mismo acceso», y el mismo acceso incluía estos `true`.

**Demostración.** Cuenta sin rol ni tienda (S2a, S2b, S3c) y usuario solo de tienda (S4):

```
DEMOSTRADO S2a. una cuenta sin rol ni tienda lee banco_movimientos: 1 movimiento(s), p. ej. «TRANSF CLIENTE DEMO» 121.00
DEMOSTRADO S2b. y banco_conciliaciones, con el uuid del socio que concilió: aaaaaaaa-…
DEMOSTRADO S3c. la cuenta sin rol anota una merma de -6 en el libro de stock de la empresa
DEMOSTRADO S4. un usuario solo de tienda ve y puede tocar todo el banco y el stock de la empresa
control S2. la misma cuenta NO ve facturas (0 filas): la RLS de facturas sí filtra
```

El trigger `stock_aplicar_movimiento` es `SECURITY DEFINER`: el movimiento falso cambia la
cantidad de `textil_stock` aunque el usuario no pueda escribir en esa tabla.

**Arreglo propuesto.** Una migración que recree cada una por operación con
`public.es_miembro_empresa(auth.uid(), empresa_id)` (en `banco_conciliaciones`, con `EXISTS`
sobre su movimiento; en `empresas`, con `id`). Hay que hacerla **junto con** la reescritura
de lectura de `docs/rendimiento/plan.md` (fase 3, `mis_empresas()`), para no tocar dos veces
las mismas políticas, y añadir esas seis tablas a la lista de la fase 3. Prueba nueva en
`supabase/pruebas/`: usuario de otra empresa y cuenta sin rol, 0 filas y alta rechazada en
cada tabla.

---

## SEG-04 · Alta · Funciones `SECURITY DEFINER` sin comprobar a quién pertenece lo que tocan

Todas tienen `search_path` fijado (bien). El problema es que **cualquier** usuario con sesión
las puede llamar por `/rest/v1/rpc/…` y no miran la empresa del objeto:

| Función                                                                                                           | Qué hace sin comprobar                                                | Demostrado |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| `textil_pedido_entregar(uuid)`                                                                                    | Convierte en venta las reservas de cualquier pedido y descuenta stock | S3a        |
| `textil_stock_retirar(uuid)`                                                                                      | Borra o desactiva cualquier variante de stock                         | lectura    |
| `siguiente_numero(uuid,text,int)`                                                                                 | Consume números de presupuesto/pedido de cualquier empresa            | S3b        |
| `tienda_resumen_borrado(uuid)`                                                                                    | Nombre y recuentos de cualquier tienda                                | S3d        |
| `smtp_estado(uuid)`                                                                                               | Servidor y usuario SMTP de cualquier tienda (no la clave)             | lectura    |
| `serie_estado`, `serie_mayor_numero`, `facturas_huecos_en_serie`, `stock_descuadres`, `stock_reservas_descuadres` | Datos de cualquier empresa                                            | lectura    |
| `auditoria_verificar()`                                                                                           | Recorre toda la auditoría: coste alto a demanda de cualquiera         | lectura    |
| `has_role`, `is_tienda_member`, `es_miembro_empresa`                                                              | Aceptan cualquier uuid: oráculo de quién es admin                     | S3e        |

Además, `factura_borrar_ultima()` exige solo `is_tienda_member`: un **usuario de tienda no
administrador** puede borrar la última factura de la serie. `CLAUDE.md` dice que los socios
son administradores; si se crea un usuario de tienda, ¿debe poder? Decisión de Javier.

**Arreglo propuesto.** En cada función de escritura, el mismo patrón que ya usa
`textil_compra_registrar` (`IF auth.uid() IS NOT NULL AND NOT es_miembro_empresa(auth.uid(),
v_empresa) THEN RAISE …`). Las de solo diagnóstico (`serie_*`, `*_descuadres`,
`auditoria_verificar`, `facturas_huecos_en_serie`): exigir `has_role(auth.uid(),'admin')` o
`REVOKE EXECUTE … FROM authenticated` si solo las llama el servidor. Las tres de pertenencia
las necesitan las políticas y no se pueden revocar; basta con que ignoren un `_user_id`
distinto de `auth.uid()` cuando hay sesión (o cambiar las políticas a `mis_tiendas()` /
`mis_empresas()`, que no reciben usuario).

---

## SEG-05 · Alta · Server functions con la clave de servicio sin comprobar rol

**Dónde (leído, no demostrado en SQL).** `CLAUDE.md`: «`supabaseAdmin` solo tras verificar
rol o pertenencia». `requireSupabaseAuth` solo comprueba que el token es válido. Estas
escriben con `adminComoUsuario(context.userId)` (clave de servicio, salta la RLS) sin
comprobar nada antes:

- `src/lib/caja.functions.ts`: `guardarMovimientoCaja` (111), `borrarMovimientoCaja` (150),
  `guardarConceptoCaja` (176), `guardarSocioCaja` (215).
- `src/lib/gerencia.functions.ts`: `guardarAjustesGerencia` (157), `guardarGastoFijo` (201),
  `borrarGastoFijo` (262), `guardarObjetivo` (275), `borrarObjetivo` (311).
- `src/lib/inversion.functions.ts`: `guardarInversion` (54), `borrarInversion` (100).
- Por revisar con el mismo criterio (no he seguido cada rama): las subidas a Storage de
  `compras.functions.ts` y `presupuesto-imagenes.functions.ts`, y `presupuestos.functions.ts`.

Sí comprueban: `pedidos`, `facturas`, `cobros`, `smtp`, `woocommerce`, `admin`, `archivo`.

**Por qué importa.** La RLS de `caja_movimientos`, `inversion_movimientos` o
`gerencia_gastos_fijos` exige `es_miembro_empresa`; estas funciones la anulan. Un usuario
solo de tienda (o una cuenta del registro público) borra apuntes de caja y de inversión de
los socios. Queda auditado con su nombre, eso sí.

**Arreglo propuesto.** Un ayudante `exigirAdmin(context)` (o `exigirMiembroEmpresa`) antes de
crear el cliente de servicio, o mejor: escribir con `context.supabase` (la RLS ya hace el
trabajo y el autor sale del JWT) donde no haga falta saltarla. Es código, no migración.

---

## SEG-06 · Alta si el registro está abierto · Quién es `authenticated`

Todo lo anterior empeora o mejora según **quién puede tener sesión**:

- La aplicación crea usuarios solo por `auth.admin.createUser` (`admin.functions.ts:39` y
  `:109`) y no usa `signUp`. Pero el endpoint público `/auth/v1/signup` de Supabase existe
  aunque la aplicación no lo use, y viene **activado** por defecto. No puedo ver si está
  apagado. **P4** lista cuentas sin rol ni tienda: si sale alguna que no reconocéis, está
  abierto y alguien ha entrado.
- `handle_new_user()` crea el perfil a cualquiera que se registre; no da rol ni tienda (bien).
- **MFA**: ninguna política ni función mira `auth.jwt() ->> 'aal'`. Activar el doble factor
  en Supabase no obliga a usarlo: con contraseña sola se entra igual. Es el primer punto de
  «Seguridad (semana 1)» de `pendiente_auditoria.md`, y la base no lo exige.

**Arreglo propuesto.** (1) Apagar «Allow new users to sign up» en el panel (no rompe nada:
la app no lo usa). (2) Tras dar de alta el MFA a los tres socios, una política
**restrictiva** por tabla de negocio:
`CREATE POLICY "exige mfa" ON public.<tabla> AS RESTRICTIVE TO authenticated USING ((SELECT auth.jwt() ->> 'aal') = 'aal2');`
Ojo: las server functions que usan la clave de servicio no pasan por ahí; el middleware de
la aplicación tendría que exigir `aal2` también.

---

## SEG-07 · Media · Storage

Consulta P8 y políticas de `storage.objects` (P2):

- **`compras`**: lectura `bucket_id = 'compras'` sin más (cualquier sesión lee todas las
  facturas de proveedor, **S6**); sin `file_size_limit` ni `allowed_mime_types`.
- **`facturas`**: los miembros de la tienda pueden `UPDATE` y `DELETE` los PDF de su carpeta
  (`facturas_update_miembros`, `facturas_delete_miembros`). El PDF de una factura emitida se
  puede sustituir por otro distinto; la fila de la factura no cambia, pero el documento que
  se descarga y se manda al cliente, sí. La regla «una factura emitida no se edita» debería
  alcanzar a su PDF: alta solo, sin reemplazo ni borrado salvo por el servidor (y el de
  `factura_borrar_ultima`).
- **`logos`**: público (normal) y sin límite de tipo: un administrador podría subir un SVG
  con script. Bajo.
- `presupuestos` y la carpeta `textil/` de `facturas` están bien.

---

## SEG-08 · Media · La cadena de auditoría no tiene ancla

`auditoria` es de verdad _append-only_ para la aplicación: sin `INSERT/UPDATE/DELETE/TRUNCATE`
para `service_role`, trigger `auditoria_inmutable_trg` y hash encadenado. Pero el hash es
SHA-256 de los propios datos, sin secreto ni copia externa. Quien tenga el rol propietario
(el SQL Editor del panel de Supabase entra como `postgres`) desactiva el trigger, cambia una
fila y recalcula la cadena:

```
antes: auditoria_verificar() = 0 eslabones rotos
DEMOSTRADO S8. tras cambiar autor y contenido de una fila y recalcular la cadena, auditoria_verificar() = 0 eslabones rotos
```

Con tres socios con acceso al panel, «el único control es el registro» depende de que
ninguno toque la tabla a mano. **Propuesta:** anotar fuera de Supabase el último hash (P9)
cada día o semana (un correo automático a los tres basta) y que `auditoria_verificar()` se
compare con esa ancla. No es la huella de Verifactu ni la toca: es un control interno.

---

## SEG-09 · Media · El administrador ve todas las empresas

`is_tienda_member` y `es_miembro_empresa` devuelven `true` para `has_role(…,'admin')` sin mirar
la empresa, y `user_roles` no tiene `empresa_id`. Con una sola empresa da igual; con dos, un
administrador de una ve y toca la otra. `empresas` además es legible por cualquier sesión
(incluye los costes por metro). Hay que decidirlo antes de dar de alta la segunda empresa
(`CLAUDE.md`: «el modelo debe soportar varias sin migración»).

---

## SEG-10 · Baja · Privilegios de más a `anon` y `authenticated`

Por los privilegios por defecto de Supabase, `anon` y `authenticated` tienen `TRUNCATE`,
`TRIGGER` y `REFERENCES` en 51 tablas (S5), y `anon` tiene `SELECT/INSERT/UPDATE/DELETE` en
casi todas. La RLS frena las cuatro últimas; **`TRUNCATE` se salta la RLS y los triggers de
fila (la auditoría incluida)**. PostgREST no expone `TRUNCATE`, así que hoy no es explotable
desde la web; es defensa en profundidad:

```sql
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
```

Y valorar `REVOKE ALL … FROM anon` en todo `public` (la aplicación no lee datos sin sesión;
habría que confirmar que la página pública de seguimiento no lo necesita).

---

## SEG-11 · Baja · El banco de pruebas no puede ver estos fallos

- `00_entorno_supabase.sql` no simula los privilegios por defecto de Supabase: en el banco,
  `anon` no tiene nada sobre las vistas, así que SEG-01 no puede salir.
- `20_auditoria_autor.sql` hace
  `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role` y **no lo
  deshace** (`C11_…`, `C18_…` y `C19_…` hacen lo mismo, pero dentro de una transacción que
  se deshace). Desde la prueba 20, `service_role` vuelve a tener `INSERT/UPDATE/DELETE/TRUNCATE`
  sobre `auditoria` en el banco (comprobado en `relacl` al acabar), y ninguna prueba
  posterior detectaría que una migración rompiera ese `REVOKE`.

**Propuesta:** mover los `ALTER DEFAULT PRIVILEGES` al simulador, quitar los `GRANT ALL` de
las pruebas y añadir una prueba de permisos que falle si (a) hay una vista sin
`security_invoker`, (b) una política `true` en una tabla con `empresa_id`, (c) una función
`SECURITY DEFINER` con `_usuario_id` ejecutable por `authenticated`. Las tres son P1–P3.

---

## SEG-12 · Baja · Credenciales en claro

`tienda_credenciales_guardar()` ya guarda en Vault y deja `''` en las columnas en claro, y
solo `service_role` lee (`tienda_credenciales_leer`, `smtp_leer`, `clave_lector_facturas`).
Bien. Pero las columnas `consumer_key` / `consumer_secret` siguen existiendo y
`tienda_credenciales_leer` las usa de respaldo. Ya está en `pendiente_auditoria.md`
(regenerar claves y vaciarlas). **P6** dice, sin enseñar nada, si alguna tienda sigue con
clave en claro. Después: migración que borre las columnas y el respaldo.
`auditoria_enmascarar()` cubre los nombres sensibles actuales.

---

## SEG-13 · Baja · Endurecimientos

- `search_path = public` sin `pg_temp` al final: la recomendación de PostgreSQL es
  `SET search_path = public, pg_temp` (o `''` con todo cualificado). Las funciones revisadas
  cualifican con `public.` casi siempre y PostgREST no permite crear tablas temporales, así
  que es teórico.
- `rls_auto_enable()` solo actúa en `CREATE TABLE`: no en `CREATE TABLE AS` / `SELECT INTO`
  y nunca en vistas (por eso SEG-01 pasó sin aviso).
- Las cinco tablas sin trigger de auditoría (`profiles`, `empresa_global`,
  `auth_intentos_fallidos_login`, `woo_sincronizacion`, `auditoria`) son las documentadas.

---

## R1 · Rendimiento: lo que la seguridad tiene que ver con la rapidez

Javier ha pedido también rapidez. Las políticas de lectura llaman a
`is_tienda_member(auth.uid(), tienda_id)` / `es_miembro_empresa(…)` **por cada fila**, y son
`SECURITY DEFINER` (Postgres no las puede «desplegar» en la consulta). Con 50.000 pedidos
sintéticos, leídos por un administrador:

| Política de `pedidos`                             | Tiempo              |
| ------------------------------------------------- | ------------------- |
| La actual                                         | 1.159 ms            |
| Solo envolviendo `auth.uid()` en `(SELECT …)`     | 1.144 ms (no basta) |
| `(SELECT has_role(...)) OR is_tienda_member(...)` | 6 ms                |

Coincide con la fase 3 de `docs/rendimiento/plan.md` (`mis_tiendas()` / `mis_empresas()`).
Dos observaciones de seguridad para esa fase: (1) que `mis_tiendas()` no reciba usuario
(lo toma de `auth.uid()`) y se revoque a `anon`, como dice el plan; (2) **que la misma
migración cierre SEG-03**: si se reescriben las lecturas de 13 tablas y se dejan los `true`
de banco y stock, habrá que volver a tocarlas.

---

## Lo que está bien (comprobado, no supuesto)

- RLS activada en las 58 tablas de `public`; ninguna política `FOR ALL` (P2).
- `facturas`, `factura_items`, `textil_facturas`, `textil_factura_items`: sin
  `INSERT/UPDATE/DELETE` para usuarios; triggers `*_inmutable` y `textil_facturas_no_borrar`.
- Emisión, anulación, cobros, `serie_fijar_inicio` y las funciones de credenciales: solo
  `service_role`.
- **`x-usuario-id` no se falsifica desde el navegador**: con rol `authenticated`,
  `auditoria_autor()` la ignora (S7). Solo la acepta con la clave de servicio.
- `adminComoUsuario()` valida el uuid antes de ponerlo en la cabecera.
- `smtp_config`, `tienda_credenciales` y `auth_intentos_fallidos_login`: sin acceso para
  `anon` ni `authenticated`.
- `auditoria`: solo lectura para administradores; `service_role` sin escritura.

## Los puntos de `docs/pendiente_auditoria.md` que tocan a la base

| Punto                                                      | Estado según el repositorio                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Ejecutar el Anexo B (seguridad) en Supabase                | Pendiente. Mi anexo P1–P10 lo cubre; no he podido leer el PDF                                                                  |
| MFA para los tres socios y exigirlo                        | **No exigido en la base** (SEG-06)                                                                                             |
| Regenerar claves de WooCommerce y vaciar columnas en claro | Código listo; producción sin verificar (P6, SEG-12)                                                                            |
| PITR y límite de intentos de inicio de sesión              | PITR no se ve desde SQL. El límite existe (`20260921100000`) pero **hay que activar el hook a mano** en Authentication → Hooks |
| Ningún `FOR ALL` ni política abierta en tablas de dinero   | `FOR ALL`: cumplido. Políticas abiertas: **no cumplido** (SEG-03)                                                              |

## Orden recomendado (cada punto, una rama y una migración)

1. **SEG-01** (una línea, crítica, sin riesgo) y apagar el registro público (SEG-06, panel).
2. **SEG-02** (dos funciones) y **SEG-05** (código: comprobar rol antes de la clave de servicio).
3. **SEG-03 + R1** en la misma migración de políticas, con pruebas de aislamiento.
4. **SEG-04** y **SEG-07** (funciones y Storage).
5. **SEG-08** (ancla del hash) y MFA obligatorio (SEG-06).
6. **SEG-11** (banco de permisos), después SEG-10, SEG-12, SEG-13, y SEG-09 antes de la
   segunda empresa.

## Anotado por el camino (sin arreglar)

- `bootstrapPrimerAdmin` (`admin.functions.ts:9-55`) no exige sesión: es correcto solo
  mientras haya algún administrador; dos peticiones simultáneas con la base sin admins
  crearían dos. Bajo.
- Escrituras con `supabaseAdmin` sin autor en `correos.functions.ts:144`
  (`pedido_correos_enviados`): quedan sin autor en la auditoría. P10 enseña cuántas hay.
- La captura 1 de Javier (falta `ANTHROPIC_API_KEY`) sugiere que producción no tiene
  aplicada `20261018100000_clave_lector_facturas.sql` o que el código aún mira la variable
  de entorno. No es de seguridad; se lo paso al informe técnico.
