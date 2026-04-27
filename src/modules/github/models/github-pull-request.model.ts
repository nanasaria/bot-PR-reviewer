import type { PullRequestReviewEvent } from './review-event.model';

export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
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

export interface GitHubPullRequestComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface GitHubPullRequestReviewComment {
  id: number;
  author: string;
  body: string;
  filePath: string;
  line: number | null;
  originalLine: number | null;
  position: number | null;
  originalPosition: number | null;
  diffHunk: string | null;
  inReplyToId: number | null;
  pullRequestReviewId: number | null;
  createdAt: string;
}

export interface GitHubPullRequestReview {
  id: number;
  author: string;
  body: string;
  state: string;
  submittedAt: string | null;
}

export interface GitHubPublishedReview {
  id: number;
  htmlUrl: string;
  event: PullRequestReviewEvent;
}
