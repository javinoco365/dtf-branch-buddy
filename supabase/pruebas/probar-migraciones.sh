#!/usr/bin/env bash
#
# Ejecuta las migraciones contra un Postgres de verdad, sobre una base vacía,
# y comprueba que el motor de facturación se comporta como debe.
#
# Existe porque aplicar migraciones a ojo contra Supabase significa descubrir
# los fallos uno a uno y en producción. Aquí salen antes. Este banco encontró
# dos que habrían llegado a la base:
#
#   - emitir_factura() fallaba en TODAS las emisiones: jsonb_array_elements(...)
#     AS l nombra el alias de la tabla, no la columna, así que r.l no existía.
#   - Al insertar un pedido con estado, el trigger de sincronización lo
#     machacaba con 'pendiente'. La sincronización de WooCommerce habría dejado
#     todos los pedidos en pendiente sin avisar.
#
# Qué NO comprueba: nada que dependa de la infraestructura real de Supabase.
# auth, storage y vault se sustituyen por lo mínimo (00_entorno_supabase.sql).
# La extensión supabase_vault no existe fuera de Supabase y se omite.
#
# Uso:  ./supabase/pruebas/probar-migraciones.sh
# Necesita: postgresql-16 instalado y un usuario sin privilegios (postgres).

set -euo pipefail

BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=${PG_DIR:-/tmp/pgcrm}
PUERTO=${PG_PUERTO:-55432}
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

if [ "$(id -u)" -eq 0 ]; then
  # Postgres se niega a arrancar como root.
  mkdir -p "$DIR" && chown -R postgres:postgres "$DIR"
  exec su postgres -s /bin/bash -c "PG_BIN='$BIN' PG_DIR='$DIR' PG_PUERTO='$PUERTO' bash '$0'"
fi

export PATH="$BIN:$PATH"
rm -rf "$DIR/data" "$DIR/sock" "$DIR/sql"
mkdir -p "$DIR/data" "$DIR/sock" "$DIR/sql"

initdb -D "$DIR/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DIR/data" -o "-k $DIR/sock -p $PUERTO -h ''" -l "$DIR/log" start >/dev/null
trap 'pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true' EXIT
sleep 2

createdb -h "$DIR/sock" -p "$PUERTO" -U postgres crm
PSQL="psql -h $DIR/sock -p $PUERTO -U postgres -d crm -v ON_ERROR_STOP=1 -q"

cp "$RAIZ/supabase/pruebas/00_entorno_supabase.sql" "$DIR/sql/"
cp "$RAIZ"/supabase/migrations/*.sql "$DIR/sql/"
sed -i 's/^CREATE EXTENSION IF NOT EXISTS supabase_vault.*$/-- (prueba) supabase_vault se simula en 00_entorno_supabase.sql/' \
  "$DIR/sql"/*_credenciales_vault.sql

echo "== Migraciones =="
for f in "$DIR"/sql/*.sql; do
  n=$(basename "$f")
  if salida=$($PSQL -f "$f" 2>&1); then
    printf "  OK    %s\n" "$n"
  else
    printf "  FALLA %s\n" "$n"
    echo "$salida" | grep -E "ERROR|LINE [0-9]" | head -8 | sed "s/^/          /"
    exit 1
  fi
done

echo
echo "== Motor de facturación =="
$PSQL -f "$RAIZ/supabase/pruebas/10_motor_facturacion.sql" 2>&1 \
  | grep -E '^---|^factura|^serie|^base|^estado|^la |^rectificativa|^filas|^produccion|BIEN|MAL|^HUECO|^ROTA' \
  | sed 's/^/  /'

echo
echo "== Auditoría: de quién es cada escritura =="
$PSQL -f "$RAIZ/supabase/pruebas/20_auditoria_autor.sql" 2>&1 \
  | grep -E "BIEN|MAL|ERROR|LINE [0-9]" | sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //' | sed 's/^/  /'

echo
echo "== Credenciales de WooCommerce en Vault =="
$PSQL -f "$RAIZ/supabase/pruebas/30_credenciales_vault.sql" 2>&1 \
  | grep -E "BIEN|MAL|ERROR|LINE [0-9]" | sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //' | sed 's/^/  /'

echo
huecos=$($PSQL -tAc "SELECT count(*) FROM public.facturas_huecos_en_serie();")
rotos=$($PSQL -tAc "SELECT count(*) FROM public.auditoria_verificar();")
if [ "$huecos" = "0" ] && [ "$rotos" = "0" ]; then
  echo "TODO EN VERDE: sin huecos en la serie y con la cadena de auditoría intacta."
else
  [ "$huecos" = "0" ] || echo "FALLO: $huecos hueco(s) en la numeración de facturas."
  [ "$rotos" = "0" ] || {
    echo "FALLO: $rotos eslabón(es) rotos en la cadena de auditoría."
    $PSQL -c "SELECT * FROM public.auditoria_verificar() LIMIT 5;"
  }
  exit 1
fi
