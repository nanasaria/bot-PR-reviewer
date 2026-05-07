import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { isClaudeUsageLimitError } from '../../claude-cli/utils/claude-limit-error.util';
import { GitHubService } from '../../github/services/github.service';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import type {
  GitHubPullRequestComment,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment,
} from '../../github/models/github-pull-request.model';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import { OllamaService } from '../../ollama/services/ollama.service';
import {
  parsePullRequestUrl,
  type GitHubPullRequestReference,
} from '../models/pull-request-reference.model';
import type { ReReviewOutcomeModel } from '../models/re-review-outcome.model';
import type { ReviewerCommentModel } from '../models/reviewer-comment.model';
import {
  summarizeReReviewItems,
  type ReReview,
  type ReReviewItem,
  type ReReviewSummaryCounts,
} from '../models/re-review.model';
import { buildReReviewPrompt } from '../utils/re-review-prompt.util';
import { collectReviewerComments } from '../utils/reviewer-comments.util';

@Injectable()
export class ReReviewService {
  private readonly logger = new Logger(ReReviewService.name);

  constructor(
    private readonly gitHubService: GitHubService,
    private readonly claudeCliService: ClaudeCliService,
    private readonly ollamaService: OllamaService,
    private readonly configService: ConfigService,
  ) {}

  async reReviewPullRequest(
    pullRequestUrl: string,
  ): Promise<ReReviewOutcomeModel> {
    const pullRequestReference =
      this.parsePullRequestUrlOrThrow(pullRequestUrl);
    const { owner, repositoryName, pullRequestNumber } = pullRequestReference;

    const reviewerLogin = this.resolveReviewerLogin();
    if (!reviewerLogin) {
      throw new BadRequestException(
        'REVIEWER_LOGIN não está configurado. Defina o reviewer antes de executar o re-review.',
      );
    }

    this.logger.log(
      `Re-revisando PR ${owner}/${repositoryName}#${pullRequestNumber} para o reviewer "${reviewerLogin}"`,
    );

    const [pullRequestSummary, changedFiles, issueComments] = await Promise.all(
      [
        this.gitHubService.getPullRequestSummary(
          owner,
          repositoryName,
          pullRequestNumber,
        ),
        this.gitHubService.listPullRequestFiles(
          owner,
          repositoryName,
          pullRequestNumber,
        ),
        this.gitHubService.listPullRequestComments(
          owner,
          repositoryName,
          pullRequestNumber,
        ),
      ],
    );

    if (changedFiles.length === 0) {
      throw new BadRequestException(
        'O PR não possui arquivos alterados para analisar.',
      );
    }

    const reviewerComments = await this.fetchReviewerComments(
      owner,
      repositoryName,
      pullRequestNumber,
      reviewerLogin,
      issueComments,
    );

    if (reviewerComments.length === 0) {
      throw new BadRequestException(
        `Não há comentários anteriores válidos do reviewer "${reviewerLogin}" para re-revisar.`,
      );
    }

    this.logger.log(
      `Re-review com ${reviewerComments.length} comentário(s) anterior(es) do reviewer "${reviewerLogin}".`,
    );

    const reReviewPrompt = buildReReviewPrompt({
      repositoryOwner: owner,
      repositoryName,
      pullRequestNumber,
      pullRequestSummary,
      changedFiles,
      reviewerLogin,
      reviewerComments,
    });
    const reReview = await this.runReReviewWithFallback(reReviewPrompt);
    const summaryCounts = summarizeReReviewItems(reReview.items);
    const reviewEvent = this.determineReReviewEvent(summaryCounts);
    const reviewBody = this.buildPublishedReReviewBody(
      reReview,
      summaryCounts,
      reviewerLogin,
      reviewerComments.length,
    );

    this.logger.log(
      `Re-review concluído. Analisados=${summaryCounts.analyzed} corrigido=${summaryCounts.corrigido} parcial=${summaryCounts.parcialmente_corrigido} pendente=${summaryCounts.nao_corrigido} naoAplic=${summaryCounts.nao_aplicavel} naoValidado=${summaryCounts.impossivel_validar} -> evento=${reviewEvent}`,
    );

    const publishedReview = await this.gitHubService.publishReview(
      owner,
      repositoryName,
      pullRequestNumber,
      reviewBody,
      reviewEvent,
      pullRequestSummary.author,
    );

    return {
      prUrl: pullRequestUrl,
      event: publishedReview.event,
      body: reviewBody,
      confidence: reReview.confidence,
      reReview: summaryCounts,
      review: publishedReview,
    };
  }

  determineReReviewEvent(
    summaryCounts: ReReviewSummaryCounts,
  ): PullRequestReviewEvent {
    if (summaryCounts.analyzed === 0) {
      return 'COMMENT';
    }

    if (
      summaryCounts.nao_corrigido > 0 ||
      summaryCounts.parcialmente_corrigido > 0
    ) {
      return 'REQUEST_CHANGES';
    }

    if (summaryCounts.impossivel_validar > 0) {
      return 'COMMENT';
    }

    return 'APPROVE';
  }

