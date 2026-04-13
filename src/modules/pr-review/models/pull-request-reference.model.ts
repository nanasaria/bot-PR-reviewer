export interface GitHubPullRequestReference {
  owner: string;
  repositoryName: string;
  pullRequestNumber: number;
}

export const GITHUB_PULL_REQUEST_URL_EXAMPLE =
  'https://github.com/owner/repo/pull/123';
export const GITHUB_PULL_REQUEST_URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
export const GITHUB_PULL_REQUEST_URL_VALIDATION_MESSAGE = `prUrl deve ser uma URL de Pull Request do GitHub válida. Exemplo: ${GITHUB_PULL_REQUEST_URL_EXAMPLE}`;

export function parsePullRequestUrl(
  pullRequestUrl: string,
): GitHubPullRequestReference {
  if (
    typeof pullRequestUrl !== 'string' ||
    pullRequestUrl.trim().length === 0
  ) {
    throw new Error('URL do PR é obrigatória.');
  }

  const normalizedPullRequestUrl = pullRequestUrl.trim();
  const pullRequestUrlMatch = normalizedPullRequestUrl.match(
    GITHUB_PULL_REQUEST_URL_PATTERN,
  );

  if (!pullRequestUrlMatch) {
    throw new Error(
      `URL do PR inválida. Esperado formato: ${GITHUB_PULL_REQUEST_URL_EXAMPLE}`,
    );
  }

  const [, owner, repositoryName, pullRequestNumberText] = pullRequestUrlMatch;
  const pullRequestNumber = Number.parseInt(pullRequestNumberText, 10);

  if (!Number.isFinite(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error('Número do PR inválido na URL.');
  }

  return { owner, repositoryName, pullRequestNumber };
}
