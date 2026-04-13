import type {
  GitHubPullRequestFile,
  GitHubPullRequestSummary,
} from '../../github/models/github-pull-request.model';

export interface PullRequestReviewPromptModel {
  repositoryOwner: string;
  repositoryName: string;
  pullRequestNumber: number;
  pullRequestSummary: GitHubPullRequestSummary;
  changedFiles: GitHubPullRequestFile[];
}
