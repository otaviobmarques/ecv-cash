#!/usr/bin/env bash
# Instala (ou atualiza) o ECV Cash numa VPS que já tem o Traefik. Descobre sozinho a rede, o certresolver e os entrypoints do Traefik.
# Uso:  sudo bash deploy/instalar.sh SEUDOMINIO.com.br seu@email.com "Seu Nome"
# Opcional (se a descoberta falhar): REDE_TRAEFIK=... CERTRESOLVER=... ENTRYPOINT_HTTPS=websecure ENTRYPOINT_HTTP=web TRAEFIK=nome_do_conteiner
# Nada do Traefik nem do OpenClaw é alterado: o script só lê o estado deles.
set -euo pipefail
cd "$(dirname "$0")"

DOMINIO="${1:-}"; EMAIL="${2:-}"; NOME="${3:-Administrador}"
[ -n "$DOMINIO" ] && [ -n "$EMAIL" ] || { echo "Uso: sudo bash deploy/instalar.sh SEUDOMINIO.com.br seu@email.com \"Seu Nome\""; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo)."; exit 1; }
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || { echo "Docker com o plugin compose não encontrado."; exit 1; }

echo "== 1/6 Estado atual do servidor (para comparar no fim)"
[ -e /root/estado-antes.txt ] || docker ps --format '{{.Names}}\t{{.Status}}' | sort > /root/estado-antes.txt
cat /root/estado-antes.txt

echo "== 2/6 Procurando o Traefik"
TRAEFIK="${TRAEFIK:-$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /traefik/ {print $1; exit}')}"
[ -n "$TRAEFIK" ] || { echo "Não achei um contêiner do Traefik em execução. Informe: TRAEFIK=nome sudo -E bash deploy/instalar.sh ..."; exit 1; }
echo "Traefik: $TRAEFIK"
ARGS="$(docker inspect -f '{{join .Args " "}} {{join .Config.Cmd " "}} {{range .Config.Env}}{{.}} {{end}}' "$TRAEFIK" 2>/dev/null || true)"

REDES="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$TRAEFIK")"
REDE_TRAEFIK="${REDE_TRAEFIK:-$(echo "$REDES" | tr ' ' '\n' | grep -vE '^(bridge|host|none|)$' | head -1)}"
[ -n "$REDE_TRAEFIK" ] || { echo "Não descobri a rede do Traefik (redes: $REDES). Informe REDE_TRAEFIK=..."; exit 1; }
CERTRESOLVER="${CERTRESOLVER:-$(echo "$ARGS" | grep -oE 'certificatesresolvers\.[A-Za-z0-9_-]+' | head -1 | cut -d. -f2)}"
[ -n "$CERTRESOLVER" ] || { echo "Não achei o certresolver nos argumentos do Traefik (ele pode estar num arquivo traefik.yml). Informe CERTRESOLVER=... (veja: docker inspect $TRAEFIK | grep -i -A3 mounts)"; exit 1; }
ENTRYPOINT_HTTPS="${ENTRYPOINT_HTTPS:-$(echo "$ARGS" | grep -oE 'entrypoints\.[A-Za-z0-9_-]+\.address=:?443' | head -1 | cut -d. -f2)}"
ENTRYPOINT_HTTP="${ENTRYPOINT_HTTP:-$(echo "$ARGS" | grep -oE 'entrypoints\.[A-Za-z0-9_-]+\.address=:?80\b' | head -1 | cut -d. -f2)}"
ENTRYPOINT_HTTPS="${ENTRYPOINT_HTTPS:-websecure}"; ENTRYPOINT_HTTP="${ENTRYPOINT_HTTP:-web}"
echo "Rede: $REDE_TRAEFIK · certresolver: $CERTRESOLVER · entrypoints: $ENTRYPOINT_HTTPS / $ENTRYPOINT_HTTP"

echo "== 3/6 DNS"
IP_PUBLICO="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
for h in app admin; do
  RES="$(getent hosts "$h.$DOMINIO" | awk '{print $1; exit}' || true)"
  if [ -z "$RES" ]; then echo "AVISO: $h.$DOMINIO ainda não aponta para lugar nenhum. Crie o registro A para ${IP_PUBLICO:-o IP desta VPS}."
  elif [ -n "$IP_PUBLICO" ] && [ "$RES" != "$IP_PUBLICO" ]; then echo "AVISO: $h.$DOMINIO aponta para $RES, mas esta VPS é $IP_PUBLICO."
  else echo "$h.$DOMINIO → $RES ok"; fi
done

echo "== 4/6 Configuração (.env)"
if [ -e .env ]; then echo ".env já existe: mantendo (senhas atuais)."; else ./gerar-env.sh "$DOMINIO" "$REDE_TRAEFIK" "$CERTRESOLVER" "$ENTRYPOINT_HTTPS" "$ENTRYPOINT_HTTP"; fi

echo "== 5/6 Subindo (a primeira vez leva alguns minutos)"
docker compose up -d --build
for i in $(seq 1 60); do
  [ "$(docker compose ps --status running --format '{{.Service}}' | grep -cE '^(db|api|site)$')" = 3 ] && break
  sleep 3
done
docker compose ps

echo "== 6/6 Primeiro usuário da equipe interna"
if [ -e .interno-criado ]; then echo "Já criado antes."; else
  SENHA_SAIDA="$(docker compose run --rm criar-interno "$NOME" "$EMAIL" PLATAFORMA 2>&1 | tail -3)"
  echo "$SENHA_SAIDA"; touch .interno-criado
fi

echo
echo "== Conferindo que o resto do servidor continua como estava"
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /root/estado-depois.txt
diff /root/estado-antes.txt /root/estado-depois.txt || true
echo
echo "Pronto. Abra:  https://admin.$DOMINIO  (equipe interna)  e  https://app.$DOMINIO  (sistema)."
echo "O certificado pode levar até um minuto na primeira visita. Guarde deploy/.env em lugar seguro."
