import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';

export interface PullRequestChangeSetAnalysis {
  hasBackendChanges: boolean;
  hasFrontendChanges: boolean;
  hasTestFiles: boolean;
  backendFiles: string[];
}

type RepositoryProfile = 'frontend' | 'backend' | 'mixed' | 'unknown';

/**
 * Listas de repositórios conhecidos usadas para refinar a classificação de arquivos.
 * Repositórios não listados aqui recebem o perfil 'unknown' e são classificados
 * apenas por padrões de nome/extensão, o que pode ser menos preciso.
 *
 * Para adicionar um novo repositório: inclua o nome (lowercase) no Set correspondente.
 */
const KNOWN_FRONTEND_REPOSITORIES = new Set([
  'dashboards',
  'webapp',
  'webapp-2',
]);
const KNOWN_BACKEND_REPOSITORIES = new Set([
  'export',
  'public-api',
  'server',
  'worker',
]);
const KNOWN_MIXED_REPOSITORIES = new Set(['orc-lite']);
const TEST_FILE_PATTERN =
  /(^|\/)(__tests__|tests?|specs?)\/|(\.|-)(spec|test)\.[a-z0-9]+$/i;
const FRONTEND_FILE_PATTERN =
  /(^|\/)(components?|pages?|layouts?|hooks?|composables?|frontend|client|web|www|ui|styles?|assets?|projects?)\//i;
const FRONTEND_EXTENSION_PATTERN =
  /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|styl|html)$/i;
const FRONTEND_FILENAME_PATTERN =
  /\.(component|directive|pipe|page|layout)\.[a-z0-9]+$/i;
const FRONTEND_SOURCE_PATH_PATTERN =
  /(^|\/)(src|public|e2e|template|projects)\//i;
const FRONTEND_MONOREPO_PACKAGE_PATTERN = /(^|\/)packages\/(app|webapp)\//i;
const BACKEND_FILE_PATTERN =
  /(^|\/)(backend|server|api|controllers?|services?|repositories?|entities?|models?|schemas?|middlewares?|guards?|interceptors?|pipes?|resolvers?|db|database|migrations?)\//i;
const BACKEND_FILENAME_PATTERN =
  /\.(controller|service|module|repository|entity|dto|guard|interceptor|middleware|pipe|resolver)\.[a-z0-9]+$/i;
const BACKEND_EXTENSION_PATTERN =
  /\.(ts|js|mts|cts|mjs|cjs|py|rb|java|kt|cs|php|go|rs|scala|sql|prisma)$/i;
const SOURCE_DIRECTORY_PATTERN = /(^|\/)(src|server|api|backend)\//i;
const BACKEND_MONOREPO_PACKAGE_PATTERN =
  /(^|\/)packages\/([a-z0-9-]+(?:-api|-worker|-triggers)|crons|exports|server|websocket)\//i;

export function analyzePullRequestChangeSet(
  changedFiles: GitHubPullRequestFile[],
  repositoryName?: string,
): PullRequestChangeSetAnalysis {
  const repositoryProfile = getRepositoryProfile(repositoryName);
  const backendFiles = changedFiles
    .map((changedFile) => changedFile.filename)
    .filter((filename) => isBackendFile(filename, repositoryProfile));

  return {
    hasBackendChanges: backendFiles.length > 0,
    hasFrontendChanges: changedFiles.some((changedFile) =>
      isFrontendFile(changedFile.filename, repositoryProfile),
    ),
    hasTestFiles: changedFiles.some((changedFile) =>
      isTestFile(changedFile.filename),
    ),
    backendFiles,
  };
}

function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERN.test(filename);
}

function isFrontendFile(
  filename: string,
  repositoryProfile: RepositoryProfile,
): boolean {
  if (FRONTEND_MONOREPO_PACKAGE_PATTERN.test(filename)) {
    return true;
  }

  if (repositoryProfile === 'frontend') {
    return (
      FRONTEND_SOURCE_PATH_PATTERN.test(filename) ||
      FRONTEND_EXTENSION_PATTERN.test(filename) ||
      FRONTEND_FILENAME_PATTERN.test(filename)
    );
  }

  return (
    FRONTEND_EXTENSION_PATTERN.test(filename) ||
    FRONTEND_FILE_PATTERN.test(filename) ||
    FRONTEND_FILENAME_PATTERN.test(filename)
  );
}

function isBackendFile(
  filename: string,
  repositoryProfile: RepositoryProfile,
): boolean {
  if (isTestFile(filename) || isFrontendFile(filename, repositoryProfile)) {
    return false;
  }

  if (BACKEND_MONOREPO_PACKAGE_PATTERN.test(filename)) {
    return true;
  }

  if (repositoryProfile === 'frontend') {
    return false;
  }

  if (repositoryProfile === 'backend') {
    return (
      BACKEND_EXTENSION_PATTERN.test(filename) &&
      /(^|\/)(src|server|api|backend|bin|scripts?|migrations?|seeds?)\//i.test(
        filename,
      )
    );
  }

  return (
    BACKEND_FILE_PATTERN.test(filename) ||
    BACKEND_FILENAME_PATTERN.test(filename) ||
    (BACKEND_EXTENSION_PATTERN.test(filename) &&
      SOURCE_DIRECTORY_PATTERN.test(filename))
  );
}

function getRepositoryProfile(repositoryName?: string): RepositoryProfile {
  const normalizedRepositoryName = repositoryName?.trim().toLowerCase();

  if (!normalizedRepositoryName) {
    return 'unknown';
  }

  if (KNOWN_FRONTEND_REPOSITORIES.has(normalizedRepositoryName)) {
    return 'frontend';
  }

  if (KNOWN_BACKEND_REPOSITORIES.has(normalizedRepositoryName)) {
    return 'backend';
  }

  if (KNOWN_MIXED_REPOSITORIES.has(normalizedRepositoryName)) {
    return 'mixed';
  }

  return 'unknown';
}
