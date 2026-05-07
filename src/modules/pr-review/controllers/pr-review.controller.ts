import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewPrRequestModel } from '../models/review-pr-request.model';
import { ReviewOutcomeModel } from '../models/review-outcome.model';
import { PrReviewService } from '../services/pr-review.service';

@ApiTags('pr-review')
@Controller('pr-review')
export class PrReviewController {
  constructor(private readonly prReviewService: PrReviewService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Executa o review inicial de um Pull Request',
    description:
      'Analisa o PR via Claude CLI (com fallback para Ollama em caso de limite de uso) e publica a review geral diretamente no GitHub.',
  })
  @ApiOkResponse({
    description: 'Review publicada com sucesso no GitHub.',
    type: ReviewOutcomeModel,
  })
  @ApiBadRequestResponse({
    description:
      'URL do PR inválida ou PR sem arquivos alterados para analisar.',
  })
  @ApiInternalServerErrorResponse({
    description:
      'Falha ao executar Claude CLI, fallback Ollama ou ao publicar a review no GitHub.',
  })
  async review(
    @Body() reviewPrRequestModel: ReviewPrRequestModel,
  ): Promise<ReviewOutcomeModel> {
    return this.prReviewService.reviewPullRequest(reviewPrRequestModel.prUrl);
  }
}
