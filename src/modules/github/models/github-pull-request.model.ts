export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubPullRequestSummary {
  title: string;
  body: string | null;
  author: string;
  baseRef: string;
  headRef: string;
  state: string;
  draft: boolean;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface GitHubPublishedReview {
  id: number;
  htmlUrl: string;
}
