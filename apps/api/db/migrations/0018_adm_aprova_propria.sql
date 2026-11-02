-- O Administrativo pode aprovar a conta a pagar que ele mesmo criou. A regra "quem cria não aprova" continua valendo para Gerente e Financeiro (conferida na aplicação).
ALTER TABLE titulo_pagar DROP CONSTRAINT IF EXISTS titulo_pagar_check;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'titulo_pagar'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%aprovado_por <> criado_por%' LOOP
    EXECUTE format('ALTER TABLE titulo_pagar DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
