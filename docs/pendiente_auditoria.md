# pendiente_auditoria

Auditoría del CRM del 17-10-2026. El informe completo está en `pendiente_auditoria.pdf`, en esta misma carpeta.
Se retoma solo cuando se trate este tema.

## Falta del propio informe
- [ ] Ejecutar en Supabase las consultas del Anexo A (cifras) y del Anexo B (seguridad) y analizar el resultado.

## Seguridad (semana 1)
- [ ] Doble factor (MFA) para los tres socios y exigirlo para entrar al panel.
- [ ] Actualizar `nodemailer`: tiene un fallo grave publicado que puede mezclar credenciales SMTP entre tiendas.
- [ ] Regenerar las claves de WooCommerce de cada tienda y vaciar las columnas en claro (`consumer_key`, `consumer_secret`).
- [ ] Cabeceras de seguridad en `src/server.ts`: CSP, HSTS y X-Frame-Options.
- [ ] Confirmar en Supabase que la copia recuperable al minuto (PITR) está activa, y que hay límite de intentos de inicio de sesión.
- [ ] Confirmar con el Anexo B que no queda activa ninguna política `FOR ALL` ni ninguna política abierta en las tablas de dinero.

## Técnica
- [ ] CI: compilar como producción, arrancar el servidor y pedir «/» (lo que habría evitado la caída del 16-10).
- [ ] Alertas de errores en producción (Sentry o similar).
- [ ] Regenerar los tipos de Supabase (hoy cubren 25 de unas 60 tablas) y comprobar en CI que están al día.
- [ ] Pruebas de los 5 flujos de dinero: emitir, cobrar, conciliar, borrar la última factura y sincronizar Woo.
- [ ] Prueba que impida importar un mismo módulo de forma estática y dinámica a la vez.
- [ ] Borrar `bun.lock`.
- [ ] Reducir la carga inicial (unos 740 KB).
- [ ] Partir los ficheros de más de 1.300 líneas cuando se toquen.

## Dinero (puntos débiles)
- [ ] Conciliar el banco también con cobros y tickets, no solo con facturas.
- [ ] Ventas en efectivo apuntadas directamente en Caja sin cobro de pedido.
- [ ] Terminar los tres estados de pedido.
- [ ] Cliente único por `(empresa_id, email)` y fusión de duplicados.

## Mejoras del CRM (por prioridad)
1. [ ] Avisos de cobro automáticos (7, 15 y 30 días).
2. [ ] Ficha de deuda y riesgo por cliente.
3. [ ] Rentabilidad por cliente y por tienda.
4. [ ] Precio mínimo por metro.
5. [ ] Clientes dormidos, con acción para escribirles.
6. [ ] Coste por metro real (compras de consumibles entre metros impresos).
7. [ ] Previsión de caja a 30, 60 y 90 días.
8. [ ] Paquete trimestral para la gestoría.
9. [ ] Pago por enlace en presupuestos y facturas.
10. [ ] Cliente único DTF + textil y cola de producción.

## Obligatorio antes del 1-1-2027
- [ ] Verifactu: decidir quién emite; si es el CRM, integrar un proveedor certificado y revisar el borrado de la última factura y la fecha de los documentos.
