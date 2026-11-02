# Instalar o ECV Cash numa VPS que já tem o Traefik (OpenClaw da Hostinger)

## Caminho rápido (um comando)
Com o DNS apontado (seção 1 abaixo) e o repositório clonado em `/opt/ecv-cash` (seção 2):
```bash
cd /opt/ecv-cash && sudo bash deploy/instalar.sh SEUDOMINIO.com.br seu@email.com "Seu Nome"
```
O script descobre sozinho a rede, o certresolver e os entrypoints do Traefik, gera o `.env`, sobe tudo, cria o primeiro usuário interno e mostra a senha provisória (uma única vez). Só lê o estado do Traefik e do OpenClaw; no fim compara os contêineres antes e depois. Se ele não conseguir descobrir algo, diz o que informar. O passo a passo manual continua abaixo.

Nesta VPS o **Traefik** já ocupa as portas 80 e 443 e emite os certificados. O ECV Cash entra "ao lado": o Traefik recebe `app.SEUDOMINIO` e `admin.SEUDOMINIO` e entrega para o Caddy do ECV Cash (HTTP, rede interna), que serve as telas e encaminha `/api` para a API.

```
Internet ─> Traefik (80/443, HTTPS) ─> Caddy (site) ─┬─> telas (app e admin)
                                                     └─> /api ─> API ─> PostgreSQL
```
Nada do OpenClaw nem do Traefik é alterado: todos os comandos abaixo só **leem** o que já existe. O ECV Cash sobe como um projeto Docker separado (`ecv-cash`), com banco, volume e rede interna próprios.

## 0. Antes de começar: descubra os dados do Traefik (só leitura)
Entre na VPS (`ssh root@IP_DA_VPS`) e rode:
```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'   # anote o nome do contêiner do Traefik e do OpenClaw
docker network ls                                               # a rede em que o Traefik e o OpenClaw estão
```
Descubra a rede do Traefik e o certresolver (troque `traefik` pelo nome do contêiner que apareceu acima):
```bash
docker inspect traefik --format '{{range $n,$_ := .NetworkSettings.Networks}}rede: {{$n}}{{"\n"}}{{end}}'
docker inspect traefik --format '{{range .Args}}{{println .}}{{end}}' | grep -E "certificatesresolvers|entrypoints"
```
Na saída, procure:
- **rede** (ex.: `openclaw_default` ou `traefik_default`) → vira `REDE_TRAEFIK`;
- `--certificatesresolvers.NOME.acme...` → o `NOME` vira `TRAEFIK_CERTRESOLVER` (comum: `letsencrypt`, `le`);
- `--entrypoints.NOME.address=:443` e `:80` → normalmente `websecure` e `web` (são os padrões do ECV Cash; só mude se forem outros).

Se o Traefik foi configurado por arquivo (`traefik.yml`) e não por argumentos, procure o nome em `docker inspect traefik | grep -i -A3 mounts` e leia o arquivo indicado.

Veja também se há folga de memória (o banco e a API do ECV Cash precisam de cerca de 1 GB): `free -h`.

**Guarde o estado atual do OpenClaw** para comparar no final:
```bash
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /root/estado-antes.txt
cat /root/estado-antes.txt
```
Abra também o endereço do OpenClaw no navegador e confirme que está funcionando.

## 1. Apontar o DNS
No painel do domínio (registro.br ou Hostinger), crie dois registros **A** para o IP da VPS:

| Nome | Tipo | Valor |
|---|---|---|
| `app` | A | IP da VPS |
| `admin` | A | IP da VPS |

Confirme (pode levar de minutos a horas): `dig +short app.SEUDOMINIO` deve mostrar o IP da VPS. Se o seu domínio já é usado pelo OpenClaw, use um domínio ou subdomínio separado (ex.: `ecv.seudominio.com.br`, com `app.ecv…` e `admin.ecv…`; nesse caso `DOMINIO=ecv.seudominio.com.br` e os registros ficam `app.ecv` e `admin.ecv`).

