import { Module } from '@nestjs/common';
import { GitHubModule } from '../github/github.module';
import { ClaudeCliModule } from '../claude-cli/claude-cli.module';
import { PrReviewController } from './controllers/pr-review.controller';
import { PrReviewService } from './services/pr-review.service';

@Module({
  imports: [GitHubModule, ClaudeCliModule],
  controllers: [PrReviewController],
  providers: [PrReviewService],
})
export class PrReviewModule {}
