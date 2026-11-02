# Privacidade e retenção de dados (LGPD)

O sistema trata dados pessoais de clientes pessoa física (nome, CPF, e-mail, telefone), de vistoriadores e de usuários. O controlador dos dados é a empresa que usa o sistema (o grupo); a Domma Tecnologia (desenvolvimento e operação do sistema) atua como operadora.

## O que cada dado é, e por quanto tempo fica
| Dado | Onde | Prazo | Como sai |
|---|---|---|---|
| Lançamentos financeiros (laudos, baixas, faturas, pagamentos, razão de caixa) | banco | 5 anos (guarda legal) | não se apagam; passado o prazo, a pessoa é anonimizada e o valor e a data ficam |
| Nome, CPF, e-mails e telefone de cliente pessoa física | `cliente` | 5 anos depois do último movimento | anonimização (tela **Cadastros › Privacidade**, em lote, ou pedido do titular) |
| Log de auditoria | `auditoria_log` | sem prazo | só inserção, por desenho: prova quem fez o quê. Contém nomes de quem operou, não dados de clientes além do que o próprio evento descreve |
| Tentativas de login (IP e resultado) | `login_tentativa` | 90 dias | apagadas todo dia pela rotina do servidor |
| Sessões e convites | `sessao`, `usuario` | expiram sozinhos (12 h e 7 dias) | invalidados; não são reaproveitados |
| Anexos (comprovantes e notas) | `anexo` | junto com o lançamento a que pertencem | não se apagam |

## Direitos do titular, na prática
- **Acesso:** o Administrativo abre o cliente (pessoa física) e usa **Privacidade (LGPD) › Ver dados do titular**. A consulta fica no log de auditoria.
- **Anonimização:** no mesmo lugar, com motivo. Apaga nome, CPF, e-mails e telefone e inativa o cliente. Não tem volta. Os valores e as datas dos laudos permanecem, sem identificar ninguém.
- **Prazo de retenção:** em **Cadastros › Privacidade (LGPD)** o sistema lista quem está parado há 5 anos ou mais, sem nada em aberto, para anonimizar em lote. É sempre uma decisão do Administrativo: nada é apagado sozinho.
- **Exportação de relatórios:** toda exportação em CSV fica registrada (quem, qual relatório, quantas linhas).

## Limites conhecidos
- Vistoriadores e usuários: o cadastro é inativado, não anonimizado, porque o nome deles aparece no histórico de quem operou o sistema (obrigação de rastreabilidade).
- Dados que a loja enviou fora do sistema (e-mails já enviados, PDFs baixados) não são alcançados por uma anonimização.
- O armazenamento de comprovantes dentro do banco acompanha o backup: ao restaurar um backup antigo, dados já anonimizados voltam. Depois de restaurar, anonimize de novo.
