import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ReviewPrRequestModel } from '../models/review-pr-request.model';
import type { ReviewOutcomeModel } from '../models/review-outcome.model';
import { PrReviewService } from '../services/pr-review.service';

@Controller('pr-review')
export class PrReviewController {
  constructor(private readonly prReviewService: PrReviewService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async review(
    @Body() reviewPrRequestModel: ReviewPrRequestModel,
  ): Promise<ReviewOutcomeModel> {
    return this.prReviewService.reviewPullRequest(reviewPrRequestModel.prUrl);
  }
}
