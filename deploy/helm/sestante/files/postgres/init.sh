#!/bin/bash
# Primo avvio del database: un utente e un database ciascuno per Sestante e per
# Keycloak, così i due non condividono né tabelle né permessi.
# Lo esegue l'immagine postgres una volta sola, su un volume vuoto.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
	CREATE USER sestante WITH PASSWORD '${APP_DB_PASSWORD}';
	CREATE DATABASE sestante OWNER sestante;
	CREATE USER keycloak WITH PASSWORD '${APP_DB_PASSWORD}';
	CREATE DATABASE keycloak OWNER keycloak;
SQL
