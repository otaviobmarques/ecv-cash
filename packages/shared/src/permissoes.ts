import type { Perfil } from './perfis';

const A: Perfil = 'ADMINISTRATIVO';
const G: Perfil = 'GERENTE';
const F: Perfil = 'FINANCEIRO';
const V: Perfil = 'VISTORIADOR';

/**
 * Matriz de permissões (Etapa 5). Uma permissão por ação; escopo (rede, loja, próprios)
 * é aplicado pela camada de dados (RLS) e pelos serviços, não por esta tabela.
 * Condições de negócio (limites, período aberto, só a própria loja) ficam em permissões
 * separadas, com sufixo que diz a condição.
 */
export const MATRIZ = {
  // Plataforma e configurações
  'empresa.criar': [A],
  'empresa.editar': [A, G],
  'usuario.gerir': [A, G],
  'usuario.perfil_alto': [A], // atribuir Administrativo ou Gerente
  'tema.editar': [A, G],
  'plano_contas.editar': [A],
  'plano_contas.ver': [A, G, F],
  'aliquota.editar': [A],
  'aliquota.ver': [A, G, F],
  'repasse.editar': [A],
  'repasse.ver': [A, G, F],
  'comissao_regra.editar': [A, G],
  'custo_servico.editar': [A],
  'custo_servico.ver': [A, G],
  'regua_cobranca.editar': [A, G],
  'auditoria.ver': [A, G],
  'historico.ver': [A, G, F],
  // Cadastros
  'cliente.ver': [A, G, F, V],
  'cliente.editar': [A, G],
  'cliente_faturamento.editar': [A, G],
  'preco.ver': [A, G, F, V],
  'preco.cadastrar_primeiro': [A, G],
  'preco.reajustar': [A],
  'servico.ver': [A, G, F, V],
  'servico.editar': [A],
  'vistoriador.ver': [A, G, F],
  'vistoriador.editar': [A, G],
  'forma_pagamento.ver': [A, G, F, V], // o Vistoriador precisa escolher a forma ao lançar; vê só o nome e o tipo
  'forma_pagamento.editar': [A],
  'forma_pagamento_empresa.editar': [A, G],
  'fornecedor.ver': [A, G, F],
  'fornecedor.editar': [A, G, F],
  'conta_financeira.ver': [A, G, F],
  'conta_financeira.editar': [A, G],
  'conta_financeira.aprovar_alteracao': [A], // mudança em conta que aparece na fatura, com senha
  // Laudos
  'laudo.lancar': [A, G, V],
  'laudo.ver': [A, G, F],
  'laudo.ver_proprios': [V],
  'laudo.editar': [A, G],
  'laudo.editar_proprio_dia': [V], // mesmo dia, antes de faturar, baixar ou fechar o caixa
  'laudo.preco_manual': [A, G, V],
  'laudo.desconto': [A, G],
  'laudo.revisar_preco_manual': [A, G],
  'laudo.cancelamento_solicitar': [A, G, V],
  'laudo.cancelamento_autorizar': [A, G],
  // Contas a receber e faturas
  'receber.ver': [A, G, F],
  'receber.baixar': [A, G, F],
  'receber.estornar': [A, G],
  'receber.estornar_periodo_aberto': [F],
  'fatura.gerar': [A, G, F],
  'fatura.cancelar': [A, G],
  'juros.perdoar': [A, G],
  'juros.perdoar_ate_limite': [F],
  'cheque.controlar': [A, G, F],
  // Contas a pagar
  'pagar.ver': [A, G, F],
  'pagar.criar': [A, G, F],
  'pagar.aprovar': [A, G],
  'pagar.pagar': [A, G, F],
  'pagar.estornar': [A, G],
  'pagar.estornar_periodo_aberto': [F],
  'pagar.cancelar': [A, G],
  'pagar.cancelar_rascunho': [F],
  'pagar.recorrencia': [A, G, F],
  'pagar.rateio': [A],
  // Caixa e fechamentos
  'caixa.ver': [A, G, F],
  'transferencia.criar': [A, G, F],
  'transferencia.intercompany': [A],
  'caixa.ajustar': [A, G],
  'caixa.fechar': [A, G, F],
  'periodo.fechar': [A, G],
  'periodo.reabrir': [A],
  'caixa.reabrir_dia': [A, G],
  'comissao.fechar': [A, G],
  'comissao.ver': [A, G, F],
  'repasse.apurar': [A],
  // Relatórios e painéis
  'relatorio.operacional': [A, G, F],
  'relatorio.financeiro': [A, G, F],
  'relatorio.fluxo_caixa': [A, G, F],
  'relatorio.dre_balanco': [A, G],
  'balanco.editar': [A], // saldos informados à mão (imobilizado, empréstimos, capital)
  'relatorio.margem': [A, G],
  'relatorio.consolidado': [A, G, F],
  'dashboard.rede': [A],
  'dashboard.loja': [G],
  'dashboard.financeiro': [F],
  'dashboard.vistoriador': [V],
  'exportar': [A, G, F],
} as const satisfies Record<string, readonly Perfil[]>;

export type Permissao = keyof typeof MATRIZ;

export function temPermissao(perfil: Perfil, permissao: Permissao): boolean {
  return (MATRIZ[permissao] as readonly Perfil[]).includes(perfil);
}

export function permissoesDoPerfil(perfil: Perfil): Permissao[] {
  return (Object.keys(MATRIZ) as Permissao[]).filter((p) => temPermissao(perfil, p));
}

export interface UsuarioAlvo {
  perfil: Perfil;
  empresaIds: string[];
}

/**
 * Quem pode criar qual usuário. O Administrativo cria qualquer perfil. O Gerente cria só
 * Financeiro e Vistoriador, e só nas lojas em que ele próprio é Gerente.
 */
export function podeCriarUsuario(
  criador: { rede: boolean; perfilPorEmpresa: Record<string, Perfil> },
  alvo: UsuarioAlvo,
): { ok: true } | { ok: false; motivo: string } {
  if (criador.rede) return { ok: true };
  const lojasDoGerente = Object.entries(criador.perfilPorEmpresa)
    .filter(([, p]) => p === 'GERENTE')
    .map(([id]) => id);
  if (lojasDoGerente.length === 0) return { ok: false, motivo: 'Seu perfil não gerencia usuários.' };
  if (alvo.perfil !== 'FINANCEIRO' && alvo.perfil !== 'VISTORIADOR') {
    return { ok: false, motivo: 'O Gerente cria apenas Financeiro e Vistoriador.' };
  }
  if (alvo.empresaIds.length === 0) return { ok: false, motivo: 'Escolha ao menos uma loja.' };
  const fora = alvo.empresaIds.filter((id) => !lojasDoGerente.includes(id));
  if (fora.length > 0) return { ok: false, motivo: 'Você só pode dar acesso às lojas que gerencia.' };
  return { ok: true };
}
