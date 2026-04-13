import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClaudeCliService } from './services/claude-cli.service';

@Module({
  imports: [ConfigModule],
  providers: [ClaudeCliService],
  exports: [ClaudeCliService],
})
export class ClaudeCliModule {}
