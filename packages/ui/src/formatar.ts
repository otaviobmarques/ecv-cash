const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

export const formatarDataHora = (v: string | Date | null | undefined) => (v ? dataHora.format(new Date(v)) : '—');
export const formatarData = (v: string | Date | null | undefined) => (v ? data.format(new Date(v)) : '—');
