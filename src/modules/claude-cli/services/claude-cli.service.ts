import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import {
  ClaudeReview,
  ClaudeReviewSchema,
} from '../../pr-review/models/claude-review.model';
import type { PullRequestReviewPromptModel } from '../models/pull-request-review-prompt.model';
import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';

@Injectable()
export class ClaudeCliService {
  private readonly logger = new Logger(ClaudeCliService.name);

  constructor(private readonly configService: ConfigService) {}

  buildPrompt(reviewContext: PullRequestReviewPromptModel): string {
    const {
      repositoryOwner,
      repositoryName,
      pullRequestNumber,
      pullRequestSummary,
      changedFiles,
    } = reviewContext;

    const changedFilesSection = changedFiles
      .map((changedFile) => this.formatChangedFileSection(changedFile))
      .join('\n\n');

    return [
      'Você é uma engenheira sênior revisando um Pull Request do GitHub.',
      '',
      `Repositório: ${repositoryOwner}/${repositoryName}`,
      `PR #${pullRequestNumber}: ${pullRequestSummary.title}`,
      `Autor: ${pullRequestSummary.author}`,
      `Branch: ${pullRequestSummary.headRef} -> ${pullRequestSummary.baseRef}`,
      `Estado: ${pullRequestSummary.state}${pullRequestSummary.draft ? ' (draft)' : ''}`,
      `Arquivos alterados: ${pullRequestSummary.changedFiles} | +${pullRequestSummary.additions}/-${pullRequestSummary.deletions}`,
      '',
      'Descrição do PR:',
      pullRequestSummary.body?.trim()
        ? pullRequestSummary.body
        : '(sem descrição)',
      '',
      'Arquivos e diffs:',
      changedFilesSection || '(nenhum arquivo)',
      '',
      'Revise focando em: bugs, regressões, edge cases, segurança, performance, legibilidade e necessidade de testes.',
      '',
      'Regras de decisão:',
      '- use APPROVE somente se não houver nenhuma mudança obrigatória',
      '- use REQUEST_CHANGES se houver algo que precise ser corrigido antes do merge',
      '- use COMMENT se estiver inconclusivo ou houver apenas sugestões leves',
      '',
      'Responda APENAS com JSON puro (sem markdown, sem prosa, sem cercas de código), no formato:',
      '{',
      '  "decision": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",',
      '  "body": "texto final da review em português do Brasil, objetivo e profissional",',
      '  "issues": [',
      '    { "severity": "high" | "medium" | "low", "file": "caminho/arquivo", "reason": "descrição" }',
      '  ],',
      '  "confidence": "high" | "medium" | "low"',
      '}',
    ].join('\n');
  }

  async runReview(prompt: string): Promise<ClaudeReview> {
    const claudeCommand =
      this.configService.get<string>('CLAUDE_COMMAND') ?? 'claude';
    const rawResponse = await this.runClaudeCommand(claudeCommand, [
      '-p',
      prompt,
    ]);
    const parsedJsonPayload = this.extractJsonPayload(rawResponse);

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

  private extractJsonPayload(rawResponse: string): unknown {
    const trimmedResponse = rawResponse.trim();

    if (!trimmedResponse) {
      throw new InternalServerErrorException(
        'Claude CLI retornou resposta vazia.',
      );
    }

    const directlyParsedJson = this.tryParseJson(trimmedResponse);
    if (directlyParsedJson !== undefined) {
      return directlyParsedJson;
    }

    const fencedJsonMatch = trimmedResponse.match(
      /```(?:json)?\s*([\s\S]*?)```/i,
    );
    if (fencedJsonMatch) {
      const fencedJsonPayload = this.tryParseJson(fencedJsonMatch[1].trim());
      if (fencedJsonPayload !== undefined) {
        return fencedJsonPayload;
      }
    }

    const firstOpeningBraceIndex = trimmedResponse.indexOf('{');
    const lastClosingBraceIndex = trimmedResponse.lastIndexOf('}');
    if (
      firstOpeningBraceIndex !== -1 &&
      lastClosingBraceIndex > firstOpeningBraceIndex
    ) {
      const inlineJsonPayload = this.tryParseJson(
        trimmedResponse.slice(
          firstOpeningBraceIndex,
          lastClosingBraceIndex + 1,
        ),
      );

      if (inlineJsonPayload !== undefined) {
        return inlineJsonPayload;
      }
    }

    throw new InternalServerErrorException(
      'Não foi possível extrair JSON da resposta do Claude CLI.',
    );
  }

  private formatChangedFileSection(changedFile: GitHubPullRequestFile): string {
    const fileHeader = `### ${changedFile.filename} (${changedFile.status}, +${changedFile.additions}/-${changedFile.deletions})`;
    const filePatch = changedFile.patch
      ? `\n\`\`\`diff\n${changedFile.patch}\n\`\`\``
      : '\n_(sem diff disponível)_';

    return `${fileHeader}${filePatch}`;
  }

  private tryParseJson(jsonText: string): unknown {
    try {
      return JSON.parse(jsonText);
    } catch {
      return undefined;
    }
  }
}
