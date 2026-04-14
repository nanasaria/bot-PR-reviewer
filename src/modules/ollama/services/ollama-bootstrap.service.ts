import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { OllamaService } from './ollama.service';

@Injectable()
export class OllamaBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OllamaBootstrapService.name);

  constructor(private readonly ollamaService: OllamaService) {}

  onApplicationBootstrap(): void {
    void this.ollamaService.prepareForRequests().catch((error) => {
      this.logger.warn(
        `Falha ao preparar o Ollama na inicialização: ${getErrorMessage(error)}`,
      );
    });
  }
}
