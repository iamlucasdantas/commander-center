// REMOVIDO da interface em 2026-11-22 (correções do Lucas, 14:54 e
// 15:02): ele NÃO quer um botão de verificar todos os contatos da
// conta. A verificação é seletiva e individual, nas listas de leads
// da página da conta (caixa de seleção + "Verify selected" + botão
// Verify por linha, no LeadList), e é marcação INTERNA do painel
// (state.ts, via /api/verify-contact), sem nenhuma escrita de
// verificação no HighLevel. Este arquivo fica só como registro da
// decisão; não recrie um botão de varredura completa sem o Lucas
// pedir.
export {};
