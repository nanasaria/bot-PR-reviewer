import { InternalServerErrorException } from '@nestjs/common';
import type { GitHubPublishedReview } from '../../github/models/github-pull-request.model';
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
  const pullRequestSummary = {
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
  const changedFiles = [
    {
      filename: 'src/app.ts',
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
  };

  const buildService = () => {
    const gitHubServiceMock: jest.Mocked<
      Pick<
        GitHubService,
        'getPullRequestSummary' | 'listPullRequestFiles' | 'publishReview'
      >
    > = {
      getPullRequestSummary: jest.fn().mockResolvedValue(pullRequestSummary),
      listPullRequestFiles: jest.fn().mockResolvedValue(changedFiles),
      publishReview: jest.fn().mockResolvedValue(publishedReview),
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
    );
    expect(result.review).toEqual(publishedReview);
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
});
