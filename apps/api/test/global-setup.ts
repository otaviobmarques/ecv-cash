import { migrar } from '../src/db/migrate';

export default async function setup() {
  const url = process.env.DATABASE_URL_OWNER ?? 'postgres://ecv_owner:owner@localhost:5432/ecv_cash';
  await migrar(url);
}
