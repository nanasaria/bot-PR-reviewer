import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';
import type { PullRequestReviewPromptModel } from '../models/pull-request-review-prompt.model';

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

  return [
    'Você é uma engenheira sênior revisando um Pull Request do GitHub.',
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
    'Arquivos e diffs:',
    changedFilesSection || '(nenhum arquivo)',
    '',
    'Revise focando em: bugs, regressões, edge cases, segurança, performance, legibilidade e necessidade de testes.',
    '',
    'Regras de decisão:',
    '- use APPROVE somente se não houver nenhuma mudança obrigatória',
    '- use REQUEST_CHANGES se houver algo que precise ser corrigido antes do merge',
    '- use COMMENT se estiver inconclusivo ou houver apenas sugestões leves',
    '',
    'Responda APENAS com JSON puro (sem markdown, sem prosa, sem cercas de código), no formato:',
    '{',
    '  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
    '  "body": "texto final da review em português do Brasil, objetivo e profissional",',
    '  "issues": [',
    '    { "severity": "high" | "medium" | "low", "file": "caminho/arquivo", "reason": "descrição" }',
    '  ],',
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
