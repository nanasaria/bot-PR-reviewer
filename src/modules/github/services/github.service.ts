import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import type {
  GitHubPublishedReview,
  GitHubPullRequestFile,
  GitHubPullRequestSummary,
} from '../models/github-pull-request.model';
import type { PullRequestReviewEvent } from '../models/review-event.model';

const OWN_PULL_REQUEST_REVIEW_ERROR_MESSAGE =
  'Review Can not request changes on your own pull request';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly octokit: Octokit;

  constructor(private readonly configService: ConfigService) {
    const githubToken = this.configService.get<string>('GITHUB_TOKEN');
    const githubApiBaseUrl = this.configService.get<string>(
      'GITHUB_API_BASE_URL',
    );

    this.octokit = new Octokit({
      auth: githubToken,
      baseUrl: githubApiBaseUrl,
    });
  }

  async getPullRequestSummary(
    repositoryOwner: string,
    repositoryName: string,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestSummary> {
    try {
      const { data: pullRequestData } = await this.octokit.pulls.get({
        owner: repositoryOwner,
        repo: repositoryName,
        pull_number: pullRequestNumber,
      });

      return {
        title: pullRequestData.title,
        body: pullRequestData.body,
        author: pullRequestData.user?.login ?? 'desconhecido',
        baseRef: pullRequestData.base.ref,
        headRef: pullRequestData.head.ref,
        state: pullRequestData.state,
        draft: Boolean(pullRequestData.draft),
        changedFiles: pullRequestData.changed_files,
        additions: pullRequestData.additions,
        deletions: pullRequestData.deletions,
      };
    } catch (error) {
      this.throwGitHubOperationError(
        `Falha ao buscar PR ${repositoryOwner}/${repositoryName}#${pullRequestNumber}`,
        'Não foi possível buscar o PR no GitHub',
        error,
      );
    }
  }

  async listPullRequestFiles(
    repositoryOwner: string,
    repositoryName: string,
    pullRequestNumber: number,
  ): Promise<GitHubPullRequestFile[]> {
    try {
      const pullRequestFiles = await this.octokit.paginate(
        this.octokit.pulls.listFiles,
        {
          owner: repositoryOwner,
          repo: repositoryName,
          pull_number: pullRequestNumber,
          per_page: 100,
        },
      );

      return pullRequestFiles.map((pullRequestFile) => ({
        filename: pullRequestFile.filename,
        status: pullRequestFile.status,
        additions: pullRequestFile.additions,
        deletions: pullRequestFile.deletions,
        changes: pullRequestFile.changes,
        patch: pullRequestFile.patch,
      }));
    } catch (error) {
      this.throwGitHubOperationError(
        `Falha ao buscar arquivos do PR ${repositoryOwner}/${repositoryName}#${pullRequestNumber}`,
        'Não foi possível buscar os arquivos do PR',
        error,
      );
    }
  }

  async publishReview(
    repositoryOwner: string,
    repositoryName: string,
    pullRequestNumber: number,
    reviewBody: string,
    reviewEvent: PullRequestReviewEvent,
  ): Promise<GitHubPublishedReview> {
    try {
      const { reviewEvent: publishedReviewEvent, reviewData } =
        await this.createReviewWithFallbackForOwnPullRequest(
          repositoryOwner,
          repositoryName,
          pullRequestNumber,
          reviewBody,
          reviewEvent,
        );

      return {
        id: reviewData.id,
        htmlUrl: reviewData.html_url,
        event: publishedReviewEvent,
      };
    } catch (error) {
      this.throwGitHubOperationError(
        `Falha ao publicar review em ${repositoryOwner}/${repositoryName}#${pullRequestNumber}`,
        'Não foi possível publicar a review',
        error,
      );
    }
  }

  private async createReviewWithFallbackForOwnPullRequest(
    repositoryOwner: string,
    repositoryName: string,
    pullRequestNumber: number,
    reviewBody: string,
    reviewEvent: PullRequestReviewEvent,
  ) {
    try {
      const { data } = await this.octokit.pulls.createReview({
        owner: repositoryOwner,
        repo: repositoryName,
        pull_number: pullRequestNumber,
        body: reviewBody,
        event: reviewEvent,
      });

      return {
        reviewEvent,
        reviewData: data,
      };
    } catch (error) {
      if (this.shouldDowngradeSelfReviewToComment(error, reviewEvent)) {
        this.logger.warn(
          `GitHub não permite REQUEST_CHANGES no próprio PR. Publicando COMMENT em ${repositoryOwner}/${repositoryName}#${pullRequestNumber}.`,
        );

        const { data } = await this.octokit.pulls.createReview({
          owner: repositoryOwner,
          repo: repositoryName,
          pull_number: pullRequestNumber,
          body: reviewBody,
          event: 'COMMENT',
        });

        return {
          reviewEvent: 'COMMENT' as const,
          reviewData: data,
        };
      }

      throw error;
    }
  }

  private shouldDowngradeSelfReviewToComment(
    error: unknown,
    reviewEvent: PullRequestReviewEvent,
  ): boolean {
    if (reviewEvent !== 'REQUEST_CHANGES') {
      return false;
    }

    return getErrorMessage(error).includes(
      OWN_PULL_REQUEST_REVIEW_ERROR_MESSAGE,
    );
  }

  private throwGitHubOperationError(
    logMessage: string,
    userMessage: string,
    error: unknown,
  ): never {
    const errorMessage = getErrorMessage(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    this.logger.error(`${logMessage}: ${errorMessage}`, errorStack);
    throw new InternalServerErrorException(`${userMessage}: ${errorMessage}`);
  }
}
