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
    const rawResponse = await this.runClaudeCommand(claudeCommand, [
      '-p',
      prompt,
    ]);
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
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdoutOutput = '';
      let stderrOutput = '';
      let claudeProcess: ChildProcessByStdio<null, Readable, Readable>;

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

      claudeProcess.stdout.setEncoding('utf8');
      claudeProcess.stderr.setEncoding('utf8');

      claudeProcess.stdout.on('data', (stdoutChunk: string) => {
        stdoutOutput += stdoutChunk;
      });
      claudeProcess.stderr.on('data', (stderrChunk: string) => {
        stderrOutput += stderrChunk;
      });

      claudeProcess.on('error', (error) => {
        reject(
          new InternalServerErrorException(
            `Erro ao executar o Claude CLI: ${error.message}`,
          ),
        );
      });

      claudeProcess.on('close', (exitCode) => {
        if (exitCode !== 0) {
          this.logger.error(
            `Claude CLI saiu com código ${exitCode}. stderr: ${stderrOutput}`,
          );
          reject(
            new InternalServerErrorException(
              `Claude CLI retornou código ${exitCode}: ${stderrOutput || stdoutOutput || '(sem saída)'}`,
            ),
          );
          return;
        }

        resolve(stdoutOutput);
      });
    });
  }
}
