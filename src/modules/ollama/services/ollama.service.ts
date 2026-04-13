import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { extractJsonPayload } from '../../../common/utils/json-payload.util';
import {
  ClaudeReview,
  ClaudeReviewSchema,
} from '../../pr-review/models/claude-review.model';
import type {
  OllamaChatMessageModel,
  OllamaChatRequestModel,
  OllamaChatResponseModel,
} from '../models/ollama-chat.model';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  constructor(private readonly configService: ConfigService) {}

  async runReview(prompt: string): Promise<ClaudeReview> {
    const ollamaApiBaseUrl =
      this.configService.get<string>('OLLAMA_API_BASE_URL') ??
      'http://localhost:11434/api';
    const ollamaModel =
      this.configService.get<string>('OLLAMA_MODEL') ?? 'qwen3-coder:30b';
    const ollamaTimeoutMs =
      this.configService.get<number>('OLLAMA_TIMEOUT_MS') ?? 180000;

    let response: Response;

    try {
      response = await fetch(`${ollamaApiBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildChatRequest(ollamaModel, prompt)),
        signal: AbortSignal.timeout(ollamaTimeoutMs),
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `Falha ao conectar ao Ollama (${ollamaModel}): ${getErrorMessage(error)}`,
      );
    }

    const rawResponse = await response.text();

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Ollama retornou HTTP ${response.status}: ${this.extractOllamaErrorMessage(rawResponse)}`,
      );
    }

    const ollamaChatResponse = this.parseChatResponse(rawResponse);
    const parsedJsonPayload = extractJsonPayload(
      ollamaChatResponse.message.content,
      'Ollama retornou resposta vazia.',
      'Não foi possível extrair JSON da resposta do Ollama.',
    );

    const parseResult = ClaudeReviewSchema.safeParse(parsedJsonPayload);
    if (!parseResult.success) {
      this.logger.error(
        'Resposta do Ollama não passou na validação',
        parseResult.error,
      );
      throw new InternalServerErrorException(
        `Resposta inválida do Ollama: ${parseResult.error.message}`,
      );
    }

    return parseResult.data;
  }

  private buildChatRequest(
    ollamaModel: string,
    prompt: string,
  ): OllamaChatRequestModel {
    return {
      model: ollamaModel,
      format: 'json',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    };
  }

  private parseChatResponse(
    rawResponse: string,
  ): OllamaChatResponseModel & { message: OllamaChatMessageModel } {
    let parsedResponse: OllamaChatResponseModel;

    try {
      parsedResponse = JSON.parse(rawResponse) as OllamaChatResponseModel;
    } catch (error) {
      throw new InternalServerErrorException(
        `Resposta inválida do Ollama: ${getErrorMessage(error)}`,
      );
    }

    if (!parsedResponse.message?.content) {
      throw new InternalServerErrorException(
        'Ollama não retornou conteúdo na mensagem.',
      );
    }

    return {
      ...parsedResponse,
      message: parsedResponse.message,
    };
  }

  private extractOllamaErrorMessage(rawResponse: string): string {
    try {
      const parsedResponse = JSON.parse(rawResponse) as OllamaChatResponseModel;
      return (parsedResponse.error ?? rawResponse) || 'sem detalhes';
    } catch {
      return rawResponse || 'sem detalhes';
    }
  }
}
