import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatarBRL } from '@ecv/shared';
import type { ContaFatura } from './faturas.service';

export interface DadosPdfFatura {
  empresa: { razao: string; fantasia: string; cnpj: string; cidade: string; uf: string; email: string | null };
  cor: string;
  fatura: { numero: number; cliente: string; periodoIni: string; periodoFim: string; emissao: string; vencimento: string; status: string; numeroNf: string | null; numeroBoleto: string | null; observacao: string | null; diasAtraso: number };
  titulos: { dataLaudo: string; placa: string; numeroLaudo: string | null; numero: number; servico: string; valorCentavos: number; pagoCentavos: number }[];
  totalCentavos: number; recebidoCentavos: number; saldoCentavos: number; encargosCentavos: number; totalHojeCentavos: number;
  contas: ContaFatura[];
  pix: { copiaECola: string; valorCentavos: number } | null;
  geradoEm: string;
}

const br = (iso: string) => iso.split('-').reverse().join('/');
const cnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const TEXTO = '#18382E'; const MUTED = '#52675F'; const LINHA = '#D5DDD7';

/** PDF da fatura em A4: dados da loja e do cliente, laudos do período, totais e o bloco "Como pagar" com QR Code PIX. */
export async function gerarPdfFatura(d: DadosPdfFatura): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: `Fatura ${d.fatura.numero} - ${d.fatura.cliente}`, Author: d.empresa.fantasia } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  const L = doc.page.margins.left; const R = doc.page.width - doc.page.margins.right; const W = R - L;

  // cabeçalho
  doc.fillColor(d.cor).font('Helvetica-Bold').fontSize(18).text(d.empresa.fantasia, L, 44);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`${d.empresa.razao} · CNPJ ${cnpj(d.empresa.cnpj)}`, L, 66).text(`${d.empresa.cidade}/${d.empresa.uf}${d.empresa.email ? ` · ${d.empresa.email}` : ''}`);
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(22).text(`Fatura nº ${d.fatura.numero}`, L, 44, { width: W, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(d.fatura.status === 'PAGA' ? 'PAGA' : d.fatura.status === 'CANCELADA' ? 'CANCELADA' : 'EM ABERTO', L, 70, { width: W, align: 'right' });
  doc.moveTo(L, 96).lineTo(R, 96).strokeColor(d.cor).lineWidth(2).stroke();

  // quadro de dados
  let y = 108;
  const campo = (rot: string, val: string, x: number, w: number) => { doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(rot.toUpperCase(), x, y, { width: w }); doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11).text(val, x, y + 11, { width: w }); };
  campo('Cliente', d.fatura.cliente, L, W * 0.45); campo('Período', `${br(d.fatura.periodoIni)} a ${br(d.fatura.periodoFim)}`, L + W * 0.47, W * 0.25);
  campo('Emissão', br(d.fatura.emissao), L + W * 0.74, W * 0.12); campo('Vencimento', br(d.fatura.vencimento), L + W * 0.87, W * 0.13);
  y += 36;
  if (d.fatura.numeroNf || d.fatura.numeroBoleto) {
    campo('NF (referência)', d.fatura.numeroNf ?? '—', L, W * 0.45); campo('Boleto (referência)', d.fatura.numeroBoleto ?? '—', L + W * 0.47, W * 0.4);
    y += 36;
  }

  // tabela de laudos
  const cols = { data: L, placa: L + 62, laudo: L + 135, servico: L + 205, valor: R - 80 };
  const cabecalho = () => {
    doc.rect(L, y, W, 18).fillColor(d.cor).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
    doc.text('DATA', cols.data + 4, y + 5).text('PLACA', cols.placa, y + 5).text('LAUDO', cols.laudo, y + 5).text('SERVIÇO', cols.servico, y + 5).text('VALOR', cols.valor, y + 5, { width: 76, align: 'right' });
    y += 22;
  };
  cabecalho();
  doc.font('Helvetica').fontSize(9.5);
  for (const t of d.titulos) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 44; cabecalho(); doc.font('Helvetica').fontSize(9.5); }
    doc.fillColor(TEXTO).text(br(t.dataLaudo), cols.data + 4, y).text(t.placa, cols.placa, y).text(t.numeroLaudo ?? String(t.numero), cols.laudo, y, { width: 68 })
      .text(t.servico, cols.servico, y, { width: cols.valor - cols.servico - 8, ellipsis: true, height: 12 }).text(formatarBRL(t.valorCentavos), cols.valor, y, { width: 76, align: 'right' });
    y += 16;
    doc.moveTo(L, y - 3).lineTo(R, y - 3).strokeColor(LINHA).lineWidth(0.5).stroke();
  }

  // totais
  if (y > doc.page.height - 260) { doc.addPage(); y = 44; }
  y += 6;
  const total = (rot: string, val: string, forte = false) => {
    doc.fillColor(forte ? TEXTO : MUTED).font(forte ? 'Helvetica-Bold' : 'Helvetica').fontSize(forte ? 12 : 10).text(rot, R - 250, y, { width: 160 }).text(val, R - 90, y, { width: 90, align: 'right' });
    y += forte ? 20 : 15;
  };
  total(`Valor da fatura (${d.titulos.length} laudos)`, formatarBRL(d.totalCentavos));
  if (d.recebidoCentavos > 0) total('Já recebido', `- ${formatarBRL(d.recebidoCentavos)}`);
  if (d.encargosCentavos > 0) total(`Multa e juros (${d.fatura.diasAtraso} dias de atraso)`, formatarBRL(d.encargosCentavos));
  total(d.encargosCentavos > 0 ? 'Total a pagar hoje' : 'Total a pagar', formatarBRL(d.totalHojeCentavos), true);
  if (d.fatura.observacao) { doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(d.fatura.observacao, L, y, { width: W * 0.55 }); y = Math.max(y, doc.y); }

  // como pagar
  y += 14;
  if (d.contas.length > 0 && d.fatura.status !== 'PAGA' && d.fatura.status !== 'CANCELADA') {
    const alturaBloco = 150;
    if (y > doc.page.height - alturaBloco - 40) { doc.addPage(); y = 44; }
    doc.roundedRect(L, y, W, alturaBloco, 8).strokeColor(d.cor).lineWidth(1).stroke();
    doc.fillColor(d.cor).font('Helvetica-Bold').fontSize(12).text('Como pagar', L + 14, y + 12);
    let yy = y + 32;
    for (const ct of d.contas.slice(0, 2)) {
      const linhas: string[] = [];
      if (ct.banco) linhas.push(`${ct.banco}${ct.agencia ? ` · Ag. ${ct.agencia}` : ''}${ct.conta ? ` · Conta ${ct.conta}` : ''}${ct.tipoConta ? ` (${ct.tipoConta.toLowerCase()})` : ''}`);
      if (ct.titular) linhas.push(`Titular: ${ct.titular}${ct.documentoTitular ? ` · ${ct.documentoTitular.length === 14 ? cnpj(ct.documentoTitular) : ct.documentoTitular}` : ''}`);
      if (ct.pixChave) linhas.push(`Chave PIX (${(ct.pixTipo ?? '').toLowerCase()}): ${ct.pixChave}`);
      doc.fillColor(TEXTO).font('Helvetica').fontSize(9.5).text(linhas.join('\n'), L + 14, yy, { width: W - 190, lineGap: 2 });
      yy = doc.y + 6;
    }
    if (d.pix) {
      const qr = await QRCode.toBuffer(d.pix.copiaECola, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
      doc.image(qr, R - 130, y + 12, { width: 116 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`PIX no valor de ${formatarBRL(d.pix.valorCentavos)}`, R - 136, y + 130, { width: 128, align: 'center' });
      doc.fillColor(MUTED).font('Courier').fontSize(6.5).text(`Copia e cola: ${d.pix.copiaECola}`, L + 14, y + alturaBloco - 34, { width: W - 160 });
    }
    y += alturaBloco + 10;
  }
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`Gerado em ${d.geradoEm}. A baixa do pagamento é feita pela loja após a confirmação do recebimento.`, L, doc.page.height - 56, { width: W, align: 'center' });
  doc.end();
  return fim;
}
