import type { ReviewOutcomeModel } from '../models/review-outcome.model';
import { PrReviewController } from './pr-review.controller';

describe('PrReviewController', () => {
  it('delegates the request to PrReviewService', async () => {
    const reviewOutcome: ReviewOutcomeModel = {
      prUrl: 'https://github.com/acme/widgets/pull/42',
      event: 'COMMENT',
      body: 'Review publicada',
      confidence: 'medium',
      issues: [],
      review: {
        id: 101,
        htmlUrl:
          'https://github.com/acme/widgets/pull/42#pullrequestreview-101',
      },
    };
    const prReviewServiceMock = {
      reviewPullRequest: jest.fn().mockResolvedValue(reviewOutcome),
    };
    const controller = new PrReviewController(prReviewServiceMock as never);

    const result = await controller.review({
      prUrl: 'https://github.com/acme/widgets/pull/42',
    });

    expect(prReviewServiceMock.reviewPullRequest).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
    );
    expect(result).toEqual(reviewOutcome);
  });
});
