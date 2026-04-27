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

const MAX_DIFF_HUNK_LINES = 10;

export function buildReReviewPrompt(
  reviewContext: ReReviewPromptModel,
): string {
  const { pullRequestSummary, changedFiles, reviewerComments } = reviewContext;

  const relevantFiles = selectRelevantFilesForReReview(
    changedFiles,
    reviewerComments,
  );
  const changedFilesSection = relevantFiles
    .map((changedFile) => formatChangedFileSection(changedFile))
    .join('\n\n');
  const reviewerCommentsSection = reviewerComments
    .map((comment, index) => formatReviewerCommentSection(comment, index + 1))
    .join('\n\n');

  return [
    'Re-review estritamente limitado: avalie APENAS os comentários abaixo, na mesma ordem. Não inclua problemas novos fora desse escopo. Não repita literalmente o comentário.',
    '',
    `PR: ${pullRequestSummary.title}`,
    '',
    'Comentários anteriores:',
    reviewerCommentsSection || '(nenhum)',
    '',
    'Diff atual (apenas arquivos relevantes):',
    changedFilesSection || '(nenhum arquivo relevante)',
    '',
    'Status:',
    '- corrigido: resolvido.',
    '- parcialmente_corrigido: resolvido em parte.',
    '- nao_corrigido: ainda presente.',
    '- nao_aplicavel: trecho removido/refatorado, ponto não cabe mais.',
    '- impossivel_validar: não dá para afirmar pelo diff.',
    '',
    'Regras:',
    '- 1 item por comentário, mesma ordem.',
    '- "file" = caminho atual; se renomeado, use o novo. Se sumiu sem mapeamento, use "(arquivo não localizado)" + status nao_aplicavel ou impossivel_validar.',
    '- "originalComment": trecho curto (≤200 chars) que identifique o ponto.',
    '- "analysis": estado atual em 1-2 frases.',
    '- "recommendedAction": próximo passo objetivo, ou "Nenhuma" para corrigido/nao_aplicavel.',
    '- PT-BR; em inglês apenas nomes técnicos.',
    '',
    'Responda APENAS com JSON puro, sem markdown nem prosa fora do JSON:',
    '{',
    '  "overview": "1-2 frases",',
    '  "items": [',
    '    { "originalComment": "...", "file": "...", "status": "corrigido|parcialmente_corrigido|nao_corrigido|nao_aplicavel|impossivel_validar", "analysis": "...", "recommendedAction": "..." }',
    '  ],',
    '  "confidence": "high|medium|low"',
    '}',
  ].join('\n');
}

export function selectRelevantFilesForReReview(
  changedFiles: GitHubPullRequestFile[],
  reviewerComments: ReviewerCommentModel[],
): GitHubPullRequestFile[] {
  if (reviewerComments.length === 0) {
    return changedFiles;
  }

  const everyCommentHasFile = reviewerComments.every(
    (comment) => comment.filePath !== null && comment.filePath.length > 0,
  );
  if (!everyCommentHasFile) {
    return changedFiles;
  }

  const referencedPaths = new Set<string>();
  for (const comment of reviewerComments) {
    if (comment.filePath) {
      referencedPaths.add(comment.filePath);
    }
  }

  return changedFiles.filter(
    (changedFile) =>
      referencedPaths.has(changedFile.filename) ||
      (changedFile.previousFilename !== undefined &&
        referencedPaths.has(changedFile.previousFilename)),
  );
}

function formatChangedFileSection(changedFile: GitHubPullRequestFile): string {
  const renameInfo = changedFile.previousFilename
    ? ` (renomeado de ${changedFile.previousFilename})`
    : '';
  const fileHeader = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})${renameInfo}`;
  const filePatch = changedFile.patch
    ? `\n\`\`\`diff\n${changedFile.patch}\n\`\`\``
    : '\n_(sem diff)_';

  return `${fileHeader}${filePatch}`;
}

function formatReviewerCommentSection(
  reviewerComment: ReviewerCommentModel,
  itemNumber: number,
): string {
  const location = formatReviewerCommentLocation(reviewerComment);
  const outdatedInfo = reviewerComment.outdated ? ' [outdated]' : '';
  const compactedHunk = compactDiffHunk(reviewerComment.codeSnippet);
  const codeSnippetInfo = compactedHunk
    ? `\nhunk:\n\`\`\`\n${compactedHunk}\n\`\`\``
    : '';

  return `${itemNumber}. ${location}${outdatedInfo}\n> ${reviewerComment.body
    .split('\n')
    .join('\n> ')}${codeSnippetInfo}`;
}

function formatReviewerCommentLocation(
  reviewerComment: ReviewerCommentModel,
): string {
  if (!reviewerComment.filePath) {
    return '(comentário geral)';
  }

  if (reviewerComment.line === null) {
    return reviewerComment.filePath;
  }

  return `${reviewerComment.filePath}:${reviewerComment.line}`;
}

function compactDiffHunk(diffHunk: string | null): string | null {
  if (!diffHunk) {
    return null;
  }

  const lines = diffHunk.split('\n');
  if (lines.length <= MAX_DIFF_HUNK_LINES) {
    return diffHunk;
  }

  const tail = lines.slice(-MAX_DIFF_HUNK_LINES);
  return tail.join('\n');
}
