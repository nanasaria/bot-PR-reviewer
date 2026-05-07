import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewPrRequestModel } from '../models/review-pr-request.model';
import { ReReviewOutcomeModel } from '../models/re-review-outcome.model';
import { ReReviewService } from '../services/re-review.service';

@ApiTags('re-review')
@Controller('re-review')
export class ReReviewController {
  constructor(private readonly reReviewService: ReReviewService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Executa o re-review automatizado de um Pull Request',
    description:
      'Re-analisa o PR limitado ao escopo dos comentários anteriores feitos pelo reviewer configurado em REVIEWER_LOGIN. Falha se REVIEWER_LOGIN não estiver configurado ou se não houver comentários válidos do reviewer.',
  })
  @ApiOkResponse({
    description: 'Re-review publicada com sucesso no GitHub.',
    type: ReReviewOutcomeModel,
  })
  @ApiBadRequestResponse({
    description:
      'URL do PR inválida, REVIEWER_LOGIN não configurado, PR sem arquivos alterados ou sem comentários válidos do reviewer.',
  })
  @ApiInternalServerErrorResponse({
    description:
      'Falha ao executar Claude CLI, fallback Ollama ou ao publicar a re-review no GitHub.',
  })
  async reReview(
    @Body() reviewPrRequestModel: ReviewPrRequestModel,
  ): Promise<ReReviewOutcomeModel> {
    return this.reReviewService.reReviewPullRequest(reviewPrRequestModel.prUrl);
  }
}
