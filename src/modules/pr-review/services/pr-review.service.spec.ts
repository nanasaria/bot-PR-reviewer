import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GitHubPublishedReview,
  GitHubPullRequestFile,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment,
  GitHubPullRequestSummary,
} from '../../github/models/github-pull-request.model';
import { GitHubService } from '../../github/services/github.service';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import { OllamaService } from '../../ollama/services/ollama.service';
import { PrReviewService } from './pr-review.service';
import type { ClaudeReview } from '../models/claude-review.model';
import type { ReReview } from '../models/re-review.model';

const buildClaudeReview = (
  overrides: Partial<ClaudeReview> = {},
): ClaudeReview => ({
  decision: 'APPROVE',
  overview: 'A implementação atende à proposta do PR.',
  improvements: [],
  testsNotes: 'Os testes cobrem os cenários relevantes para a mudança.',
  negatives: [],
  positives: [],
  issues: [],
  confidence: 'high',
  ...overrides,
});

function expectStructuredReviewSections(reviewBody: string): void {
  expect(reviewBody).toContain('**Visão Geral**');
  expect(reviewBody).toContain('**Melhorias**');
  expect(reviewBody).toContain('**Testes**');
  expect(reviewBody).toContain('**Pontos Negativos**');
  expect(reviewBody).toContain('**Pontos Positivos**');
}

describe('PrReviewService.determineReviewEvent', () => {
  const prReviewService = Object.create(
    PrReviewService.prototype,
  ) as PrReviewService;

  it('APPROVE sem issues nem low-confidence => APPROVE', () => {
    expect(prReviewService.determineReviewEvent(buildClaudeReview())).toBe(
      'APPROVE',
    );
  });

  it('APPROVE com issue high => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          issues: [{ severity: 'high', file: 'a.ts', reason: 'bug' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('APPROVE com issue medium => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          issues: [{ severity: 'medium', file: 'a.ts', reason: 'x' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('APPROVE com confidence low e sem issues obrigatórias => COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({ decision: 'APPROVE', confidence: 'low' }),
      ),
    ).toBe('COMMENT');
  });

  it('APPROVE com confidence low e apenas issue low => APPROVE', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          confidence: 'low',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('APPROVE');
  });

  it('REQUEST_CHANGES com issue high => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'REQUEST_CHANGES',
          issues: [{ severity: 'high', file: 'a.ts', reason: 'bug' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('REQUEST_CHANGES com apenas issues low vira APPROVE', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'REQUEST_CHANGES',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('APPROVE');
  });

  it('APPROVE com apenas issues low vira APPROVE', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          confidence: 'high',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('APPROVE');
  });

  it('COMMENT com issue medium vira REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'COMMENT',
          issues: [{ severity: 'medium', file: 'a.ts', reason: 'x' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('COMMENT sem issues obrigatórias permanece COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({ decision: 'COMMENT', confidence: 'medium' }),
      ),
    ).toBe('COMMENT');
  });
});

