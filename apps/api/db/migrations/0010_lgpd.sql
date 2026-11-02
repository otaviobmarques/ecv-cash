-- LGPD básica: cliente pessoa física pode ser anonimizado a pedido do titular. Os lançamentos financeiros ficam (obrigação legal de guarda);
-- só o que identifica a pessoa é apagado.
ALTER TABLE cliente ADD COLUMN anonimizado_em timestamptz;
