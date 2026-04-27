import type { GitHubPublishedReview } from '../../github/models/github-pull-request.model';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import type { ClaudeIssue, ClaudeReview } from './claude-review.model';
import type { ReReviewSummaryCounts } from './re-review.model';
import type { ReviewModeModel } from './review-mode.model';

export interface ReviewOutcomeModel {
  prUrl: string;
  mode: ReviewModeModel;
  event: PullRequestReviewEvent;
  body: string;
  confidence: ClaudeReview['confidence'];
  issues: ClaudeIssue[];
  reReview?: ReReviewSummaryCounts;
  review: GitHubPublishedReview;
}
