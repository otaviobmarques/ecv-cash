#!/usr/bin/env bash
# Cria papéis e banco. Uso: ECV_DB=ecv_cash ECV_OWNER_PW=... ECV_APP_PW=... scripts/db-bootstrap.sh [psql args]
# Em desenvolvimento local: sudo -u postgres ECV_OWNER_PW=owner ECV_APP_PW=app scripts/db-bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -v ON_ERROR_STOP=1 -v db="${ECV_DB:-ecv_cash}" -v owner_pw="${ECV_OWNER_PW:?}" -v app_pw="${ECV_APP_PW:?}" \
  -f apps/api/db/bootstrap.sql "$@"
