import { ApiProperty } from '@nestjs/swagger';
import type { GitHubPublishedReview } from '../../github/models/github-pull-request.model';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';

export class PublishedReviewResponse implements GitHubPublishedReview {
  @ApiProperty({
    description: 'Identificador da review no GitHub.',
    example: 1234567,
  })
  id!: number;

  @ApiProperty({
    description: 'URL pública da review publicada.',
    example: 'https://github.com/owner/repo/pull/123#pullrequestreview-1234567',
  })
  htmlUrl!: string;

  @ApiProperty({
    description: 'Evento efetivamente publicado pelo GitHub.',
    enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
    example: 'COMMENT',
  })
  event!: PullRequestReviewEvent;
}
