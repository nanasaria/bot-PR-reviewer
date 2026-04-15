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
    // A regra de testes para back-end é intencionalmente duplicada aqui (prompt) e em
    // applyRequiredBackendTestRule (lógica). O prompt orienta a análise do modelo; a lógica
    // garante programaticamente que a decisão final respeite a regra mesmo se o modelo falhar.
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
    'Estrutura obrigatória da resposta:',
    '- overview: texto corrido (2 a 4 parágrafos curtos) com a Visão Geral do PR — o que ele tenta fazer, se cumpre a proposta e o principal motivo da decisão',
    '- improvements: lista de sugestões concretas de melhoria no código (cada item é uma string curta e acionável). Pode ficar vazia se não houver sugestões além das issues',
    '- testsNotes: texto corrido avaliando os Testes — cobertura, qualidade, cenários faltantes. Se faltar teste em mudança de back-end, diga isso explicitamente aqui',
    '- negatives: lista de Pontos Negativos objetivos (cada item é uma string curta). Se o PR estiver sem descrição, inclua isso aqui',
    '- positives: lista de Pontos Positivos objetivos (cada item é uma string curta). Pode ficar vazia se o PR não tiver pontos positivos claros',
    '- issues: problemas concretos ancorados em arquivo, usados para a Tabela de Riscos. Evite duplicar itens de improvements aqui — issues são riscos, improvements são sugestões',
    '',
    'Responda APENAS com JSON puro (sem markdown, sem prosa, sem cercas de código), no formato:',
    '{',
    '  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
    '  "overview": "texto da Visão Geral em português do Brasil",',
    '  "improvements": ["sugestão 1", "sugestão 2"],',
    '  "testsNotes": "texto sobre Testes em português do Brasil",',
    '  "negatives": ["ponto negativo 1", "ponto negativo 2"],',
    '  "positives": ["ponto positivo 1", "ponto positivo 2"],',
    '  "issues": [',
    '    { "severity": "high" | "medium" | "low", "file": "caminho/arquivo", "reason": "descrição" }',
    '  ],',
    '  "confidence": "high" | "medium" | "low"',
    '}',
    '',
    'Antes de responder, faça uma checagem silenciosa para confirmar que o JSON está válido, que todos os campos obrigatórios estão preenchidos e que o texto está todo em português do Brasil, exceto identificadores técnicos.',
  ].join('\n');
}

export function buildSimplifiedPullRequestReviewPrompt(
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
    'Você é uma revisora técnica de Pull Requests do GitHub. Responda em português do Brasil.',
    '',
    `Repositório: ${repositoryOwner}/${repositoryName}`,
    `PR #${pullRequestNumber}: ${pullRequestSummary.title}`,
    `Autor: ${pullRequestSummary.author} | Estado: ${pullRequestSummary.state}${pullRequestSummary.draft ? ' (draft)' : ''}`,
    `Arquivos alterados: ${pullRequestSummary.changedFiles} | +${pullRequestSummary.additions}/-${pullRequestSummary.deletions}`,
    '',
    'Descrição do PR:',
    pullRequestSummary.body?.trim()
      ? pullRequestSummary.body
      : '(sem descrição)',
    '',
    'Contexto do diff:',
    `- back-end: ${changeSetAnalysis.hasBackendChanges ? 'sim' : 'não'}`,
    `- front-end: ${changeSetAnalysis.hasFrontendChanges ? 'sim' : 'não'}`,
    `- testes no PR: ${changeSetAnalysis.hasTestFiles ? 'sim' : 'não'}`,
    '',
    'Arquivos e diffs:',
    changedFilesSection || '(nenhum arquivo)',
    '',
    'Regras importantes:',
    '- APPROVE só se não houver nada bloqueante; REQUEST_CHANGES se houver algo a corrigir antes do merge; COMMENT se inconclusivo.',
    '- Se for back-end sem testes no diff, use REQUEST_CHANGES.',
    '- Se o PR estiver sem descrição, use REQUEST_CHANGES e mencione isso em negatives.',
    '',
    'Responda APENAS com JSON puro no formato abaixo. Sem markdown, sem cercas, sem texto extra.',
    'Campos obrigatórios: todos. Use arrays vazios se não houver itens.',
    '{',
    '  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
    '  "overview": "resumo curto do PR e motivo da decisão",',
    '  "improvements": ["sugestão curta 1", "..."],',
    '  "testsNotes": "avaliação dos testes em 1-2 frases",',
    '  "negatives": ["ponto negativo 1", "..."],',
    '  "positives": ["ponto positivo 1", "..."],',
    '  "issues": [ { "severity": "high" | "medium" | "low", "file": "caminho", "reason": "por quê" } ],',
    '  "confidence": "high" | "medium" | "low"',
    '}',
  ].join('\n');
}

function formatChangedFileSection(changedFile: GitHubPullRequestFile): string {
  const fileHeader = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})`;
  const filePatch = changedFile.patch
    ? `\n\`\`\`diff\n${changedFile.patch}\n\`\`\``
    : '\n_(sem diff disponível)_';

  return `${fileHeader}${filePatch}`;
}
