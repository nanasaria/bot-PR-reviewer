import type { GitHubPublishedReview } from '../../github/models/github-pull-request.model';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import type { ClaudeReview } from './claude-review.model';

export interface ReviewOutcomeModel {
  prUrl: string;
  event: PullRequestReviewEvent;
  body: string;
  confidence: ClaudeReview['confidence'];
  issues: ClaudeReview['issues'];
  review: GitHubPublishedReview;
}
