import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
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

const ECONOMICAL_CLAUDE_MODEL = 'haiku';

@Injectable()
export class ClaudeCliService {
  private readonly logger = new Logger(ClaudeCliService.name);

  constructor(private readonly configService: ConfigService) {}

  async runReview(prompt: string): Promise<ClaudeReview> {
    return this.runWithSchema(prompt, ClaudeReviewSchema);
  }

  async runReReview(prompt: string): Promise<ReReview> {
    return this.runWithSchema(prompt, ReReviewSchema, ECONOMICAL_CLAUDE_MODEL);
  }

  private async runWithSchema<TSchema extends ZodTypeAny>(
    prompt: string,
    schema: TSchema,
    modelOverride?: string,
  ): Promise<z.infer<TSchema>> {
    const claudeCommand =
      this.configService.get<string>('CLAUDE_COMMAND') ?? 'claude';
    const claudeModel =
      modelOverride ??
      this.configService.get<string>('CLAUDE_MODEL') ??
      ECONOMICAL_CLAUDE_MODEL;
    const claudeTimeoutMs =
      this.configService.get<number>('CLAUDE_TIMEOUT_MS') ?? 300000;

    const rawResponse = await this.runClaudeCommand(
      claudeCommand,
      ['-p', '--model', claudeModel],
      claudeTimeoutMs,
      prompt,
    );

    const parsedJsonPayload = extractJsonPayload(
      rawResponse,
      'Claude CLI retornou resposta vazia.',
      'Não foi possível extrair JSON da resposta do Claude CLI.',
    );

    const parseResult = schema.safeParse(parsedJsonPayload);
    if (!parseResult.success) {
      this.logger.error(
        'Resposta do Claude CLI não passou na validação',
        parseResult.error,
      );
      throw new InternalServerErrorException(
        `Resposta inválida do Claude CLI: ${parseResult.error.message}`,
      );
    }

    return parseResult.data;
  }

  private runClaudeCommand(
    claudeCommand: string,
    commandArguments: string[],
    timeoutMs: number,
    stdinInput: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let stdoutOutput = '';
      let stderrOutput = '';
      let claudeProcess: ChildProcessByStdio<Writable, Readable, Readable>;
      let forceKillHandle: NodeJS.Timeout | undefined;
      let isSettled = false;

      this.logger.log(`Executando Claude CLI com timeout de ${timeoutMs}ms.`);

      try {
        claudeProcess = spawn(claudeCommand, commandArguments, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        claudeProcess.stdin.end(stdinInput, 'utf8');
      } catch (error) {
        reject(
          new InternalServerErrorException(
            `Falha ao executar o Claude CLI (${claudeCommand}): ${getErrorMessage(error)}`,
          ),
        );
        return;
      }

      const getElapsedMs = () => Math.round(performance.now() - startedAt);

      const clearHandles = () => {
        clearTimeout(timeoutHandle);
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
      };

      const removeListeners = () => {
        claudeProcess.stdout.removeAllListeners('data');
        claudeProcess.stderr.removeAllListeners('data');
        claudeProcess.removeAllListeners('error');
        claudeProcess.removeAllListeners('close');
      };

      const timeoutHandle = setTimeout(() => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        removeListeners();
        this.logger.error(
          `Claude CLI excedeu o timeout de ${timeoutMs}ms após ~${getElapsedMs()}ms. Encerrando processo.`,
        );
        claudeProcess.kill('SIGTERM');
        forceKillHandle = setTimeout(() => {
          if (
            claudeProcess.exitCode === null &&
            claudeProcess.signalCode === null
          ) {
            claudeProcess.kill('SIGKILL');
          }
        }, 5000);
        forceKillHandle.unref?.();
        reject(
          new InternalServerErrorException(
            `Claude CLI excedeu o tempo limite de ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      const finish = (callback: () => void) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearHandles();
        removeListeners();
        callback();
      };

      claudeProcess.stdout.setEncoding('utf8');
      claudeProcess.stderr.setEncoding('utf8');

      claudeProcess.stdout.on('data', (stdoutChunk: string) => {
        stdoutOutput += stdoutChunk;
      });
      claudeProcess.stderr.on('data', (stderrChunk: string) => {
        stderrOutput += stderrChunk;
      });

      claudeProcess.on('error', (error) => {
        finish(() => {
          reject(
            new InternalServerErrorException(
              `Erro ao executar o Claude CLI: ${error.message}`,
            ),
          );
        });
      });

      claudeProcess.on('close', (exitCode) => {
        if (isSettled) {
          return;
        }

        if (exitCode !== 0) {
          const outputSummary = this.formatProcessOutputSummary(
            stdoutOutput,
            stderrOutput,
          );
          this.logger.error(
            `Claude CLI saiu com código ${exitCode} após ~${getElapsedMs()}ms. ${outputSummary}`,
          );
          finish(() => {
            reject(
              new InternalServerErrorException(
                `Claude CLI retornou código ${exitCode}: ${outputSummary}`,
              ),
            );
          });
          return;
        }

        finish(() => {
          this.logger.log(`Claude CLI finalizado em ~${getElapsedMs()}ms.`);
          resolve(stdoutOutput);
        });
      });
    });
  }

  private formatProcessOutputSummary(
    stdoutOutput: string,
    stderrOutput: string,
  ): string {
    const normalizedStdout = stdoutOutput.trim();
    const normalizedStderr = stderrOutput.trim();
    const outputSections: string[] = [];

    if (normalizedStderr) {
      outputSections.push(`stderr: ${normalizedStderr}`);
    }

    if (normalizedStdout) {
      outputSections.push(`stdout: ${normalizedStdout}`);
    }

    return outputSections.join(' | ') || '(sem saída)';
  }
}
