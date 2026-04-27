import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import type { ZodTypeAny, z } from 'zod';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { extractJsonPayload } from '../../../common/utils/json-payload.util';
import {
  ClaudeReview,
  ClaudeReviewSchema,
} from '../../pr-review/models/claude-review.model';
import {
  ReReview,
  ReReviewSchema,
} from '../../pr-review/models/re-review.model';
import type {
  OllamaChatMessageModel,
  OllamaChatRequestModel,
  OllamaChatResponseModel,
} from '../models/ollama-chat.model';

type OllamaWarmupResponse = {
  error?: string;
  load_duration?: number;
};

const OLLAMA_PING_TIMEOUT_MS = 1_500;
const OLLAMA_STARTUP_POLL_INTERVAL_MS = 500;

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  constructor(private readonly configService: ConfigService) {}

  async prepareForRequests(): Promise<void> {
    const ollamaApiBaseUrl = this.getOllamaApiBaseUrl();
    const ollamaModel = this.getOllamaModel();
    const shouldWarmupOnBoot = this.isFeatureEnabled(
      'OLLAMA_WARMUP_ON_BOOT',
      true,
    );

    const serverAlreadyAvailable = await this.isServerAvailable();
    if (!serverAlreadyAvailable) {
      const shouldAutoStart = this.isFeatureEnabled('OLLAMA_AUTO_START', true);
      if (!shouldAutoStart) {
        this.logger.warn(
          `Ollama indisponível em ${ollamaApiBaseUrl} e a inicialização automática está desabilitada.`,
        );
        return;
      }

      if (!this.canAutoStartOllamaServer(ollamaApiBaseUrl)) {
        this.logger.warn(
          `Ollama indisponível em ${ollamaApiBaseUrl}. A inicialização automática só é suportada para endpoints locais.`,
        );
        return;
      }

      try {
        await this.startOllamaServer();
      } catch (error) {
        this.logger.warn(
          `Não foi possível iniciar o Ollama automaticamente: ${getErrorMessage(error)}`,
        );
        return;
      }

      const startupTimeoutMs = this.getOllamaStartupTimeoutMs();
      const serverBecameAvailable =
        await this.waitForServerAvailability(startupTimeoutMs);
      if (!serverBecameAvailable) {
        this.logger.warn(
          `Ollama não respondeu em ${startupTimeoutMs}ms após a tentativa de inicialização automática.`,
        );
        return;
      }

      this.logger.log(
        `Ollama disponível em ${ollamaApiBaseUrl} após inicialização automática.`,
      );
    }

    if (!shouldWarmupOnBoot) {
      return;
    }

    try {
      const loadDurationNs = await this.warmUpModel();
      const loadDurationMs =
        typeof loadDurationNs === 'number'
          ? Math.round(loadDurationNs / 1_000_000)
          : undefined;

      this.logger.log(
        loadDurationMs === undefined
          ? `Modelo ${ollamaModel} aquecido na inicialização.`
          : `Modelo ${ollamaModel} aquecido na inicialização em ~${loadDurationMs}ms.`,
      );
    } catch (error) {
      this.logger.warn(
        `Não foi possível aquecer o modelo ${ollamaModel} na inicialização: ${getErrorMessage(error)}`,
      );
    }
  }

  async runReview(prompt: string): Promise<ClaudeReview> {
    return this.runWithSchema(prompt, ClaudeReviewSchema);
  }

  async runReReview(prompt: string): Promise<ReReview> {
    return this.runWithSchema(prompt, ReReviewSchema);
  }

  private async runWithSchema<TSchema extends ZodTypeAny>(
    prompt: string,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const ollamaApiBaseUrl = this.getOllamaApiBaseUrl();
    const ollamaModel = this.getOllamaModel();
    const ollamaTimeoutMs = this.getOllamaTimeoutMs();

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

    const parseResult = schema.safeParse(parsedJsonPayload);
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

  private async warmUpModel(): Promise<number | undefined> {
    const ollamaApiBaseUrl = this.getOllamaApiBaseUrl();
    const ollamaModel = this.getOllamaModel();
    const ollamaTimeoutMs = this.getOllamaTimeoutMs();
    const keepAlive = this.getOllamaWarmupKeepAlive();

    let response: Response;

    try {
      response = await fetch(`${ollamaApiBaseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          keep_alive: keepAlive,
        }),
        signal: AbortSignal.timeout(ollamaTimeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Falha ao conectar ao Ollama (${ollamaModel}): ${getErrorMessage(error)}`,
      );
    }

    const rawResponse = await response.text();
    if (!response.ok) {
      throw new Error(
        `Ollama retornou HTTP ${response.status}: ${this.extractOllamaErrorMessage(rawResponse)}`,
      );
    }

    if (!rawResponse) {
      return undefined;
    }

    try {
      const parsedResponse = JSON.parse(rawResponse) as OllamaWarmupResponse;
      return parsedResponse.load_duration;
    } catch {
      return undefined;
    }
  }

  private async isServerAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.getOllamaApiBaseUrl()}/tags`, {
        signal: AbortSignal.timeout(OLLAMA_PING_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForServerAvailability(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.isServerAvailable()) {
        return true;
      }

      await this.sleep(OLLAMA_STARTUP_POLL_INTERVAL_MS);
    }

    return false;
  }

  private async startOllamaServer(): Promise<void> {
    const ollamaCommand =
      this.configService.get<string>('OLLAMA_COMMAND') ?? 'ollama';
    const ollamaHost = this.getLocalOllamaHost();

    await new Promise<void>((resolve, reject) => {
      let processStarted = false;

      try {
        const ollamaProcess = spawn(ollamaCommand, ['serve'], {
          detached: true,
          stdio: 'ignore',
          env: ollamaHost
            ? {
                ...process.env,
                OLLAMA_HOST: ollamaHost,
              }
            : process.env,
        });

        ollamaProcess.once('spawn', () => {
          processStarted = true;
          ollamaProcess.unref();
          resolve();
        });
        ollamaProcess.once('error', (error) => {
          if (!processStarted) {
            reject(error);
          }
        });
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error(getErrorMessage(error)),
        );
      }
    });
  }

  private canAutoStartOllamaServer(ollamaApiBaseUrl: string): boolean {
    try {
      const ollamaApiUrl = new URL(ollamaApiBaseUrl);
      return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(
        ollamaApiUrl.hostname,
      );
    } catch {
      return false;
    }
  }

  private getLocalOllamaHost(): string | undefined {
    try {
      const ollamaApiUrl = new URL(this.getOllamaApiBaseUrl());
      const defaultPort = ollamaApiUrl.protocol === 'https:' ? '443' : '80';

      return ollamaApiUrl.port
        ? `${ollamaApiUrl.hostname}:${ollamaApiUrl.port}`
        : `${ollamaApiUrl.hostname}:${defaultPort}`;
    } catch {
      return undefined;
    }
  }

  private getOllamaApiBaseUrl(): string {
    return (
      this.configService.get<string>('OLLAMA_API_BASE_URL') ??
      'http://localhost:11434/api'
    ).replace(/\/+$/, '');
  }

  private getOllamaModel(): string {
    return this.configService.get<string>('OLLAMA_MODEL') ?? 'qwen3-coder:30b';
  }

  private getOllamaTimeoutMs(): number {
    return this.configService.get<number>('OLLAMA_TIMEOUT_MS') ?? 180000;
  }

  private getOllamaStartupTimeoutMs(): number {
    return this.configService.get<number>('OLLAMA_STARTUP_TIMEOUT_MS') ?? 30000;
  }

  private getOllamaWarmupKeepAlive(): string {
    return this.configService.get<string>('OLLAMA_WARMUP_KEEP_ALIVE') ?? '10m';
  }

  private isFeatureEnabled(
    featureName: string,
    defaultValue: boolean,
  ): boolean {
    const featureValue = this.configService.get<string>(featureName);

    if (featureValue === undefined) {
      return defaultValue;
    }

    return !['0', 'false', 'no', 'off'].includes(
      featureValue.trim().toLowerCase(),
    );
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private extractOllamaErrorMessage(rawResponse: string): string {
    try {
      const parsedResponse = JSON.parse(
        rawResponse,
      ) as OllamaChatResponseModel & OllamaWarmupResponse;
      return (parsedResponse.error ?? rawResponse) || 'sem detalhes';
    } catch {
      return rawResponse || 'sem detalhes';
    }
  }
}
