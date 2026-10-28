# Publicação em servidor (ambiente de teste)

> **A pasta `deploy/` está configurada para uma VPS em que o Traefik já cuida das portas 80/443 e do HTTPS (caso do OpenClaw da Hostinger).** O passo a passo dessa instalação é `deploy/INSTALAR-NA-VPS.md`. Este documento fica como referência geral: rotina de backup e restauração, e o que ainda falta.

Um servidor VPS roda tudo com Docker Compose: banco PostgreSQL, API e o site (Caddy, só HTTP interno) que serve o sistema (`app.SEUDOMINIO`) e o backoffice (`admin.SEUDOMINIO`).
O HTTPS e as portas 80/443 são do Traefik. O banco e a API não ficam expostos à internet nem ao Traefik: só o Caddy entra na rede dele.

> Os arquivos foram validados passo a passo fora do Docker (instalar, compilar, criar papéis e banco do zero, migrar, subir a API em produção, compilar os dois sites).
> A montagem das imagens e as rotas do Traefik só podem ser confirmadas na VPS, no primeiro `docker compose up`. Se algo falhar, mande a mensagem de erro.

Instalação, primeiro usuário interno e primeiro grupo: veja `deploy/INSTALAR-NA-VPS.md`.

## Rotina
- **Atualizar para a versão nova do GitHub:** `cd /opt/ecv-cash && ./deploy/atualizar.sh` (as migrações rodam sozinhas).
- **Backup diário às 3h** (guarda 14 dias em `/var/backups/ecv-cash`):
  ```bash
  (crontab -l 2>/dev/null; echo '0 3 * * * /opt/ecv-cash/deploy/backup.sh >> /var/log/ecv-backup.log 2>&1') | crontab -
  ```
  Teste uma vez à mão: `./deploy/backup.sh`. Copie os arquivos para fora do servidor de vez em quando (o backup no mesmo servidor não protege se o servidor se perder); ative também os backups do plano na Hostinger.
- **Restaurar um backup** (apaga o banco atual):
  ```bash
  cd /opt/ecv-cash/deploy
  docker compose stop api site
  docker compose exec -T db psql -U postgres -c "DROP DATABASE ecv_cash" -c "CREATE DATABASE ecv_cash OWNER ecv_owner"
  gunzip -c /var/backups/ecv-cash/ARQUIVO.sql.gz | docker compose exec -T db psql -U postgres -d ecv_cash
  docker compose up -d
  ```
- **Ver o que está acontecendo:** `docker compose logs -f api` (ou `site`, `db`).

## Problemas comuns
- **Site não abre / certificado inválido:** veja a seção "Problemas" de `deploy/INSTALAR-NA-VPS.md`.
- **"Origem não permitida" no login:** o domínio no `.env` não bate com o endereço aberto no navegador. Corrija o `.env` e rode `docker compose up -d`.
- **API reiniciando:** `docker compose logs api` mostra a causa (geralmente variável faltando no `.env`).
- **Mudou a senha no `.env` e o banco não aceita:** as senhas do banco são gravadas na primeira subida. Troque-as no banco (`ALTER ROLE`) ou apague o volume (`docker compose down -v`, só em ambiente sem dados que importem).

## O que ainda não está nesta publicação
- Envio de e-mail (convites aparecem na tela para entregar à mão).
- Armazenamento de arquivos (logotipo), previsto com o armazenamento S3.
- Monitoramento e alertas, banco gerenciado e backup fora do servidor automático: ficam para a produção.
