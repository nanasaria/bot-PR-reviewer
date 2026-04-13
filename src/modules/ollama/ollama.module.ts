import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OllamaService } from './services/ollama.service';

@Module({
  imports: [ConfigModule],
  providers: [OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
