const mockPullsGet = jest.fn();
const mockPullsListFiles = jest.fn();
const mockPullsCreateReview = jest.fn();
const mockPaginate = jest.fn();
const mockUsersGetAuthenticated = jest.fn();
const mockOctokit = jest.fn().mockImplementation(() => ({
  pulls: {
    get: mockPullsGet,
    listFiles: mockPullsListFiles,
    createReview: mockPullsCreateReview,
  },
  users: {
    getAuthenticated: mockUsersGetAuthenticated,
  },
  paginate: mockPaginate,
}));

jest.mock('@octokit/rest', () => ({
  Octokit: mockOctokit,
}));

import { Octokit } from '@octokit/rest';
import { GitHubService } from './github.service';

describe('GitHubService', () => {
  const buildService = (
    overrides: Partial<Record<string, string>> = {},
  ): GitHubService => {
    const configServiceMock = {
      get: jest.fn((key: string) => {
        const defaultValues: Record<string, string> = {
          GITHUB_TOKEN: 'github-token',
          GITHUB_API_BASE_URL: 'https://api.github.test',
        };

        return overrides[key] ?? defaultValues[key];
      }),
    };

    return new GitHubService(configServiceMock as never);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersGetAuthenticated.mockResolvedValue({
      data: { login: 'notro' },
    });
  });

  it('instancia Octokit com token e baseUrl configurados', () => {
    buildService();

    expect(Octokit).toHaveBeenCalledWith({
      auth: 'github-token',
      baseUrl: 'https://api.github.test',
    });
  });

  it('mapeia o resumo do pull request', async () => {
    const gitHubService = buildService();
    mockPullsGet.mockResolvedValue({
      data: {
        title: 'Improve review flow',
        body: 'Detalhes do PR',
        user: { login: 'notro' },
        base: { ref: 'main' },
        head: { ref: 'feature/improve-review' },
        state: 'open',
        draft: false,
        changed_files: 3,
        additions: 20,
        deletions: 5,
      },
    });

    await expect(
      gitHubService.getPullRequestSummary('acme', 'widgets', 42),
    ).resolves.toEqual({
      title: 'Improve review flow',
      body: 'Detalhes do PR',
      author: 'notro',
      baseRef: 'main',
      headRef: 'feature/improve-review',
      state: 'open',
      draft: false,
      changedFiles: 3,
      additions: 20,
      deletions: 5,
    });
  });

  it('usa autor desconhecido quando o GitHub não informa user.login', async () => {
    const gitHubService = buildService();
    mockPullsGet.mockResolvedValue({
      data: {
        title: 'Improve review flow',
        body: null,
        user: null,
        base: { ref: 'main' },
        head: { ref: 'feature/improve-review' },
        state: 'open',
        draft: false,
        changed_files: 1,
        additions: 10,
        deletions: 2,
      },
    });

    await expect(
      gitHubService.getPullRequestSummary('acme', 'widgets', 42),
    ).resolves.toMatchObject({
      author: 'desconhecido',
    });
  });

  it('lança erro amigável ao falhar ao buscar resumo do PR', async () => {
    const gitHubService = buildService();
    mockPullsGet.mockRejectedValue(new Error('GitHub indisponível'));

    await expect(
      gitHubService.getPullRequestSummary('acme', 'widgets', 42),
    ).rejects.toThrow(
      'Não foi possível buscar o PR no GitHub: GitHub indisponível',
    );
  });

  it('lista e mapeia os arquivos alterados do pull request', async () => {
    const gitHubService = buildService();
    mockPaginate.mockResolvedValue([
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 12,
        deletions: 4,
        changes: 16,
        patch: '@@ -1 +1 @@',
      },
    ]);

    await expect(
      gitHubService.listPullRequestFiles('acme', 'widgets', 42),
    ).resolves.toEqual([
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 12,
        deletions: 4,
        changes: 16,
        patch: '@@ -1 +1 @@',
      },
    ]);
    expect(mockPaginate).toHaveBeenCalledWith(mockPullsListFiles, {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      per_page: 100,
    });
  });

  it('lança erro amigável ao falhar ao listar arquivos do PR', async () => {
    const gitHubService = buildService();
    mockPaginate.mockRejectedValue(new Error('rate limit'));

    await expect(
      gitHubService.listPullRequestFiles('acme', 'widgets', 42),
    ).rejects.toThrow('Não foi possível buscar os arquivos do PR: rate limit');
  });

  it('publica a review e mapeia o retorno do GitHub', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview.mockResolvedValue({
      data: {
        id: 15,
        html_url:
          'https://github.com/acme/widgets/pull/42#pullrequestreview-15',
      },
    });

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'COMMENT',
      ),
    ).resolves.toEqual({
      id: 15,
      htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-15',
      event: 'COMMENT',
    });
  });

  it('rebaixa preventivamente APPROVE para COMMENT ao identificar PR próprio', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview.mockResolvedValue({
      data: {
        id: 16,
        html_url:
          'https://github.com/acme/widgets/pull/42#pullrequestreview-16',
      },
    });

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'APPROVE',
        'notro',
      ),
    ).resolves.toEqual({
      id: 16,
      htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-16',
      event: 'COMMENT',
    });

    expect(mockUsersGetAuthenticated).toHaveBeenCalledTimes(1);
    expect(mockPullsCreateReview).toHaveBeenCalledTimes(1);
    expect(mockPullsCreateReview).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      body: 'Review pronta',
      event: 'COMMENT',
    });
  });

  it('rebaixa REQUEST_CHANGES para COMMENT ao revisar o próprio PR', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview
      .mockRejectedValueOnce(
        Object.assign(new Error('Unprocessable Entity'), {
          status: 422,
          response: {
            data: {
              message: 'Validation Failed',
              errors: [
                {
                  message: 'Cannot request changes on your own pull request',
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce({
        data: {
          id: 16,
          html_url:
            'https://github.com/acme/widgets/pull/42#pullrequestreview-16',
        },
      });

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'REQUEST_CHANGES',
      ),
    ).resolves.toEqual({
      id: 16,
      htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-16',
      event: 'COMMENT',
    });

    expect(mockPullsCreateReview).toHaveBeenNthCalledWith(1, {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      body: 'Review pronta',
      event: 'REQUEST_CHANGES',
    });
    expect(mockPullsCreateReview).toHaveBeenNthCalledWith(2, {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      body: 'Review pronta',
      event: 'COMMENT',
    });
  });

  it('rebaixa APPROVE para COMMENT ao revisar o próprio PR', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview
      .mockRejectedValueOnce(
        Object.assign(new Error('Unprocessable Entity'), {
          status: 422,
          response: {
            data: {
              message: 'Validation Failed',
              errors: [
                {
                  message: 'Review Can not approve your own pull request',
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce({
        data: {
          id: 17,
          html_url:
            'https://github.com/acme/widgets/pull/42#pullrequestreview-17',
        },
      });

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'APPROVE',
      ),
    ).resolves.toEqual({
      id: 17,
      htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-17',
      event: 'COMMENT',
    });

    expect(mockPullsCreateReview).toHaveBeenNthCalledWith(1, {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      body: 'Review pronta',
      event: 'APPROVE',
    });
    expect(mockPullsCreateReview).toHaveBeenNthCalledWith(2, {
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      body: 'Review pronta',
      event: 'COMMENT',
    });
  });

  it('não rebaixa REQUEST_CHANGES em erro 422 sem indicação de self-review', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview.mockRejectedValue(
      Object.assign(new Error('Validation failed'), {
        status: 422,
        response: {
          data: {
            message: 'Validation Failed',
            errors: [{ message: 'Body is too long' }],
          },
        },
      }),
    );

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'REQUEST_CHANGES',
      ),
    ).rejects.toThrow('Não foi possível publicar a review: Validation failed');

    expect(mockPullsCreateReview).toHaveBeenCalledTimes(1);
  });

  it('lança erro amigável ao falhar ao publicar review', async () => {
    const gitHubService = buildService();
    mockPullsCreateReview.mockRejectedValue(new Error('permission denied'));

    await expect(
      gitHubService.publishReview(
        'acme',
        'widgets',
        42,
        'Review pronta',
        'REQUEST_CHANGES',
      ),
    ).rejects.toThrow('Não foi possível publicar a review: permission denied');
  });
});
