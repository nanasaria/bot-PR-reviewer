import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { ClaudeCliModule } from '../claude-cli/claude-cli.module';
import { OllamaModule } from '../ollama/ollama.module';
import { PrReviewController } from './controllers/pr-review.controller';
import { PrReviewService } from './services/pr-review.service';

@Module({
  imports: [GitHubModule, ClaudeCliModule, OllamaModule],
  controllers: [PrReviewController],
  providers: [PrReviewService],
})
export class PrReviewModule {}
