import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { isClaudeUsageLimitError } from '../../claude-cli/utils/claude-limit-error.util';
import { GitHubService } from '../../github/services/github.service';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import { OllamaService } from '../../ollama/services/ollama.service';
import type { ClaudeIssue, ClaudeReview } from '../models/claude-review.model';
import {
  parsePullRequestUrl,
  type GitHubPullRequestReference,
} from '../models/pull-request-reference.model';
import type { PullRequestReviewPromptModel } from '../models/pull-request-review-prompt.model';
import type { ReviewOutcomeModel } from '../models/review-outcome.model';
import { buildPullRequestReviewPrompt } from '../utils/review-prompt.util';

@Injectable()
export class PrReviewService {
  private readonly logger = new Logger(PrReviewService.name);

  constructor(
    private readonly gitHubService: GitHubService,
    private readonly claudeCliService: ClaudeCliService,
    private readonly ollamaService: OllamaService,
  ) {}

  async reviewPullRequest(pullRequestUrl: string): Promise<ReviewOutcomeModel> {
    const pullRequestReference =
      this.parsePullRequestUrlOrThrow(pullRequestUrl);
    const { owner, repositoryName, pullRequestNumber } = pullRequestReference;

    this.logger.log(
      `Analisando PR ${owner}/${repositoryName}#${pullRequestNumber}`,
    );

    const [pullRequestSummary, changedFiles] = await Promise.all([
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
    ]);

    if (changedFiles.length === 0) {
      throw new BadRequestException(
        'O PR não possui arquivos alterados para analisar.',
      );
    }

    const reviewPrompt = this.buildReviewPrompt({
      repositoryOwner: owner,
      repositoryName,
      pullRequestNumber,
      pullRequestSummary,
      changedFiles,
    });
    const claudeReview = await this.runReviewWithFallback(reviewPrompt);

    const reviewEvent = this.determineReviewEvent(claudeReview);
    const reviewBody = this.buildPublishedReviewBody(claudeReview);

    const publishedReview = await this.gitHubService.publishReview(
      owner,
      repositoryName,
      pullRequestNumber,
      reviewBody,
      reviewEvent,
    );

    return {
      prUrl: pullRequestUrl,
      event: publishedReview.event,
      body: reviewBody,
      confidence: claudeReview.confidence,
      issues: claudeReview.issues,
      review: publishedReview,
    };
  }

  determineReviewEvent(claudeReview: ClaudeReview): PullRequestReviewEvent {
    const hasHighSeverityIssue = this.hasIssueWithSeverity(
      claudeReview,
      'high',
    );
    const hasBlockingIssue = this.hasBlockingIssue(claudeReview);

    if (hasHighSeverityIssue) {
      return 'REQUEST_CHANGES';
    }

    switch (claudeReview.decision) {
      case 'REQUEST_CHANGES':
        return hasBlockingIssue ? 'REQUEST_CHANGES' : 'COMMENT';

      case 'APPROVE':
        if (hasBlockingIssue) return 'REQUEST_CHANGES';
        if (claudeReview.confidence === 'low') return 'COMMENT';
        return 'APPROVE';

      case 'COMMENT':
        return hasBlockingIssue ? 'REQUEST_CHANGES' : 'COMMENT';
    }
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

  private buildReviewPrompt(
    reviewContext: PullRequestReviewPromptModel,
  ): string {
    return buildPullRequestReviewPrompt(reviewContext);
  }

  private async runReviewWithFallback(
    reviewPrompt: string,
  ): Promise<ClaudeReview> {
    try {
      return await this.claudeCliService.runReview(reviewPrompt);
    } catch (claudeError) {
      if (!isClaudeUsageLimitError(claudeError)) {
        throw claudeError;
      }

      this.logger.warn(
        'Claude CLI atingiu o limite de uso. Tentando fallback local via Ollama.',
      );

      try {
        return await this.ollamaService.runReview(reviewPrompt);
      } catch (ollamaError) {
        throw new InternalServerErrorException(
          `Claude CLI atingiu o limite de uso e o fallback Ollama falhou. Claude: ${getErrorMessage(
            claudeError,
          )}. Ollama: ${getErrorMessage(ollamaError)}`,
        );
      }
    }
  }

  private buildPublishedReviewBody(claudeReview: ClaudeReview): string {
    const trimmedReviewBody = claudeReview.body.trim();

    if (claudeReview.issues.length === 0) {
      return trimmedReviewBody;
    }

    const formattedIssues = claudeReview.issues
      .map((issue) => this.formatIssueSummary(issue))
      .join('\n');

    return `${trimmedReviewBody}\n\n**Pontos identificados:**\n${formattedIssues}`;
  }

  private hasBlockingIssue(claudeReview: ClaudeReview): boolean {
    return claudeReview.issues.some(
      (issue) => issue.severity === 'high' || issue.severity === 'medium',
    );
  }

  private hasIssueWithSeverity(
    claudeReview: ClaudeReview,
    severity: ClaudeIssue['severity'],
  ): boolean {
    return claudeReview.issues.some((issue) => issue.severity === severity);
  }

  private formatIssueSummary(issue: ClaudeIssue): string {
    return `- [${issue.severity.toUpperCase()}] ${issue.file}: ${issue.reason}`;
  }
}
