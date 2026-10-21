#!/usr/bin/env bash
#
# Compila el servidor como en producción, lo arranca con node y comprueba que
# sirve páginas.
#
# Existe porque `npm run verify` solo compila: un servidor que compila pero se
# cae al arrancar o al servir la primera página (un `__exportAll is not a
# function`, un módulo que falta en la salida) pasa la verificación y se
# descubre ya desplegado. Aquí sale antes.
#
# Compila con NITRO_PRESET=node-server porque la salida por defecto apunta a
# Cloudflare y no arranca con node (ver CLAUDE.md). Si no hay .env (en la CI),
# las variables VITE_* son de relleno: la compilación necesita que existan, no
# que sean válidas, y estas páginas se sirven sin hablar con Supabase. Con .env
# (en local) se usan las suyas, así que el .output que queda sirve para
# arrancar a mano como dice CLAUDE.md.
#
# Qué NO comprueba: nada que necesite Supabase (iniciar sesión, leer datos,
# server functions). Solo que el servidor arranca, pinta las páginas y sirve
# los ficheros que esas páginas piden.
#
# Uso:  bash scripts/probar-arranque.sh
#       PUERTO=3112 bash scripts/probar-arranque.sh
set -euo pipefail

PUERTO="${PUERTO:-3111}"
BASE="http://127.0.0.1:${PUERTO}"
TMP="$(mktemp -d)"
PID=""

terminar() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap terminar EXIT

# Vite da prioridad al entorno sobre .env: con .env, no se exporta nada.
if [ ! -f .env ]; then
  export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://ejemplo.supabase.co}"
  export VITE_SUPABASE_PROJECT_ID="${VITE_SUPABASE_PROJECT_ID:-ejemplo}"
  export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-clave-de-relleno-para-compilar}"
fi

# Con el puerto ocupado, node sale sin error y las pruebas acabarían pidiendo
# las páginas al servidor que ya estaba ahí.
if curl -s -o /dev/null "$BASE/"; then
  echo "MAL: ya hay algo escuchando en el puerto $PUERTO. Páralo o usa PUERTO=otro."
  exit 1
fi

echo "== Compilando el servidor para node"
NITRO_PRESET=node-server npx vite build > "$TMP/compilacion.log" 2>&1 \
  || { tail -40 "$TMP/compilacion.log"; echo "MAL: no compila"; exit 1; }

echo "== Arrancando en el puerto $PUERTO"
PORT="$PUERTO" node .output/server/index.mjs > "$TMP/servidor.log" 2>&1 &
PID=$!

LISTO=0
for _ in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then
    cat "$TMP/servidor.log"
    echo "MAL: el servidor se ha parado al arrancar"
    exit 1
  fi
  if curl -s -o /dev/null "$BASE/auth"; then
    LISTO=1
    break
  fi
  sleep 0.5
done
if [ "$LISTO" -ne 1 ]; then
  cat "$TMP/servidor.log"
  echo "MAL: el servidor no responde tras 30 s"
  exit 1
fi

FALLOS=0

# Pide una ruta y comprueba el código HTTP y, si se da, un texto del HTML.
pedir() {
  local ruta="$1" esperado="$2" texto="${3:-}" codigo
  # Sin conexión, curl ya escribe 000 en %{http_code}.
  codigo="$(curl -s -o "$TMP/respuesta" -w '%{http_code}' "$BASE$ruta" || true)"
  if [ "$codigo" != "$esperado" ]; then
    echo "MAL   $ruta responde $codigo (esperaba $esperado)"
    FALLOS=$((FALLOS + 1))
  elif [ -n "$texto" ] && ! grep -aq "$texto" "$TMP/respuesta"; then
    echo "MAL   $ruta responde $codigo pero no contiene «$texto»"
    FALLOS=$((FALLOS + 1))
  else
    echo "BIEN  $ruta responde $codigo"
  fi
}

pedir / 307
pedir /auth 200 "<title>"
pedir /panel 200 "<title>"
pedir /panel/pedidos 200 "<title>"

# Los ficheros que pide la página de acceso tienen que existir en la salida.
curl -s "$BASE/auth" > "$TMP/auth.html" || true
ASSETS="$(grep -ao '/assets/[^"]*\.\(js\|css\)' "$TMP/auth.html" | sort -u || true)"
if [ -z "$ASSETS" ]; then
  echo "MAL   /auth no enlaza ningún fichero de /assets"
  FALLOS=$((FALLOS + 1))
fi
for a in $ASSETS; do pedir "$a" 200; done

# Un error en el registro del servidor también es un fallo, aunque responda.
if grep -aiE 'error|exception|is not a function' "$TMP/servidor.log"; then
  echo "MAL   el servidor ha escrito errores en su registro (arriba)"
  FALLOS=$((FALLOS + 1))
fi

if ! kill -0 "$PID" 2>/dev/null; then
  echo "MAL   el servidor se ha parado mientras servía las páginas"
  FALLOS=$((FALLOS + 1))
fi

if [ "$FALLOS" -gt 0 ]; then
  echo "== Registro del servidor"
  cat "$TMP/servidor.log"
  echo "== $FALLOS fallo(s)"
  exit 1
fi
echo "== TODO EN VERDE: el servidor arranca y sirve las páginas"
