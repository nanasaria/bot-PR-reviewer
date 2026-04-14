import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';
import type { PullRequestReviewPromptModel } from '../models/pull-request-review-prompt.model';
import { analyzePullRequestChangeSet } from './change-set-analysis.util';

export function buildPullRequestReviewPrompt(
  reviewContext: PullRequestReviewPromptModel,
): string {
  const {
    repositoryOwner,
    repositoryName,
    pullRequestNumber,
    pullRequestSummary,
    changedFiles,
  } = reviewContext;

  const changedFilesSection = changedFiles
    .map((changedFile) => formatChangedFileSection(changedFile))
    .join('\n\n');
  const changeSetAnalysis = analyzePullRequestChangeSet(
    changedFiles,
    repositoryName,
  );

  return [
    'Você é uma engenheira sênior fazendo uma revisão técnica, crítica e aprofundada de um Pull Request do GitHub.',
    'Pense como alguém responsável por barrar regressões antes do merge.',
    '',
    `Repositório: ${repositoryOwner}/${repositoryName}`,
    `PR #${pullRequestNumber}: ${pullRequestSummary.title}`,
    `Autor: ${pullRequestSummary.author}`,
    `Branch: ${pullRequestSummary.headRef} -> ${pullRequestSummary.baseRef}`,
    `Estado: ${pullRequestSummary.state}${pullRequestSummary.draft ? ' (draft)' : ''}`,
    `Arquivos alterados: ${pullRequestSummary.changedFiles} | +${pullRequestSummary.additions}/-${pullRequestSummary.deletions}`,
    '',
    'Descrição do PR:',
    pullRequestSummary.body?.trim()
      ? pullRequestSummary.body
      : '(sem descrição)',
    '',
    'Contexto inferido automaticamente a partir do diff:',
    `- há alterações de back-end: ${changeSetAnalysis.hasBackendChanges ? 'sim' : 'não'}`,
    `- há alterações de front-end: ${changeSetAnalysis.hasFrontendChanges ? 'sim' : 'não'}`,
    `- há arquivos de teste no PR: ${changeSetAnalysis.hasTestFiles ? 'sim' : 'não'}`,
    '',
    'Arquivos e diffs:',
    changedFilesSection || '(nenhum arquivo)',
    '',
    'Faça uma revisão profunda do diff e das interações entre os arquivos alterados.',
    'Não se limite ao texto da descrição do PR; valide se a implementação realmente sustenta o comportamento esperado.',
    '',
    'Revise focando principalmente em:',
    '- bugs funcionais e regressões',
    '- tratamento de erros, fluxos de falha e estados parciais',
    '- validação de entrada e casos de borda',
    '- segurança, exposição de dados e permissões',
    '- performance, consultas repetidas, processamento desnecessário e uso de memória',
    '- compatibilidade com o comportamento existente e impacto em produção',
    '- legibilidade, manutenção e suficiência dos testes automatizados',
    '',
    'Se encontrar problemas, priorize os mais importantes e seja específica.',
    'Cada item em issues deve apontar um arquivo relevante e explicar o risco prático do problema.',
    'Evite observações genéricas ou superficiais.',
    'A descrição do PR é obrigatória. Se o PR estiver sem descrição ou com descrição vazia, trate isso como mudança obrigatória antes do merge.',
    'Em alterações de back-end, verifique obrigatoriamente se o PR traz testes automatizados cobrindo o comportamento alterado.',
    'Se houver mudança de back-end sem testes automatizados no diff, trate isso como mudança obrigatória antes do merge e normalmente use REQUEST_CHANGES.',
    'Se houver testes, avalie se eles realmente cobrem os cenários alterados; testes superficiais ou insuficientes também devem ser apontados.',
    'Se o PR for apenas de front-end, a ausência de testes não é bloqueante por si só.',
    '',
    'Regras de decisão:',
    '- use APPROVE somente se não houver nenhuma mudança obrigatória',
    '- use REQUEST_CHANGES se houver algo que precise ser corrigido antes do merge',
    '- use COMMENT se estiver inconclusivo ou houver apenas sugestões leves',
    '',
    'Regras de linguagem:',
    '- escreva em português do Brasil natural, claro e profissional',
    '- não misture palavras em inglês quando houver equivalente natural em português',
    '- mantenha em inglês apenas nomes de arquivos, identificadores, comandos, APIs, mensagens literais e termos sem tradução natural',
    '- prefira "caso de borda" em vez de "edge case", "mudanças necessárias" em vez de "request changes", e assim por diante',
    '',
    'Regras para o campo body:',
    '- escreva um resumo final mais aprofundado, com os principais motivos da decisão',
    '- não repita a lista completa de issues no body; ela já irá separadamente',
    '- se aprovar, explique por que a mudança parece segura',
    '- se pedir mudanças, deixe claro o impacto e o que precisa ser corrigido antes do merge',
    '- se faltar teste em mudança de back-end, diga isso explicitamente no body',
    '- se faltar descrição no PR, diga isso explicitamente no body',
    '',
    'Responda APENAS com JSON puro (sem markdown, sem prosa, sem cercas de código), no formato:',
    '{',
    '  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
    '  "body": "texto final da review em português do Brasil, aprofundado, claro e profissional",',
    '  "issues": [',
    '    { "severity": "high" | "medium" | "low", "file": "caminho/arquivo", "reason": "descrição" }',
    '  ],',
    '  "confidence": "high" | "medium" | "low"',
    '}',
    '',
    'Antes de responder, faça uma checagem silenciosa para confirmar que o JSON está válido e que o texto está todo em português do Brasil, exceto identificadores técnicos.',
  ].join('\n');
}

function formatChangedFileSection(changedFile: GitHubPullRequestFile): string {
  const fileHeader = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})`;
  const filePatch = changedFile.patch
    ? `\n\`\`\`diff\n${changedFile.patch}\n\`\`\``
    : '\n_(sem diff disponível)_';

  return `${fileHeader}${filePatch}`;
}
