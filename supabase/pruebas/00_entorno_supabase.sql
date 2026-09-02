-- Simulación del entorno Supabase para las pruebas locales. Ver probar-migraciones.sh.
-- Simulación mínima del entorno que Supabase da por hecho.
-- No pretende ser fiel: solo lo justo para que las migraciones se puedan
-- validar sintáctica y semánticamente contra un Postgres real.

DO $r$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $r$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS vault;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Vault: la extensión real no está disponible fuera de Supabase.
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secret text, name text, description text
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id, secret AS decrypted_secret FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(text, text, text) RETURNS uuid
LANGUAGE sql AS $$ INSERT INTO vault.secrets(secret, name, description) VALUES ($1,$2,$3) RETURNING id $$;
CREATE OR REPLACE FUNCTION vault.update_secret(uuid, text) RETURNS void
LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = $2 WHERE id = $1 $$;

GRANT USAGE ON SCHEMA public, auth, storage, extensions, vault TO anon, authenticated, service_role;

-- storage.foldername(): la aporta Supabase. Devuelve los tramos de carpeta de
-- una ruta, sin el nombre del fichero.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
