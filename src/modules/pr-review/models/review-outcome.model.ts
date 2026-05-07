import { ApiProperty } from '@nestjs/swagger';
import type {
  ClaudeIssue,
  ClaudeIssueSeverity,
  ClaudeReviewConfidence,
} from './claude-review.model';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import { PublishedReviewResponse } from './published-review.response';

export class ReviewIssueResponse implements ClaudeIssue {
  @ApiProperty({
    description: 'Severidade do problema identificado.',
    enum: ['high', 'medium', 'low'],
    example: 'high',
  })
  severity!: ClaudeIssueSeverity;

  @ApiProperty({
    description: 'Arquivo onde o problema foi identificado.',
    example: 'src/modules/foo/foo.service.ts',
  })
  file!: string;

  @ApiProperty({
    description: 'Motivo do problema identificado.',
    example: 'Falta tratamento de erro para chamadas externas.',
  })
  reason!: string;
}

export class ReviewOutcomeModel {
  @ApiProperty({
    description: 'URL do Pull Request analisado.',
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
    description: 'Corpo da review publicada no GitHub, em PT-BR.',
    example: '**Visão Geral**\n...',
  })
  body!: string;

  @ApiProperty({
    description: 'Nível de confiança do modelo na análise.',
    enum: ['high', 'medium', 'low'],
    example: 'high',
  })
  confidence!: ClaudeReviewConfidence;

  @ApiProperty({
    description: 'Riscos identificados pelo modelo.',
    type: () => [ReviewIssueResponse],
  })
  issues!: ReviewIssueResponse[];

  @ApiProperty({
    description: 'Metadados da review publicada no GitHub.',
    type: () => PublishedReviewResponse,
  })
  review!: PublishedReviewResponse;
}
