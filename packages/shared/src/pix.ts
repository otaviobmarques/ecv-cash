/** CRC-16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), o do BR Code do PIX. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim();

export type TipoChavePix = 'CNPJ' | 'CPF' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';

/** Chave PIX no formato que o BR Code espera: CPF/CNPJ só dígitos, telefone com +55, e-mail e aleatória como estão. */
export function normalizarChavePix(tipo: TipoChavePix, chave: string): string {
  const c = chave.trim();
  if (tipo === 'CNPJ' || tipo === 'CPF') return c.replace(/\D/g, '');
  if (tipo === 'TELEFONE') { const d = c.replace(/\D/g, ''); return c.startsWith('+') ? `+${d}` : `+55${d.replace(/^55(?=\d{10,11}$)/, '')}`; }
  return tipo === 'EMAIL' ? c.toLowerCase() : c;
}

export interface DadosPix { tipoChave: TipoChavePix; chave: string; nomeRecebedor: string; cidade: string; valorCentavos?: number; identificador?: string }

/**
 * PIX "copia e cola" estático (BR Code), com o valor da cobrança quando informado. A baixa continua manual:
 * o sistema não sabe se o cliente pagou. Nome e cidade seguem os limites do padrão (25 e 15 caracteres, sem acento).
 */
export function gerarPixCopiaECola(d: DadosPix): string {
  const chave = normalizarChavePix(d.tipoChave, d.chave);
  const conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
  const id = (d.identificador ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let p = tlv('00', '01') + tlv('01', '11') + tlv('26', conta) + tlv('52', '0000') + tlv('53', '986');
  if (d.valorCentavos && d.valorCentavos > 0) p += tlv('54', (d.valorCentavos / 100).toFixed(2));
  p += tlv('58', 'BR') + tlv('59', (semAcento(d.nomeRecebedor).toUpperCase() || 'RECEBEDOR').slice(0, 25)) + tlv('60', (semAcento(d.cidade).toUpperCase() || 'BRASIL').slice(0, 15)) + tlv('62', tlv('05', id));
  p += '6304';
  return p + crc16(p);
}
