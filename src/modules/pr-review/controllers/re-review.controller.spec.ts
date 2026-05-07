import type { ReReviewOutcomeModel } from '../models/re-review-outcome.model';
import { ReReviewController } from './re-review.controller';

describe('ReReviewController', () => {
  it('delegates the request to ReReviewService', async () => {
    const reReviewOutcome: ReReviewOutcomeModel = {
      prUrl: 'https://github.com/acme/widgets/pull/42',
      event: 'COMMENT',
      body: 'Re-review publicado',
      confidence: 'medium',
      reReview: {
        analyzed: 0,
        corrigido: 0,
        parcialmente_corrigido: 0,
        nao_corrigido: 0,
        nao_aplicavel: 0,
        impossivel_validar: 0,
      },
      review: {
        id: 202,
        htmlUrl:
          'https://github.com/acme/widgets/pull/42#pullrequestreview-202',
        event: 'COMMENT',
      },
    };
    const reReviewServiceMock = {
      reReviewPullRequest: jest.fn().mockResolvedValue(reReviewOutcome),
    };
    const controller = new ReReviewController(reReviewServiceMock as never);

    const result = await controller.reReview({
      prUrl: 'https://github.com/acme/widgets/pull/42',
    });

    expect(reReviewServiceMock.reReviewPullRequest).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
    );
    expect(result).toEqual(reReviewOutcome);
  });
});
