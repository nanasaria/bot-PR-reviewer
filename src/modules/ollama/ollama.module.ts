import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OllamaBootstrapService } from './services/ollama-bootstrap.service';
import { OllamaService } from './services/ollama.service';

@Module({
  imports: [ConfigModule],
  providers: [OllamaService, OllamaBootstrapService],
  exports: [OllamaService],
})
export class OllamaModule {}
