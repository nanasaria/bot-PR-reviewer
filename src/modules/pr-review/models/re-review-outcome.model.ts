import { ApiProperty } from '@nestjs/swagger';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import { PublishedReviewResponse } from './published-review.response';
import type {
  ReReviewConfidence,
  ReReviewSummaryCounts,
} from './re-review.model';

export class ReReviewSummaryResponse implements ReReviewSummaryCounts {
  @ApiProperty({
    description:
      'Quantidade de comentários anteriores efetivamente analisados.',
    example: 3,
  })
  analyzed!: number;

  @ApiProperty({
    description: 'Comentários classificados como corrigidos.',
    example: 1,
  })
  corrigido!: number;

  @ApiProperty({
    description: 'Comentários classificados como parcialmente corrigidos.',
    example: 1,
  })
  parcialmente_corrigido!: number;

  @ApiProperty({
    description: 'Comentários ainda não corrigidos.',
    example: 1,
  })
  nao_corrigido!: number;

  @ApiProperty({
    description: 'Comentários considerados não aplicáveis ao diff atual.',
    example: 0,
  })
  nao_aplicavel!: number;

  @ApiProperty({
    description: 'Comentários para os quais não foi possível validar o status.',
    example: 0,
  })
  impossivel_validar!: number;
}

export class ReReviewOutcomeModel {
  @ApiProperty({
    description: 'URL do Pull Request re-revisado.',
    example: 'https://github.com/owner/repo/pull/123',
  })
  prUrl!: string;

  @ApiProperty({
    description: 'Evento efetivamente publicado pelo GitHub.',
    enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
    example: 'REQUEST_CHANGES',
  })
  event!: PullRequestReviewEvent;

  @ApiProperty({
    description: 'Corpo da re-review publicada no GitHub, em PT-BR.',
    example: '## Re-review automatizada\n...',
  })
  body!: string;

  @ApiProperty({
    description: 'Nível de confiança do modelo na re-análise.',
    enum: ['high', 'medium', 'low'],
    example: 'medium',
  })
  confidence!: ReReviewConfidence;

  @ApiProperty({
    description: 'Resumo agregado dos comentários re-revisados.',
    type: () => ReReviewSummaryResponse,
  })
  reReview!: ReReviewSummaryResponse;

  @ApiProperty({
    description: 'Metadados da re-review publicada no GitHub.',
    type: () => PublishedReviewResponse,
  })
  review!: PublishedReviewResponse;
}
