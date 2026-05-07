import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
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
import { ReReviewService } from './re-review.service';
import type { ReReview } from '../models/re-review.model';

describe('ReReviewService.reReviewPullRequest', () => {
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
      Pick<ClaudeCliService, 'runReReview'>
    > = {
      runReReview: jest.fn(),
    };
    const ollamaServiceMock: jest.Mocked<
      Pick<OllamaService, 'prepareForRequests' | 'runReReview'>
    > = {
      prepareForRequests: jest.fn().mockResolvedValue(undefined),
      runReReview: jest.fn(),
    };
    const configServiceMock = {
      get: jest.fn((key: string) =>
        key === 'REVIEWER_LOGIN' ? options.reviewerLogin : undefined,
      ),
    } as unknown as ConfigService;

    const reReviewService = new ReReviewService(
      gitHubServiceMock as unknown as GitHubService,
      claudeCliServiceMock as unknown as ClaudeCliService,
      ollamaServiceMock as unknown as OllamaService,
      configServiceMock,
    );

    return {
      reReviewService,
      gitHubServiceMock,
      claudeCliServiceMock,
      ollamaServiceMock,
    };
  };

  it('falha com BadRequest quando REVIEWER_LOGIN não está configurado', async () => {
    const { reReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService();

    await expect(
      reReviewService.reReviewPullRequest(pullRequestUrl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gitHubServiceMock.publishReview).not.toHaveBeenCalled();
    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
  });

  it('falha com BadRequest quando não há comentários do reviewer configurado', async () => {
    const { reReviewService, gitHubServiceMock, claudeCliServiceMock } =
      buildService({ reviewerLogin: 'reviewer-bot' });

    await expect(
      reReviewService.reReviewPullRequest(pullRequestUrl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
    expect(gitHubServiceMock.publishReview).not.toHaveBeenCalled();
  });

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
    const { reReviewService, gitHubServiceMock, claudeCliServiceMock } =
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

    const result = await reReviewService.reReviewPullRequest(pullRequestUrl);

    expect(claudeCliServiceMock.runReReview).toHaveBeenCalledTimes(1);
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
    const { reReviewService, gitHubServiceMock, claudeCliServiceMock } =
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

    const result = await reReviewService.reReviewPullRequest(pullRequestUrl);

    expect(result.event).toBe('APPROVE');
    expect(result.reReview.corrigido).toBe(1);
    expect(gitHubServiceMock.publishReview).toHaveBeenCalledWith(
      'acme',
      'widgets',
      42,
      expect.any(String),
      'APPROVE',
      'notro',
    );
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
    const { reReviewService, claudeCliServiceMock, ollamaServiceMock } =
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

    const result = await reReviewService.reReviewPullRequest(pullRequestUrl);

    expect(ollamaServiceMock.prepareForRequests).toHaveBeenCalledTimes(1);
    expect(ollamaServiceMock.runReReview).toHaveBeenCalledTimes(1);
    expect(result.event).toBe('REQUEST_CHANGES');
    expect(result.reReview.parcialmente_corrigido).toBe(1);
  });

  it('ignora comentários de outros usuários e falha por falta de comentários do reviewer', async () => {
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
    const { reReviewService, claudeCliServiceMock } = buildService({
      reviewerLogin: 'reviewer-bot',
      reviewComments,
    });

    await expect(
      reReviewService.reReviewPullRequest(pullRequestUrl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
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
    const { reReviewService, claudeCliServiceMock } = buildService({
      reviewerLogin: 'reviewer-bot',
      reviews,
    });

    await expect(
      reReviewService.reReviewPullRequest(pullRequestUrl),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claudeCliServiceMock.runReReview).not.toHaveBeenCalled();
  });
});

describe('ReReviewService.determineReReviewEvent', () => {
  const reReviewService = Object.create(
    ReReviewService.prototype,
  ) as ReReviewService;

  it('sem itens analisados retorna COMMENT', () => {
    expect(
      reReviewService.determineReReviewEvent({
        analyzed: 0,
        corrigido: 0,
        parcialmente_corrigido: 0,
        nao_corrigido: 0,
        nao_aplicavel: 0,
        impossivel_validar: 0,
      }),
    ).toBe('COMMENT');
  });

  it('com itens não corrigidos retorna REQUEST_CHANGES', () => {
    expect(
      reReviewService.determineReReviewEvent({
        analyzed: 2,
        corrigido: 1,
        parcialmente_corrigido: 0,
        nao_corrigido: 1,
        nao_aplicavel: 0,
        impossivel_validar: 0,
      }),
    ).toBe('REQUEST_CHANGES');
  });

  it('com tudo corrigido retorna APPROVE', () => {
    expect(
      reReviewService.determineReReviewEvent({
        analyzed: 1,
        corrigido: 1,
        parcialmente_corrigido: 0,
        nao_corrigido: 0,
        nao_aplicavel: 0,
        impossivel_validar: 0,
      }),
    ).toBe('APPROVE');
  });

  it('com itens impossíveis de validar retorna COMMENT', () => {
    expect(
      reReviewService.determineReReviewEvent({
        analyzed: 1,
        corrigido: 0,
        parcialmente_corrigido: 0,
        nao_corrigido: 0,
        nao_aplicavel: 0,
        impossivel_validar: 1,
      }),
    ).toBe('COMMENT');
  });
});