describe('PrReviewService.reviewPullRequest', () => {
  const pullRequestUrl = 'https://github.com/acme/widgets/pull/42';
  const pullRequestSummary: GitHubPullRequestSummary = {
    title: 'Improve PR review flow',
    body: 'Adds safer fallback',
    author: 'notro',
    baseRef: 'main',
    headRef: 'feature/fallback',
    state: 'open',
    draft: false,
    changedFiles: 1,
    additions: 12,
    deletions: 4,
  };
  const changedFiles: GitHubPullRequestFile[] = [
    {
      filename: 'src/components/Button.tsx',
      status: 'modified',
      additions: 12,
      deletions: 4,
      changes: 16,
      patch: '@@ -1 +1 @@',
    },
  ];
  const publishedReview: GitHubPublishedReview = {
    id: 10,
    htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-10',
    event: 'COMMENT',
  };

  const buildService = (options?: {
    pullRequestSummary?: GitHubPullRequestSummary;
    changedFiles?: GitHubPullRequestFile[];
    publishedReview?: GitHubPublishedReview;
    reviewerLogin?: string;
    reviewComments?: GitHubPullRequestReviewComment[];
    reviews?: GitHubPullRequestReview[];
    issueComments?: { author: string; body: string; createdAt: string }[];
  }) => {
    const reviewSummary = options?.pullRequestSummary ?? pullRequestSummary;
    const reviewFiles = options?.changedFiles ?? changedFiles;
    const reviewPublication = options?.publishedReview ?? publishedReview;
    const gitHubServiceMock: jest.Mocked<
      Pick<
        GitHubService,
        | 'getPullRequestSummary'
        | 'listPullRequestFiles'
        | 'listPullRequestComments'
        | 'listPullRequestReviewComments'
        | 'listPullRequestReviews'
        | 'publishReview'
      >
    > = {
      getPullRequestSummary: jest.fn().mockResolvedValue(reviewSummary),
      listPullRequestFiles: jest.fn().mockResolvedValue(reviewFiles),
      listPullRequestComments: jest
        .fn()
        .mockResolvedValue(options?.issueComments ?? []),
      listPullRequestReviewComments: jest
        .fn()
        .mockResolvedValue(options?.reviewComments ?? []),
      listPullRequestReviews: jest
        .fn()
        .mockResolvedValue(options?.reviews ?? []),
      publishReview: jest.fn().mockResolvedValue(reviewPublication),
    };
    const claudeCliServiceMock: jest.Mocked<
      Pick<ClaudeCliService, 'runReview' | 'runReReview'>
    > = {
      runReview: jest.fn(),
      runReReview: jest.fn(),
    };
    const ollamaServiceMock: jest.Mocked<
      Pick<OllamaService, 'prepareForRequests' | 'runReview' | 'runReReview'>
    > = {
      prepareForRequests: jest.fn().mockResolvedValue(undefined),
      runReview: jest.fn(),
      runReReview: jest.fn(),
    };

    const configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'REVIEWER_LOGIN') {
          return options?.reviewerLogin;
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    const prReviewService = new PrReviewService(
      gitHubServiceMock as unknown as GitHubService,
      claudeCliServiceMock as unknown as ClaudeCliService,
      ollamaServiceMock as unknown as OllamaService,
      configServiceMock,
    );

    return {
      prReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    };
  };

  it('usa fallback do Ollama quando Claude retorna erro de limite', async () => {
    const {
      prReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    } = buildService();
    const ollamaReview: ClaudeReview = buildClaudeReview({
      decision: 'COMMENT',
      overview: 'Fallback local executado',
      confidence: 'medium',
      positives: ['O fallback local evita falha total da análise.'],
    });

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException("you've hit limit"),
    );
    ollamaServiceMock.runReview.mockResolvedValue(ollamaReview);

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReview).toHaveBeenCalledTimes(1);
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'COMMENT',
      'notro',
    );
    expectStructuredReviewSections(publishedBody);
    expect(publishedBody).toContain('Fallback local executado');
    expect(result.review).toEqual(publishedReview);
    expect(result.event).toBe('COMMENT');
  });

  it('usa fallback do Ollama quando a mensagem de limite vem combinada com stdout e stderr', async () => {
    const {
      prReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    } = buildService();
    const ollamaReview: ClaudeReview = buildClaudeReview({
      decision: 'COMMENT',
      overview: 'Fallback acionado a partir da saída combinada do Claude',
      confidence: 'medium',
    });

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException(
        "Claude CLI retornou código 1: stderr: warning | stdout: you've hit limit",
      ),
    );
    ollamaServiceMock.runReview.mockResolvedValue(ollamaReview);

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'COMMENT',
      'notro',
    );
    expect(result.event).toBe('COMMENT');
  });

  it('força REQUEST_CHANGES quando o PR está sem descrição', async () => {
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({
        pullRequestSummary: {
          ...pullRequestSummary,
          body: null,
        },
      });

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        overview: 'A implementação parece segura.',
        positives: ['A mudança é objetiva e fácil de acompanhar.'],
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'REQUEST_CHANGES',
      'notro',
    );
    expectStructuredReviewSections(publishedBody);
    expect(publishedBody).toContain('**Pontos Negativos**');
    expect(publishedBody).toContain('O PR está sem descrição');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'medium',
          file: 'Descrição do PR',
        }),
      ]),
    );
  });

  it('força REQUEST_CHANGES quando há alteração de back-end sem testes automatizados', async () => {
    const backendChangedFiles: GitHubPullRequestFile[] = [
      {
        filename: 'src/modules/payments/payment.service.ts',
        status: 'modified',
        additions: 18,
        deletions: 3,
        changes: 21,
        patch: '@@ -10,6 +10,14 @@',
      },
    ];
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({
        changedFiles: backendChangedFiles,
        publishedReview: {
          ...publishedReview,
          event: 'REQUEST_CHANGES',
        },
      });

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        overview:
          'A implementação parece consistente, mas vale acompanhar a estabilidade em produção.',
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'REQUEST_CHANGES',
      'notro',
    );
    expectStructuredReviewSections(publishedBody);
    expect(publishedBody).toContain('**Testes**');
    expect(publishedBody).toContain(
      'sem trazer testes automatizados para validar os cenários alterados',
    );
    expect(result.event).toBe('REQUEST_CHANGES');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'medium',
          file: 'src/modules/payments/payment.service.ts',
          reason:
            'O PR altera comportamento de back-end sem incluir testes automatizados cobrindo os cenários alterados.',
        }),
      ]),
    );
  });

  it('não força REQUEST_CHANGES quando há alteração de back-end COM testes automatizados', async () => {
    const backendWithTestsFiles: GitHubPullRequestFile[] = [
      {
        filename: 'src/modules/payments/payment.service.ts',
        status: 'modified',
        additions: 18,
        deletions: 3,
        changes: 21,
        patch: '@@ -10,6 +10,14 @@',
      },
      {
        filename: 'src/modules/payments/payment.service.spec.ts',
        status: 'modified',
        additions: 30,
        deletions: 0,
        changes: 30,
        patch: '@@ -1,5 +1,25 @@',
      },
    ];
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({
        changedFiles: backendWithTestsFiles,
        publishedReview: {
          ...publishedReview,
          event: 'APPROVE',
        },
      });

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        overview: 'A implementação está sólida.',
        testsNotes: 'Os testes cobrem os cenários relevantes.',
        positives: ['A cobertura automatizada acompanha a mudança.'],
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'APPROVE',
      'notro',
    );
    expectStructuredReviewSections(publishedBody);
    expect(publishedBody).toContain('A implementação está sólida.');
    expect(publishedBody).toContain('Os testes cobrem os cenários relevantes.');
    expect(result.event).toBe('APPROVE');
    expect(result.issues).toEqual([]);
  });

  it('não força mudança obrigatória por falta de testes em PR apenas de front-end', async () => {
    const frontendChangedFiles: GitHubPullRequestFile[] = [
      {
        filename: 'src/app/core/services/analytics.service.ts',
        status: 'modified',
        additions: 14,
        deletions: 2,
        changes: 16,
        patch: '@@ -1,3 +1,8 @@',
      },
    ];
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({
        changedFiles: frontendChangedFiles,
        publishedReview: {
          ...publishedReview,
          event: 'APPROVE',
        },
      });

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        overview: 'A mudança parece segura para merge.',
        positives: ['O impacto está concentrado no fluxo de interface.'],
      }),
    );

    const result = await prReviewService.reviewPullRequest(
      'https://github.com/acme/webapp/pull/42',
    );
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'webapp',
      42,
      expect.any(String),
      'APPROVE',
      'notro',
    );
    expectStructuredReviewSections(publishedBody);
    expect(publishedBody).toContain('A mudança parece segura para merge.');
    expect(result.event).toBe('APPROVE');
    expect(result.issues).toEqual([]);
  });

  it('não usa fallback do Ollama para erro diferente de limite', async () => {
    const { prReviewService, claudeCliServiceMock, ollamaServiceMock } =
      buildService();

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException('falha genérica do Claude'),
    );

    await expect(
      prReviewService.reviewPullRequest(pullRequestUrl),
    ).rejects.toThrow('falha genérica do Claude');
    expect(ollamaServiceMock.runReview).not.toHaveBeenCalled();
  });

  it('retorna erro claro quando Claude atinge limite e o Ollama também falha', async () => {
    const {
      prReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    } = buildService();

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException("you've hit limit"),
    );
    ollamaServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException('Ollama offline'),
    );

    await expect(
      prReviewService.reviewPullRequest(pullRequestUrl),
    ).rejects.toThrow(
      "Claude CLI atingiu o limite de uso e o fallback Ollama falhou. Claude: you've hit limit. Ollama: Ollama offline",
    );
    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(gitHubServiceMock.publishReview).not.toHaveBeenCalled();
  });

  it('prepara o Ollama antes de tentar a review de fallback', async () => {
    const { prReviewService, claudeCliServiceMock, ollamaServiceMock } =
      buildService();

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException("you've hit limit"),
    );
    ollamaServiceMock.prepareForRequests.mockRejectedValue(
      new InternalServerErrorException('Warm-up falhou'),
    );

    await expect(
      prReviewService.reviewPullRequest(pullRequestUrl),
    ).rejects.toThrow(
      "Claude CLI atingiu o limite de uso e o fallback Ollama falhou. Claude: you've hit limit. Ollama: Warm-up falhou",
    );
    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReview).not.toHaveBeenCalled();
  });

  it('retorna o evento realmente publicado pelo GitHub', async () => {
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService();

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        decision: 'REQUEST_CHANGES',
        overview: 'Há um problema importante',
        negatives: ['Existe um risco funcional que bloqueia o merge.'],
        issues: [{ severity: 'high', file: 'src/app.ts', reason: 'bug' }],
      }),
    );
    gitHubServiceMock.publishReview.mockResolvedValue({
      ...publishedReview,
      event: 'COMMENT',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(result.event).toBe('COMMENT');
    expect(result.review.event).toBe('COMMENT');
  });

  it('mantém review inicial quando REVIEWER_LOGIN está configurado mas não há comentários do reviewer', async () => {
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({ reviewerLogin: 'reviewer-bot' });

    claudeCliServiceMock.runReview.mockResolvedValue(
      buildClaudeReview({
        overview: 'Sem comentários do reviewer; review inicial executado.',
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
    expect(claudeCliServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(
      gitHubServiceMock.listPullRequestReviewComments,
    ).toHaveBeenCalledTimes(1);
    expect(gitHubServiceMock.listPullRequestReviews).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('initial');
  });

  it('não busca comentários extras de re-review quando REVIEWER_LOGIN não está configurado', async () => {
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService();

    claudeCliServiceMock.runReview.mockResolvedValue(buildClaudeReview());

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(
      gitHubServiceMock.listPullRequestReviewComments,
    ).not.toHaveBeenCalled();
    expect(gitHubServiceMock.listPullRequestReviews).not.toHaveBeenCalled();
    expect(result.mode).toBe('initial');
  });
});

describe('PrReviewService re-review flow', () => {
  const pullRequestUrl = 'https://github.com/acme/widgets/pull/42';
  const pullRequestSummary: GitHubPullRequestSummary = {
    title: 'Improve PR review flow',
    body: 'Adds safer fallback',
    author: 'notro',
    baseRef: 'main',
    headRef: 'feature/fallback',
    state: 'open',
    draft: false,
    changedFiles: 1,
    additions: 12,
    deletions: 4,
  };
  const changedFiles: GitHubPullRequestFile[] = [
    {
      filename: 'src/components/Button.tsx',
      status: 'modified',
      additions: 12,
      deletions: 4,
      changes: 16,
      patch: '@@ -1 +1 @@',
    },
  ];
  const publishedReview: GitHubPublishedReview = {
    id: 11,
    htmlUrl: 'https://github.com/acme/widgets/pull/42#pullrequestreview-11',
    event: 'COMMENT',
  };

  const buildReReview = (overrides: Partial<ReReview> = {}): ReReview => ({
    overview: 'Re-review concluído.',
    items: [],
    confidence: 'medium',
    ...overrides,
  });

  type ServiceOptions = {
    reviewerLogin?: string;
    reviewComments?: GitHubPullRequestReviewComment[];
    reviews?: GitHubPullRequestReview[];
    issueComments?: { author: string; body: string; createdAt: string }[];
    publishedReview?: GitHubPublishedReview;
  };

  const buildService = (options: ServiceOptions = {}) => {
    const gitHubServiceMock: jest.Mocked<
      Pick<
        GitHubService,
        | 'getPullRequestSummary'
        | 'listPullRequestFiles'
        | 'listPullRequestComments'
        | 'listPullRequestReviewComments'
        | 'listPullRequestReviews'
        | 'publishReview'
      >
    > = {
      getPullRequestSummary: jest.fn().mockResolvedValue(pullRequestSummary),
      listPullRequestFiles: jest.fn().mockResolvedValue(changedFiles),
      listPullRequestComments: jest
        .fn()
        .mockResolvedValue(options.issueComments ?? []),
      listPullRequestReviewComments: jest
        .fn()
        .mockResolvedValue(options.reviewComments ?? []),
      listPullRequestReviews: jest
        .fn()
        .mockResolvedValue(options.reviews ?? []),
      publishReview: jest
        .fn()
        .mockResolvedValue(options.publishedReview ?? publishedReview),
    };
    const claudeCliServiceMock: jest.Mocked<
      Pick<ClaudeCliService, 'runReview' | 'runReReview'>
    > = {
      runReview: jest.fn(),
      runReReview: jest.fn(),
    };
    const ollamaServiceMock: jest.Mocked<
      Pick<OllamaService, 'prepareForRequests' | 'runReview' | 'runReReview'>
    > = {
      prepareForRequests: jest.fn().mockResolvedValue(undefined),
      runReview: jest.fn(),
      runReReview: jest.fn(),
    };
    const configServiceMock = {
      get: jest.fn((key: string) =>
        key === 'REVIEWER_LOGIN' ? options.reviewerLogin : undefined,
      ),
    } as unknown as ConfigService;

    const prReviewService = new PrReviewService(
      gitHubServiceMock as unknown as GitHubService,
      claudeCliServiceMock as unknown as ClaudeCliService,
      ollamaServiceMock as unknown as OllamaService,
      configServiceMock,
    );

    return {
      prReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    };
  };

  it('dispara re-review quando há review-comment válido do reviewer configurado', async () => {
    const reviewComments: GitHubPullRequestReviewComment[] = [
      {
        id: 1001,
        author: 'reviewer-bot',
        body: 'Falta tratar erro de rede aqui.',
        filePath: 'src/components/Button.tsx',
        line: 12,
        originalLine: 12,
        position: 5,
        originalPosition: 5,
        diffHunk: '@@ -10,3 +10,3 @@\n   return value;',
        inReplyToId: null,
        pullRequestReviewId: 99,
        createdAt: '2026-04-26T10:00:00Z',
      },
    ];
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({ reviewerLogin: 'reviewer-bot', reviewComments });

    claudeCliServiceMock.runReReview.mockResolvedValue(
      buildReReview({
        overview: 'Erro de rede ainda não tratado.',
        items: [
          {
            originalComment: 'Falta tratar erro de rede aqui.',
            file: 'src/components/Button.tsx',
            status: 'nao_corrigido',
            analysis: 'O try/catch ainda não foi adicionado no novo diff.',
            recommendedAction:
              'Adicionar tratamento explícito do erro de rede.',
          },
        ],
        confidence: 'medium',
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReReview).toHaveBeenCalledTimes(1);
    expect(claudeCliServiceMock.runReview).not.toHaveBeenCalled();
    expect(result.mode).toBe('re-review');
    expect(result.reReview).toEqual({
      analyzed: 1,
      corrigido: 0,
      parcialmente_corrigido: 0,
      nao_corrigido: 1,
      nao_aplicavel: 0,
      impossivel_validar: 0,
    });
    const publishedBody = gitHubServiceMock.publishReview.mock.calls[0]?.[3];
    expect(publishedBody).toContain('## Re-review automatizada');
    expect(publishedBody).toContain(
      'Este comentário é um re-review automático',
    );
    expect(publishedBody).toContain('Comentários anteriores analisados: 1');
    expect(publishedBody).toContain('**Status:** Não corrigido');
    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'REQUEST_CHANGES',
      'notro',
    );
  });

  it('aprova quando todos os pontos foram corrigidos no re-review', async () => {
    const reviewComments: GitHubPullRequestReviewComment[] = [
      {
        id: 2001,
        author: 'reviewer-bot',
        body: 'Trocar nome da função.',
        filePath: 'src/components/Button.tsx',
        line: 30,
        originalLine: 30,
        position: 8,
        originalPosition: 8,
        diffHunk: null,
        inReplyToId: null,
        pullRequestReviewId: 100,
        createdAt: '2026-04-26T11:00:00Z',
      },
    ];
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({
        reviewerLogin: 'reviewer-bot',
        reviewComments,
        publishedReview: { ...publishedReview, event: 'APPROVE' },
      });

    claudeCliServiceMock.runReReview.mockResolvedValue(
      buildReReview({
        overview: 'Todos os pontos foram endereçados.',
        items: [
          {
            originalComment: 'Trocar nome da função.',
            file: 'src/components/Button.tsx',
            status: 'corrigido',
            analysis: 'Função renomeada conforme sugerido.',
            recommendedAction: 'Nenhuma',
          },
        ],
        confidence: 'high',
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(result.mode).toBe('re-review');
    expect(result.event).toBe('APPROVE');
    expect(result.reReview?.corrigido).toBe(1);
    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'APPROVE',
      'notro',
    );
  });

  it('ignora comentários de outros usuários e mantém review inicial', async () => {
    const reviewComments: GitHubPullRequestReviewComment[] = [
      {
        id: 3001,
        author: 'someone-else',
        body: 'Comentário externo.',
        filePath: 'src/components/Button.tsx',
        line: 1,
        originalLine: 1,
        position: 1,
        originalPosition: 1,
        diffHunk: null,
        inReplyToId: null,
        pullRequestReviewId: 50,
        createdAt: '2026-04-26T12:00:00Z',
      },
    ];
    const { prReviewService, claudeCliServiceMock } = buildService({
      reviewerLogin: 'reviewer-bot',
      reviewComments,
    });

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      overview: 'Initial review.',
      improvements: [],
      testsNotes: 'Os testes cobrem os cenários relevantes para a mudança.',
      negatives: [],
      positives: [],
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
    expect(claudeCliServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('initial');
  });

  it('faz fallback para Ollama quando Claude bate o limite no re-review', async () => {
    const reviewComments: GitHubPullRequestReviewComment[] = [
      {
        id: 4001,
        author: 'reviewer-bot',
        body: 'Validar entrada vazia.',
        filePath: 'src/components/Button.tsx',
        line: 5,
        originalLine: 5,
        position: 2,
        originalPosition: 2,
        diffHunk: null,
        inReplyToId: null,
        pullRequestReviewId: 70,
        createdAt: '2026-04-26T13:00:00Z',
      },
    ];
    const { prReviewService, claudeCliServiceMock, ollamaServiceMock } =
      buildService({
        reviewerLogin: 'reviewer-bot',
        reviewComments,
        publishedReview: { ...publishedReview, event: 'REQUEST_CHANGES' },
      });

    claudeCliServiceMock.runReReview.mockRejectedValue(
      new InternalServerErrorException("you've hit limit"),
    );
    ollamaServiceMock.runReReview.mockResolvedValue(
      buildReReview({
        overview: 'Re-review via Ollama.',
        items: [
          {
            originalComment: 'Validar entrada vazia.',
            file: 'src/components/Button.tsx',
            status: 'parcialmente_corrigido',
            analysis: 'Entrada vazia ainda dispara warning silencioso.',
            recommendedAction:
              'Lançar erro explícito quando a entrada for vazia.',
          },
        ],
        confidence: 'medium',
      }),
    );

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReReview).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('re-review');
    expect(result.event).toBe('REQUEST_CHANGES');
    expect(result.reReview?.parcialmente_corrigido).toBe(1);
  });

  it('ignora corpo auto-gerado pelo bot ao coletar comentários do reviewer', async () => {
    const reviews: GitHubPullRequestReview[] = [
      {
        id: 9001,
        author: 'reviewer-bot',
        body: '## Re-review automatizada\nResumo do bot.',
        state: 'COMMENTED',
        submittedAt: '2026-04-26T09:00:00Z',
      },
    ];
    const { prReviewService, claudeCliServiceMock } = buildService({
      reviewerLogin: 'reviewer-bot',
      reviews,
    });

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      overview: 'Initial fallback.',
      improvements: [],
      testsNotes: 'Os testes cobrem os cenários relevantes para a mudança.',
      negatives: [],
      positives: [],
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
    expect(result.mode).toBe('initial');
  });
});
