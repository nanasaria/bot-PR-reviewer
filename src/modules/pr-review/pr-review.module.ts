import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { ClaudeCliModule } from '../claude-cli/claude-cli.module';
import { OllamaModule } from '../ollama/ollama.module';
import { PrReviewController } from './controllers/pr-review.controller';
import { ReReviewController } from './controllers/re-review.controller';
import { PrReviewService } from './services/pr-review.service';
import { ReReviewService } from './services/re-review.service';

@Module({
  imports: [GitHubModule, ClaudeCliModule, OllamaModule],
  controllers: [PrReviewController, ReReviewController],
  providers: [PrReviewService, ReReviewService],
})
export class PrReviewModule {}
