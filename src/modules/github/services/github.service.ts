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

const SELF_REVIEW_APPROVE_PATTERNS = [
  /review can(?:not|\s+not)? approve your own pull request/i,
  /cannot approve your own pull request/i,
  /can not approve your own pull request/i,
];
const SELF_REVIEW_REQUEST_CHANGES_PATTERNS = [
  /review can(?:not|\s+not)? request changes on your own pull request/i,
  /cannot request changes on your own pull request/i,
  /can not request changes on your own pull request/i,
];
const SELF_REVIEW_ACTION_PATTERNS: Record<
  Exclude<PullRequestReviewEvent, 'COMMENT'>,
  RegExp
> = {
  APPROVE: /approve/i,
  REQUEST_CHANGES: /request changes/i,
};
const OWN_PULL_REQUEST_PATTERN = /(your|own)\s+pull request/i;

type OwnPullRequestStatus = 'yes' | 'no' | 'unknown';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly octokit: Octokit;
  private authenticatedUserLoginPromise?: Promise<string>;

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
    pullRequestAuthor?: string,
  ): Promise<GitHubPublishedReview> {
    try {
      const { reviewEvent: publishedReviewEvent, reviewData } =
        await this.createReviewWithFallbackForOwnPullRequest(
          repositoryOwner,
          repositoryName,
          pullRequestNumber,
          reviewBody,
          reviewEvent,
          pullRequestAuthor,
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
    pullRequestAuthor?: string,
  ) {
    const { effectiveReviewEvent, ownPullRequestStatus } =
      await this.resolveSelfReviewContext(
        repositoryOwner,
        repositoryName,
        pullRequestNumber,
        reviewEvent,
        pullRequestAuthor,
      );

    try {
      const { data } = await this.octokit.pulls.createReview({
        owner: repositoryOwner,
        repo: repositoryName,
        pull_number: pullRequestNumber,
        body: reviewBody,
        event: effectiveReviewEvent,
      });

      return {
        reviewEvent: effectiveReviewEvent,
        reviewData: data,
      };
    } catch (error) {
      if (
        this.shouldDowngradeSelfReviewToComment(
          error,
          effectiveReviewEvent,
          ownPullRequestStatus,
        )
      ) {
        this.logger.warn(
          `GitHub não permite ${effectiveReviewEvent} no próprio PR. Publicando COMMENT em ${repositoryOwner}/${repositoryName}#${pullRequestNumber}.`,
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

  private async resolveSelfReviewContext(
    repositoryOwner: string,
    repositoryName: string,
    pullRequestNumber: number,
    reviewEvent: PullRequestReviewEvent,
    pullRequestAuthor?: string,
  ): Promise<{
    effectiveReviewEvent: PullRequestReviewEvent;
    ownPullRequestStatus: OwnPullRequestStatus;
  }> {
    if (reviewEvent === 'COMMENT' || !pullRequestAuthor?.trim()) {
      return {
        effectiveReviewEvent: reviewEvent,
        ownPullRequestStatus: 'unknown',
      };
    }

    try {
      const authenticatedUserLogin = await this.getAuthenticatedUserLogin();
      if (!this.isSameGitHubUser(authenticatedUserLogin, pullRequestAuthor)) {
        return {
          effectiveReviewEvent: reviewEvent,
          ownPullRequestStatus: 'no',
        };
      }

      this.logger.warn(
        `PR próprio detectado antes da publicação. Rebaixando ${reviewEvent} para COMMENT em ${repositoryOwner}/${repositoryName}#${pullRequestNumber}.`,
      );
      return {
        effectiveReviewEvent: 'COMMENT',
        ownPullRequestStatus: 'yes',
      };
    } catch (error) {
      this.logger.warn(
        `Não foi possível validar se ${repositoryOwner}/${repositoryName}#${pullRequestNumber} é um PR próprio antes da publicação. Mantendo ${reviewEvent}. Motivo: ${getErrorMessage(
          error,
        )}`,
      );
      return {
        effectiveReviewEvent: reviewEvent,
        ownPullRequestStatus: 'unknown',
      };
    }
  }

  private getAuthenticatedUserLogin(): Promise<string> {
    if (!this.authenticatedUserLoginPromise) {
      this.authenticatedUserLoginPromise = this.octokit.users
        .getAuthenticated()
        .then(({ data }) => {
          const authenticatedUserLogin = data.login?.trim();

          if (!authenticatedUserLogin) {
            throw new Error(
              'GitHub não retornou o login do usuário autenticado.',
            );
          }

          return authenticatedUserLogin;
        })
        .catch((error) => {
          this.authenticatedUserLoginPromise = undefined;
          throw error;
        });
    }

    return this.authenticatedUserLoginPromise;
  }

  private isSameGitHubUser(leftUserLogin: string, rightUserLogin: string) {
    return (
      leftUserLogin.trim().toLowerCase() === rightUserLogin.trim().toLowerCase()
    );
  }

  private shouldDowngradeSelfReviewToComment(
    error: unknown,
    reviewEvent: PullRequestReviewEvent,
    ownPullRequestStatus: OwnPullRequestStatus,
  ): boolean {
    if (reviewEvent === 'COMMENT') {
      return false;
    }

    const errorStatus = this.extractGitHubErrorStatus(error);
    if (errorStatus !== 422) {
      return false;
    }

    if (ownPullRequestStatus === 'yes') {
      return true;
    }

    if (ownPullRequestStatus === 'no') {
      return false;
    }

    return this.extractGitHubErrorDetails(error).some((errorDetail) => {
      if (
        this.getSelfReviewPatterns(reviewEvent).some((pattern) =>
          pattern.test(errorDetail),
        )
      ) {
        return true;
      }

      return (
        SELF_REVIEW_ACTION_PATTERNS[reviewEvent].test(errorDetail) &&
        OWN_PULL_REQUEST_PATTERN.test(errorDetail)
      );
    });
  }

  private getSelfReviewPatterns(
    reviewEvent: Exclude<PullRequestReviewEvent, 'COMMENT'>,
  ): RegExp[] {
    switch (reviewEvent) {
      case 'APPROVE':
        return SELF_REVIEW_APPROVE_PATTERNS;
      case 'REQUEST_CHANGES':
        return SELF_REVIEW_REQUEST_CHANGES_PATTERNS;
    }
  }

  private extractGitHubErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
      return undefined;
    }

    const { status } = error as { status?: unknown };
    return typeof status === 'number' ? status : undefined;
  }

  private extractGitHubErrorDetails(error: unknown): string[] {
    const errorDetails = new Set<string>([getErrorMessage(error)]);

    if (typeof error !== 'object' || error === null || !('response' in error)) {
      return [...errorDetails];
    }

    const response = (error as { response?: { data?: unknown } }).response;
    const responseData = response?.data;

    if (typeof responseData === 'string') {
      errorDetails.add(responseData);
      return [...errorDetails];
    }

    if (typeof responseData !== 'object' || responseData === null) {
      return [...errorDetails];
    }

    const responseMessage = (responseData as { message?: unknown }).message;
    if (typeof responseMessage === 'string') {
      errorDetails.add(responseMessage);
    }

    const responseErrors = (responseData as { errors?: unknown }).errors;
    if (Array.isArray(responseErrors)) {
      responseErrors.forEach((responseError) => {
        if (typeof responseError === 'string') {
          errorDetails.add(responseError);
          return;
        }

        if (typeof responseError !== 'object' || responseError === null) {
          return;
        }

        const errorMessage = (responseError as { message?: unknown }).message;
        if (typeof errorMessage === 'string') {
          errorDetails.add(errorMessage);
        }

        const errorCode = (responseError as { code?: unknown }).code;
        if (typeof errorCode === 'string') {
          errorDetails.add(errorCode);
        }
      });
    }

    return [...errorDetails];
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
