# Publicação em servidor (ambiente de teste)

Um servidor VPS roda tudo com Docker Compose: banco PostgreSQL, API, o sistema (`app.SEUDOMINIO`) e o backoffice (`admin.SEUDOMINIO`), com HTTPS automático (Caddy).
O banco e a API não ficam expostos à internet; só as portas 80 e 443 do Caddy.

> Os arquivos foram validados passo a passo fora do Docker (instalar, compilar, criar papéis e banco do zero, migrar, subir a API em produção, compilar os dois sites).
> A montagem das imagens em si só pode ser confirmada no servidor, no primeiro `docker compose up`. Se algo falhar, mande a mensagem de erro.

## 1. Compre e prepare
1. **VPS Hostinger**, plano KVM 2 (ou KVM 1 só para poucos testadores), localização **Brasil**, sistema **Ubuntu 24.04 com Docker**.
2. **Domínio** (registro.br ou Hostinger). Crie dois registros **A** apontando para o IP do VPS:
   - `app`  → IP do servidor
   - `admin` → IP do servidor

   (No registro.br ou na Hostinger: DNS > adicionar registro, tipo A, nome `app`, valor = IP. Repita para `admin`.) Pode levar de minutos a algumas horas.

## 2. Primeiro acesso ao servidor
No seu computador: `ssh root@IP_DO_SERVIDOR` (a senha ou a chave aparecem no painel da Hostinger).

```bash
# firewall: só SSH, HTTP e HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
# atualizações de segurança automáticas
apt-get update && apt-get install -y unattended-upgrades git
```
Se o modelo escolhido não trouxer o Docker: `curl -fsSL https://get.docker.com | sh`. Confira com `docker compose version`.

> Atenção: o Docker publica portas passando por cima do `ufw`. Por isso o `docker-compose.yml` só publica 80 e 443 e não publica o banco nem a API.

## 3. Baixar o código (repositório privado)
O servidor precisa de uma chave só de leitura:
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/ecv_deploy -C "servidor-ecv-cash"
cat ~/.ssh/ecv_deploy.pub
```
No GitHub: repositório `ecv-cash` > Settings > Deploy keys > Add deploy key. Cole a chave pública, **sem** marcar "Allow write access". Depois:
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/ecv_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:otaviobmarques/ecv-cash.git /opt/ecv-cash
cd /opt/ecv-cash
```

## 4. Configurar e subir
```bash
cd /opt/ecv-cash/deploy
./gerar-env.sh meudominio.com.br seu@email.com      # cria o .env com senhas novas
docker compose up -d --build                         # a primeira vez leva alguns minutos
docker compose ps                                    # db, api e site "running"; migrar "exited (0)" é o normal
```
**Guarde uma cópia do arquivo `deploy/.env` num gerenciador de senhas.** Ele tem as senhas do banco e a chave que cifra o 2FA.

Crie a primeira pessoa da equipe interna (a senha provisória aparece uma única vez):
```bash
docker compose run --rm criar-interno "Seu Nome" seu@email.com PLATAFORMA
```

## 5. Primeiro uso
1. Abra `https://admin.meudominio.com.br` e entre com o e-mail e a senha provisória. O sistema pede para configurar o aplicativo autenticador (2FA).
2. Crie o primeiro grupo (a rede do cliente de teste). O link de convite do Administrativo aparece na tela para você entregar.
3. A pessoa abre o link em `https://app.meudominio.com.br/convite?token=…`, define a senha e já entra.

Neste servidor **não há dados de exemplo** (o `db:seed` não roda em produção, de propósito: as senhas dele são conhecidas). Os dados de teste são cadastrados pela própria tela.

## 6. Rotina
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
- **Site não abre / certificado inválido:** o DNS ainda não propagou ou as portas 80/443 estão bloqueadas. Confira `docker compose logs site`.
- **"Origem não permitida" no login:** o domínio no `.env` não bate com o endereço aberto no navegador. Corrija o `.env` e rode `docker compose up -d`.
- **API reiniciando:** `docker compose logs api` mostra a causa (geralmente variável faltando no `.env`).
- **Mudou a senha no `.env` e o banco não aceita:** as senhas do banco são gravadas na primeira subida. Troque-as no banco (`ALTER ROLE`) ou apague o volume (`docker compose down -v`, só em ambiente sem dados que importem).

## O que ainda não está nesta publicação
- Envio de e-mail (convites aparecem na tela para entregar à mão).
- Armazenamento de arquivos (logotipo), previsto com o armazenamento S3.
- Monitoramento e alertas, banco gerenciado e backup fora do servidor automático: ficam para a produção.
