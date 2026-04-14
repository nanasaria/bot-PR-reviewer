import { InternalServerErrorException } from '@nestjs/common';
import type {
  GitHubPublishedReview,
  GitHubPullRequestFile,
  GitHubPullRequestSummary,
} from '../../github/models/github-pull-request.model';
import { GitHubService } from '../../github/services/github.service';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import { OllamaService } from '../../ollama/services/ollama.service';
import { PrReviewService } from './pr-review.service';
import type { ClaudeReview } from '../models/claude-review.model';

describe('PrReviewService.determineReviewEvent', () => {
  const prReviewService = Object.create(
    PrReviewService.prototype,
  ) as PrReviewService;

  const buildClaudeReview = (
    overrides: Partial<ClaudeReview> = {},
  ): ClaudeReview => ({
    decision: 'APPROVE',
    body: 'ok',
    issues: [],
    confidence: 'high',
    ...overrides,
  });

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

  it('APPROVE com confidence low e apenas issue low => COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          confidence: 'low',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('COMMENT');
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

  it('REQUEST_CHANGES sem issues obrigatórias vira COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'REQUEST_CHANGES',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('COMMENT');
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
  }) => {
    const reviewSummary = options?.pullRequestSummary ?? pullRequestSummary;
    const reviewFiles = options?.changedFiles ?? changedFiles;
    const reviewPublication = options?.publishedReview ?? publishedReview;
    const gitHubServiceMock: jest.Mocked<
      Pick<
        GitHubService,
        'getPullRequestSummary' | 'listPullRequestFiles' | 'publishReview'
      >
    > = {
      getPullRequestSummary: jest.fn().mockResolvedValue(reviewSummary),
      listPullRequestFiles: jest.fn().mockResolvedValue(reviewFiles),
      publishReview: jest.fn().mockResolvedValue(reviewPublication),
    };
    const claudeCliServiceMock: jest.Mocked<
      Pick<ClaudeCliService, 'runReview'>
    > = {
      runReview: jest.fn(),
    };
    const ollamaServiceMock: jest.Mocked<Pick<OllamaService, 'runReview'>> = {
      runReview: jest.fn(),
    };

    const prReviewService = new PrReviewService(
      gitHubServiceMock as unknown as GitHubService,
      claudeCliServiceMock as unknown as ClaudeCliService,
      ollamaServiceMock as unknown as OllamaService,
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
    const ollamaReview: ClaudeReview = {
      decision: 'COMMENT',
      body: 'Fallback local executado',
      issues: [],
      confidence: 'medium',
    };

    claudeCliServiceMock.runReview.mockRejectedValue(
      new InternalServerErrorException("you've hit limit"),
    );
    ollamaServiceMock.runReview.mockResolvedValue(ollamaReview);

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      'Fallback local executado',
      'COMMENT',
      'notro',
    );
    expect(result.review).toEqual(publishedReview);
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

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      body: 'A implementação parece segura.',
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.stringContaining('PR está sem descrição'),
      'REQUEST_CHANGES',
      'notro',
    );
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

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      body: 'A implementação parece consistente, mas vale acompanhar a estabilidade em produção.',
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.stringContaining(
        'sem trazer testes automatizados para validar os cenários alterados',
      ),
      'REQUEST_CHANGES',
      'notro',
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

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      body: 'A implementação está sólida e os testes cobrem os cenários relevantes.',
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      'A implementação está sólida e os testes cobrem os cenários relevantes.',
      'APPROVE',
      'notro',
    );
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

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'APPROVE',
      body: 'A mudança parece segura para merge.',
      issues: [],
      confidence: 'high',
    });

    const result = await prReviewService.reviewPullRequest(
      'https://github.com/acme/webapp/pull/42',
    );

    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'webapp',
      42,
      'A mudança parece segura para merge.',
      'APPROVE',
      'notro',
    );
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
    expect(ollamaServiceMock.runReview).toHaveBeenCalledTimes(1);
    expect(gitHubServiceMock.publishReview).not.toHaveBeenCalled();
  });

  it('retorna o evento realmente publicado pelo GitHub', async () => {
    const { prReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService();

    claudeCliServiceMock.runReview.mockResolvedValue({
      decision: 'REQUEST_CHANGES',
      body: 'Há um problema importante',
      issues: [{ severity: 'high', file: 'src/app.ts', reason: 'bug' }],
      confidence: 'high',
    });
    gitHubServiceMock.publishReview.mockResolvedValue({
      ...publishedReview,
      event: 'COMMENT',
    });

    const result = await prReviewService.reviewPullRequest(pullRequestUrl);

    expect(result.event).toBe('COMMENT');
    expect(result.review.event).toBe('COMMENT');
  });
});
