import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { extractJsonPayload } from '../../../common/utils/json-payload.util';
import {
  ClaudeReview,
  ClaudeReviewSchema,
} from '../../pr-review/models/claude-review.model';

@Injectable()
export class ClaudeCliService {
  private readonly logger = new Logger(ClaudeCliService.name);

  constructor(private readonly configService: ConfigService) {}

  async runReview(prompt: string): Promise<ClaudeReview> {
    const claudeCommand =
      this.configService.get<string>('CLAUDE_COMMAND') ?? 'claude';
    const claudeTimeoutMs =
      this.configService.get<number>('CLAUDE_TIMEOUT_MS') ?? 120000;

    const rawResponse = await this.runClaudeCommand(
      claudeCommand,
      ['-p', prompt],
      claudeTimeoutMs,
    );

    const parsedJsonPayload = extractJsonPayload(
      rawResponse,
      'Claude CLI retornou resposta vazia.',
      'Não foi possível extrair JSON da resposta do Claude CLI.',
    );

    const parseResult = ClaudeReviewSchema.safeParse(parsedJsonPayload);
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
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdoutOutput = '';
      let stderrOutput = '';
      let claudeProcess: ChildProcessByStdio<null, Readable, Readable>;
      let forceKillHandle: NodeJS.Timeout | undefined;
      let isSettled = false;

      this.logger.log(`Executando Claude CLI com timeout de ${timeoutMs}ms.`);

      try {
        claudeProcess = spawn(claudeCommand, commandArguments, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(
          new InternalServerErrorException(
            `Falha ao executar o Claude CLI (${claudeCommand}): ${getErrorMessage(error)}`,
          ),
        );
        return;
      }

      const timeoutHandle = setTimeout(() => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        this.logger.error(
          `Claude CLI excedeu o timeout de ${timeoutMs}ms após ~${Date.now() - startedAt}ms. Encerrando processo.`,
        );
        claudeProcess.kill('SIGTERM');
        forceKillHandle = setTimeout(() => {
          if (!claudeProcess.killed) {
            claudeProcess.kill('SIGKILL');
          }
        }, 5000);
        reject(
          new InternalServerErrorException(
            `Claude CLI excedeu o tempo limite de ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      const clearHandles = () => {
        clearTimeout(timeoutHandle);
        if (forceKillHandle) {
          clearTimeout(forceKillHandle);
        }
      };

      const finish = (callback: () => void) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearHandles();
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
        clearHandles();
        finish(() => {
          reject(
            new InternalServerErrorException(
              `Erro ao executar o Claude CLI: ${error.message}`,
            ),
          );
        });
      });

      claudeProcess.on('close', (exitCode) => {
        clearHandles();

        if (isSettled) {
          return;
        }

        if (exitCode !== 0) {
          this.logger.error(
            `Claude CLI saiu com código ${exitCode} após ~${Date.now() - startedAt}ms. stderr: ${stderrOutput}`,
          );
          finish(() => {
            reject(
              new InternalServerErrorException(
                `Claude CLI retornou código ${exitCode}: ${stderrOutput || stdoutOutput || '(sem saída)'}`,
              ),
            );
          });
          return;
        }

        finish(() => {
          this.logger.log(
            `Claude CLI finalizado em ~${Date.now() - startedAt}ms.`,
          );
          resolve(stdoutOutput);
        });
      });
    });
  }
}
