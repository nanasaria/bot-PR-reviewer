import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { GitHubService } from '../../github/services/github.service';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import type { ClaudeIssue, ClaudeReview } from '../models/claude-review.model';
import {
  parsePullRequestUrl,
  type GitHubPullRequestReference,
} from '../models/pull-request-reference.model';
import type { ReviewOutcomeModel } from '../models/review-outcome.model';

@Injectable()
export class PrReviewService {
  private readonly logger = new Logger(PrReviewService.name);

  constructor(
    private readonly gitHubService: GitHubService,
    private readonly claudeCliService: ClaudeCliService,
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

    const reviewPrompt = this.claudeCliService.buildPrompt({
      repositoryOwner: owner,
      repositoryName,
      pullRequestNumber,
      pullRequestSummary,
      changedFiles,
    });
    const claudeReview = await this.claudeCliService.runReview(reviewPrompt);

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
      event: reviewEvent,
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