  private async fetchReviewerComments(
    owner: string,
    repositoryName: string,
    pullRequestNumber: number,
    reviewerLogin: string,
    issueComments: GitHubPullRequestComment[],
  ): Promise<ReviewerCommentModel[]> {
    let reviewComments: GitHubPullRequestReviewComment[] = [];
    let reviews: GitHubPullRequestReview[] = [];

    try {
      [reviewComments, reviews] = await Promise.all([
        this.gitHubService.listPullRequestReviewComments(
          owner,
          repositoryName,
          pullRequestNumber,
        ),
        this.gitHubService.listPullRequestReviews(
          owner,
          repositoryName,
          pullRequestNumber,
        ),
      ]);
    } catch (error) {
      this.logger.warn(
        `Falha ao buscar histórico de comentários para re-review. Seguindo apenas com comentários gerais. Motivo: ${getErrorMessage(error)}`,
      );
    }

    return collectReviewerComments({
      reviewerLogin,
      reviewComments,
      issueComments,
      reviews,
    });
  }

  private resolveReviewerLogin(): string | null {
    const explicitReviewerLogin = this.configService
      .get<string>('REVIEWER_LOGIN')
      ?.trim();

    if (explicitReviewerLogin) {
      return explicitReviewerLogin;
    }

    return null;
  }

  private parsePullRequestUrlOrThrow(
    pullRequestUrl: string,
  ): GitHubPullRequestReference {
    try {
      return parsePullRequestUrl(pullRequestUrl);
    } catch (error) {
      throw new BadRequestException(getErrorMessage(error));
    }
  }

  private async runReReviewWithFallback(
    reReviewPrompt: string,
  ): Promise<ReReview> {
    try {
      return await this.claudeCliService.runReReview(reReviewPrompt);
    } catch (claudeError) {
      if (!isClaudeUsageLimitError(claudeError)) {
        throw claudeError;
      }

      this.logger.warn(
        'Claude CLI atingiu o limite de uso no re-review. Tentando fallback local via Ollama.',
      );

      try {
        await this.ollamaService.prepareForRequests();
        return await this.ollamaService.runReReview(reReviewPrompt);
      } catch (ollamaError) {
        throw new InternalServerErrorException(
          `Claude CLI atingiu o limite de uso e o fallback Ollama falhou no re-review. Claude: ${getErrorMessage(
            claudeError,
          )}. Ollama: ${getErrorMessage(ollamaError)}`,
        );
      }
    }
  }

  private buildPublishedReReviewBody(
    reReview: ReReview,
    summaryCounts: ReReviewSummaryCounts,
    reviewerLogin: string,
    originalCommentCount: number,
  ): string {
    const sections: string[] = [
      '## Re-review automatizada',
      '> Este comentário é um re-review automático: a análise abaixo verifica apenas se os comentários anteriores foram resolvidos.',
      `_Modo executado: re-review. Reviewer configurado: \`${reviewerLogin}\`._`,
      this.formatTextSection('Visão Geral', reReview.overview),
      this.formatReReviewSummarySection(summaryCounts, originalCommentCount),
    ];

    if (reReview.items.length > 0) {
      sections.push(this.formatReReviewItemsSection(reReview.items));
    } else {
      sections.push(
        '_Nenhum item retornado pelo modelo. Verifique manualmente os comentários anteriores._',
      );
    }

    return sections.join('\n\n');
  }

  private formatReReviewSummarySection(
    summaryCounts: ReReviewSummaryCounts,
    originalCommentCount: number,
  ): string {
    return [
      '**Resumo do Re-review**',
      `- Comentários anteriores analisados: ${summaryCounts.analyzed} (de ${originalCommentCount} coletado(s))`,
      `- Corrigidos: ${summaryCounts.corrigido}`,
      `- Parcialmente corrigidos: ${summaryCounts.parcialmente_corrigido}`,
      `- Ainda pendentes: ${summaryCounts.nao_corrigido}`,
      `- Não aplicáveis: ${summaryCounts.nao_aplicavel}`,
      `- Não foi possível validar: ${summaryCounts.impossivel_validar}`,
    ].join('\n');
  }

  private formatReReviewItemsSection(items: ReReviewItem[]): string {
    const formattedItems = items
      .map((item, index) =>
        [
          `### Item ${index + 1}`,
          `- **Comentário original:** ${this.truncateForBody(item.originalComment, 280)}`,
          `- **Arquivo:** \`${item.file}\``,
          `- **Status:** ${this.formatReReviewStatusLabel(item.status)}`,
          `- **Análise:** ${item.analysis.trim()}`,
          `- **Ação recomendada:** ${item.recommendedAction.trim()}`,
        ].join('\n'),
      )
      .join('\n\n');

    return `**Itens analisados**\n\n${formattedItems}`;
  }

  private formatReReviewStatusLabel(status: ReReviewItem['status']): string {
    switch (status) {
      case 'corrigido':
        return 'Corrigido';
      case 'parcialmente_corrigido':
        return 'Parcialmente corrigido';
      case 'nao_corrigido':
        return 'Não corrigido';
      case 'nao_aplicavel':
        return 'Não aplicável';
      case 'impossivel_validar':
        return 'Impossível validar';
    }
  }

  private formatTextSection(title: string, content: string): string {
    return `**${title}**\n${content.trim()}`;
  }

  private truncateForBody(value: string, maxLength: number): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 1)}…`;
  }
}
