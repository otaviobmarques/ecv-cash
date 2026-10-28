#!/bin/bash
# Roda uma única vez, quando o volume do banco nasce vazio: cria os papéis (dono, aplicação, definer) e o banco.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v db="${ECV_DB:-ecv_cash}" -v owner_pw="$ECV_OWNER_PW" -v app_pw="$ECV_APP_PW" -f /bootstrap.sql
