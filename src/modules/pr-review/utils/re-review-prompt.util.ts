import type {
  GitHubPullRequestFile,
  GitHubPullRequestSummary,
} from '../../github/models/github-pull-request.model';
import type { ReviewerCommentModel } from '../models/reviewer-comment.model';

export interface ReReviewPromptModel {
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  pullRequestSummary: GitHubPullRequestSummary;
  changedFiles: GitHubPullRequestFile[];
  reviewerLogin: string;
  reviewerComments: ReviewerCommentModel[];
}

export function buildReReviewPrompt(
  reviewContext: ReReviewPromptModel,
): string {
  const {
    repositoryOwner,
    repositoryName,
    pullRequestNumber,
    pullRequestSummary,
    changedFiles,
    reviewerLogin,
    reviewerComments,
  } = reviewContext;

  const changedFilesSection = changedFiles
    .map((changedFile) => formatChangedFileSection(changedFile))
    .join('\n\n');
  const reviewerCommentsSection = reviewerComments
    .map((comment, index) => formatReviewerCommentSection(comment, index + 1))
    .join('\n\n');

  return [
    'Você é uma engenheira sênior conduzindo um RE-REVIEW de um Pull Request do GitHub.',
    'Este é um re-review estritamente limitado: você deve analisar APENAS os comentários anteriores do reviewer configurado, listados abaixo.',
    'Não procure problemas novos fora do escopo desses comentários. Não repita literalmente o que já foi dito antes.',
    '',
    `Repositório: ${repositoryOwner}/${repositoryName}`,
    `PR #${pullRequestNumber}: ${pullRequestSummary.title}`,
    `Autor do PR: ${pullRequestSummary.author}`,
    `Reviewer configurado: ${reviewerLogin}`,
    `Branch: ${pullRequestSummary.headRef} -> ${pullRequestSummary.baseRef}`,
    `Estado: ${pullRequestSummary.state}${pullRequestSummary.draft ? ' (draft)' : ''}`,
    `Arquivos alterados: ${pullRequestSummary.changedFiles} | +${pullRequestSummary.additions}/-${pullRequestSummary.deletions}`,
    '',
    'Descrição do PR:',
    pullRequestSummary.body?.trim()
      ? pullRequestSummary.body
      : '(sem descrição)',
    '',
    'Comentários anteriores do reviewer (somente estes itens devem ser avaliados):',
    reviewerCommentsSection || '(nenhum comentário anterior)',
    '',
    'Arquivos e diffs atuais do PR:',
    changedFilesSection || '(nenhum arquivo)',
    '',
    'Para cada comentário anterior, avalie se ele foi endereçado no diff atual e classifique o status:',
    '- "corrigido": o ponto foi resolvido completamente.',
    '- "parcialmente_corrigido": o ponto foi parcialmente endereçado, mas ainda há ajustes pendentes.',
    '- "nao_corrigido": o ponto continua presente no código atual.',
    '- "nao_aplicavel": o trecho relevante foi removido/refatorado a ponto de o ponto não fazer mais sentido.',
    '- "impossivel_validar": não é possível afirmar com segurança o estado do ponto a partir do diff.',
    '',
    'Regras estritas:',
    '- Avalie um item por comentário anterior, na mesma ordem em que aparecem acima.',
    '- Em "originalComment", coloque um trecho curto (até 200 caracteres) que identifique o comentário anterior.',
    '- Em "file", use o caminho do arquivo associado ao comentário. Se o arquivo foi renomeado, use o novo caminho do diff.',
    '- Se o arquivo associado ao comentário não estiver mais presente no diff e não for possível mapear para um novo caminho, use "(arquivo não localizado)" e marque o status como "nao_aplicavel" ou "impossivel_validar".',
    '- Se o comentário anterior for genérico (sem arquivo/linha), avalie apenas o tema correspondente sem expandir o escopo.',
    '- Não inclua problemas novos fora do escopo dos comentários anteriores.',
    '- Não repita literalmente o comentário anterior; em "analysis" descreva o estado atual e em "recommendedAction" diga o próximo passo (ou "Nenhuma" quando "corrigido"/"nao_aplicavel").',
    '',
    'Regras de linguagem:',
    '- escreva em português do Brasil natural, claro e profissional.',
    '- mantenha em inglês apenas nomes técnicos: arquivos, identificadores, comandos, APIs.',
    '',
    'IMPORTANTE: seja objetiva e concisa. Evite textos longos.',
    '',
    'Estrutura obrigatória da resposta (JSON puro, sem markdown, sem cercas, sem prosa fora do JSON):',
    '{',
    '  "overview": "1 a 2 frases curtas resumindo o re-review",',
    '  "items": [',
    '    {',
    '      "originalComment": "trecho curto do comentário original",',
    '      "file": "caminho/arquivo ou (arquivo não localizado)",',
    '      "status": "corrigido" | "parcialmente_corrigido" | "nao_corrigido" | "nao_aplicavel" | "impossivel_validar",',
    '      "analysis": "estado atual do ponto, em 1-2 frases curtas",',
    '      "recommendedAction": "próximo passo objetivo ou Nenhuma"',
    '    }',
    '  ],',
    '  "confidence": "high" | "medium" | "low"',
    '}',
    '',
    'Antes de responder, faça uma checagem silenciosa para confirmar que o JSON está válido, que cada comentário anterior gerou exatamente 1 item, e que o texto está em português do Brasil exceto identificadores técnicos.',
  ].join('\n');
}

function formatChangedFileSection(changedFile: GitHubPullRequestFile): string {
  const renameInfo = changedFile.previousFilename
    ? ` (renomeado de ${changedFile.previousFilename})`
    : '';
  const fileHeader = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})${renameInfo}`;
  const filePatch = changedFile.patch
    ? `\n\`\`\`diff\n${changedFile.patch}\n\`\`\``
    : '\n_(sem diff disponível)_';

  return `${fileHeader}${filePatch}`;
}

function formatReviewerCommentSection(
  reviewerComment: ReviewerCommentModel,
  itemNumber: number,
): string {
  const filePathInfo = reviewerComment.filePath ?? '(sem arquivo associado)';
  const lineInfo =
    reviewerComment.line === null
      ? '(sem linha associada)'
      : String(reviewerComment.line);
  const outdatedInfo = reviewerComment.outdated
    ? ' [trecho original não existe mais no diff atual]'
    : '';
  const codeSnippetInfo = reviewerComment.codeSnippet
    ? `\n  Trecho original (diff hunk):\n  \`\`\`\n${reviewerComment.codeSnippet
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')}\n  \`\`\``
    : '';

  return [
    `### Comentário ${itemNumber} (${reviewerComment.source})${outdatedInfo}`,
    `- Arquivo: ${filePathInfo}`,
    `- Linha: ${lineInfo}`,
    `- Autor: ${reviewerComment.author}`,
    `- Data: ${reviewerComment.createdAt || '(desconhecida)'}`,
    `- Conteúdo:\n  ${reviewerComment.body.split('\n').join('\n  ')}`,
    codeSnippetInfo,
  ]
    .filter((line) => line !== '')
    .join('\n');
}