## 2. Baixar o código (repositório privado)
```bash
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -N "" -f ~/.ssh/ecv_deploy -C "vps-ecv-cash"
cat ~/.ssh/ecv_deploy.pub
```
No GitHub: repositório `ecv-cash` > Settings > Deploy keys > Add deploy key. Cole a chave pública e **não** marque "Allow write access". Depois:
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/ecv_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:otaviobmarques/ecv-cash.git /opt/ecv-cash
```

## 3. Gerar o .env
```bash
cd /opt/ecv-cash/deploy
./gerar-env.sh SEUDOMINIO REDE_TRAEFIK CERTRESOLVER
# exemplo: ./gerar-env.sh meudominio.com.br openclaw_default letsencrypt
# se os entrypoints forem outros: ... CERTRESOLVER nome_https nome_http
```
O script confere se a rede existe e cria o `.env` com senhas novas (o arquivo fica só para o root). **Guarde uma cópia do `deploy/.env` num gerenciador de senhas**: ele tem as senhas do banco e a chave que cifra o 2FA.

## 4. Subir
```bash
docker compose up -d --build        # a primeira vez leva alguns minutos
docker compose ps
```
Esperado: `db`, `api` e `site` em "running"/"healthy"; `migrar` em "exited (0)" (é o normal: ele só aplica as migrações e sai).

Se o `docker compose up` reclamar de variável faltando, o `.env` está incompleto: confira com `.env.exemplo`.

## 5. Criar o primeiro usuário interno
```bash
docker compose run --rm criar-interno "Seu Nome" seu@email.com PLATAFORMA
```
A senha provisória aparece **uma única vez**: anote. Depois:
1. Abra `https://admin.SEUDOMINIO`, entre com o e-mail e a senha provisória e configure o aplicativo autenticador (2FA).
2. Crie o primeiro grupo; o link do convite do Administrativo aparece na tela, para você entregar.
3. A pessoa abre o link (`https://app.SEUDOMINIO/convite?token=…`), define a senha e entra.

O certificado leva até um minuto na primeira visita. Se o navegador mostrar certificado inválido, veja a seção "Problemas".

## 6. Conferir que o OpenClaw continua funcionando
```bash
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /root/estado-depois.txt
diff /root/estado-antes.txt /root/estado-depois.txt
```
O `diff` deve mostrar **apenas linhas novas** do ECV Cash (`ecv-cash-db-1`, `ecv-cash-api-1`, `ecv-cash-site-1`) e nenhuma mudança de status nos contêineres do OpenClaw e do Traefik (um "Up 3 days" que virou "Up 2 minutes" indica reinício e deve ser investigado).

Depois:
- abra o endereço do OpenClaw no navegador e use-o como de costume;
- `docker logs --tail 50 traefik` (nome do seu contêiner) não deve mostrar erros novos; mensagens citando `ecv-cash` são sobre as rotas do ECV Cash;
- `free -h` mostra a memória em uso; se estiver no limite, o plano precisa de mais RAM.

Se o OpenClaw tiver qualquer problema, pare só o ECV Cash sem tocar no resto: `cd /opt/ecv-cash/deploy && docker compose down` (não use `-v`, que apagaria o banco).

## Rotina
- **Atualizar:** `cd /opt/ecv-cash && ./deploy/atualizar.sh` (as migrações rodam sozinhas).
- **Backup diário às 3h** (guarda 14 dias em `/var/backups/ecv-cash`):
  ```bash
  (crontab -l 2>/dev/null; echo '0 3 * * * /opt/ecv-cash/deploy/backup.sh >> /var/log/ecv-backup.log 2>&1') | crontab -
  ```
  Teste uma vez à mão: `/opt/ecv-cash/deploy/backup.sh`. Para restaurar, veja `docs/05-publicacao.md`.
- **Logs:** `docker compose logs -f api` (ou `site`, `db`), dentro de `/opt/ecv-cash/deploy`.

## Problemas
- **404 do Traefik (página "404 page not found") em app/admin:** o Traefik não achou a rota. Confira `REDE_TRAEFIK` (precisa ser a rede em que o Traefik realmente está) e os nomes dos entrypoints; depois `docker compose up -d`. Confira o que o Traefik enxergou: `docker logs --tail 100 traefik | grep -i ecv-cash`.
- **Certificado inválido / aviso do navegador:** o DNS ainda não propagou ou o `TRAEFIK_CERTRESOLVER` está com nome errado. Veja `docker logs traefik | grep -i -E "acme|certificate"`.
- **502 Bad Gateway:** o Caddy ou a API não subiu. `docker compose ps` e `docker compose logs api site`.
- **"Origem não permitida" no login:** o domínio do `.env` não bate com o endereço aberto no navegador. Corrija o `.env` e rode `docker compose up -d`.
- **Contagem de tentativas de login com o mesmo IP para todo mundo:** a API enxerga o IP real por dois proxies (Traefik e Caddy), configurado por `TRUST_PROXY_SALTOS=2` no compose. Se um dia colocarem outro proxy na frente (ex.: Cloudflare), esse número muda para 3.
