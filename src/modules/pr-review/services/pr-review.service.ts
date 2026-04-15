import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { getErrorMessage } from '../../../common/utils/error-message.util';
import { isClaudeUsageLimitError } from '../../claude-cli/utils/claude-limit-error.util';
import { GitHubService } from '../../github/services/github.service';
import type { PullRequestReviewEvent } from '../../github/models/review-event.model';
import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';
import { ClaudeCliService } from '../../claude-cli/services/claude-cli.service';
import { OllamaService } from '../../ollama/services/ollama.service';
import type { ClaudeIssue, ClaudeReview } from '../models/claude-review.model';
import {
  parsePullRequestUrl,
  type GitHubPullRequestReference,
} from '../models/pull-request-reference.model';
import type { PullRequestReviewPromptModel } from '../models/pull-request-review-prompt.model';
import type { ReviewOutcomeModel } from '../models/review-outcome.model';
import { analyzePullRequestChangeSet } from '../utils/change-set-analysis.util';
import { buildPullRequestReviewPrompt } from '../utils/review-prompt.util';

@Injectable()
export class PrReviewService {
  private readonly logger = new Logger(PrReviewService.name);

  constructor(
    private readonly gitHubService: GitHubService,
    private readonly claudeCliService: ClaudeCliService,
    private readonly ollamaService: OllamaService,
  ) {}

  async reviewPullRequest(pullRequestUrl: string): Promise<ReviewOutcomeModel> {
    const pullRequestReference =
      this.parsePullRequestUrlOrThrow(pullRequestUrl);
    const { owner, repositoryName, pullRequestNumber } = pullRequestReference;

    this.logger.log(
      `Analisando PR ${owner}/${repositoryName}#${pullRequestNumber}`,
    );

    const [pullRequestSummary, changedFiles] = await Promise.all([
      this.gitHubService.getPullRequestSummary(
        owner,
        repositoryName,
        pullRequestNumber,
      ),
      this.gitHubService.listPullRequestFiles(
        owner,
        repositoryName,
        pullRequestNumber,
      ),
    ]);

    if (changedFiles.length === 0) {
      throw new BadRequestException(
        'O PR não possui arquivos alterados para analisar.',
      );
    }

    const reviewPrompt = this.buildReviewPrompt({
      repositoryOwner: owner,
      repositoryName,
      pullRequestNumber,
      pullRequestSummary,
      changedFiles,
    });
    const claudeReview = await this.runReviewWithFallback(reviewPrompt);
    const reviewWithRequiredDescription =
      this.applyRequiredPullRequestDescriptionRule(
        claudeReview,
        pullRequestSummary.body,
      );
    const normalizedReview = this.applyRequiredBackendTestRule(
      reviewWithRequiredDescription,
      changedFiles,
      repositoryName,
    );

    const reviewEvent = this.determineReviewEvent(normalizedReview);
    const reviewBody = this.buildPublishedReviewBody(normalizedReview);

    const publishedReview = await this.gitHubService.publishReview(
      owner,
      repositoryName,
      pullRequestNumber,
      reviewBody,
      reviewEvent,
      pullRequestSummary.author,
    );

    return {
      prUrl: pullRequestUrl,
      event: publishedReview.event,
      body: reviewBody,
      confidence: normalizedReview.confidence,
      issues: normalizedReview.issues,
      review: publishedReview,
    };
  }

  determineReviewEvent(claudeReview: ClaudeReview): PullRequestReviewEvent {
    const hasHighSeverityIssue = this.hasIssueWithSeverity(
      claudeReview,
      'high',
    );
    const hasBlockingIssue = this.hasBlockingIssue(claudeReview);

    if (hasHighSeverityIssue) {
      return 'REQUEST_CHANGES';
    }

    switch (claudeReview.decision) {
      case 'REQUEST_CHANGES':
        return hasBlockingIssue ? 'REQUEST_CHANGES' : 'COMMENT';

      case 'APPROVE':
        if (hasBlockingIssue) return 'REQUEST_CHANGES';
        if (claudeReview.confidence === 'low') return 'COMMENT';
        return 'APPROVE';

      case 'COMMENT':
        return hasBlockingIssue ? 'REQUEST_CHANGES' : 'COMMENT';
    }
  }

  private parsePullRequestUrlOrThrow(
    pullRequestUrl: string,
  ): GitHubPullRequestReference {
    try {
      return parsePullRequestUrl(pullRequestUrl);
    } catch (error) {
      throw new BadRequestException(getErrorMessage(error));
    }
  }

  private buildReviewPrompt(
    reviewContext: PullRequestReviewPromptModel,
  ): string {
    return buildPullRequestReviewPrompt(reviewContext);
  }

  private applyRequiredPullRequestDescriptionRule(
    claudeReview: ClaudeReview,
    pullRequestDescription: string | null,
  ): ClaudeReview {
    if (pullRequestDescription?.trim()) {
      return claudeReview;
    }

    this.logger.warn('PR sem descrição. Forçando REQUEST_CHANGES.');

    return {
      ...claudeReview,
      decision: 'REQUEST_CHANGES',
      negatives: this.ensureMissingPullRequestDescriptionNegative(
        claudeReview.negatives,
      ),
      issues: this.ensureMissingPullRequestDescriptionIssue(
        claudeReview.issues,
      ),
    };
  }

  private applyRequiredBackendTestRule(
    claudeReview: ClaudeReview,
    changedFiles: GitHubPullRequestFile[],
    repositoryName: string,
  ): ClaudeReview {
    const changeSetAnalysis = analyzePullRequestChangeSet(
      changedFiles,
      repositoryName,
    );

    if (
      !changeSetAnalysis.hasBackendChanges ||
      changeSetAnalysis.hasTestFiles
    ) {
      return claudeReview;
    }

    this.logger.warn(
      'PR com alterações de back-end sem testes automatizados no diff. Forçando REQUEST_CHANGES.',
    );

    return {
      ...claudeReview,
      decision: 'REQUEST_CHANGES',
      testsNotes: this.ensureMissingBackendTestNote(claudeReview.testsNotes),
      issues: this.ensureMissingBackendTestIssue(
        claudeReview.issues,
        changeSetAnalysis.backendFiles[0],
      ),
    };
  }

  private async runReviewWithFallback(
    reviewPrompt: string,
  ): Promise<ClaudeReview> {
    try {
      return await this.claudeCliService.runReview(reviewPrompt);
    } catch (claudeError) {
      if (!isClaudeUsageLimitError(claudeError)) {
        throw claudeError;
      }

      this.logger.warn(
        'Claude CLI atingiu o limite de uso. Tentando fallback local via Ollama.',
      );

      try {
        return await this.ollamaService.runReview(reviewPrompt);
      } catch (ollamaError) {
        throw new InternalServerErrorException(
          `Claude CLI atingiu o limite de uso e o fallback Ollama falhou. Claude: ${getErrorMessage(
            claudeError,
          )}. Ollama: ${getErrorMessage(ollamaError)}`,
        );
      }
    }
  }

  private buildPublishedReviewBody(claudeReview: ClaudeReview): string {
    const sections = [
      this.formatTextSection('Visão Geral', claudeReview.overview),
      this.formatListSection(
        'Melhorias',
        claudeReview.improvements,
        'Nenhuma melhoria adicional além dos riscos apontados.',
      ),
      this.formatTextSection('Testes', claudeReview.testsNotes),
      this.formatListSection(
        'Pontos Negativos',
        claudeReview.negatives,
        'Nenhum ponto negativo adicional identificado.',
      ),
      this.formatListSection(
        'Pontos Positivos',
        claudeReview.positives,
        'Nenhum ponto positivo relevante identificado.',
      ),
    ];

    if (claudeReview.issues.length > 0) {
      sections.push(this.formatIssuesTable(claudeReview.issues));
    }

    return sections.join('\n\n');
  }

  private formatTextSection(title: string, content: string): string {
    return `**${title}**\n${content.trim()}`;
  }

  private formatListSection(
    title: string,
    items: string[],
    emptyMessage: string,
  ): string {
    const normalizedItems = items.map((item) => item.trim()).filter(Boolean);

    if (normalizedItems.length === 0) {
      return `**${title}**\n_${emptyMessage}_`;
    }

    const formattedItems = normalizedItems
      .map((item) => `- ${item}`)
      .join('\n');

    return `**${title}**\n${formattedItems}`;
  }

  private formatIssuesTable(issues: ClaudeIssue[]): string {
    const tableRows = issues
      .map(
        (issue) =>
          `| ${this.formatIssueSeverityLabel(issue.severity)} | \`${this.escapeMarkdownTableCell(issue.file)}\` | ${this.escapeMarkdownTableCell(issue.reason)} |`,
      )
      .join('\n');

    return [
      '**Tabela de Riscos**',
      '| Severidade | Arquivo | Motivo |',
      '| --- | --- | --- |',
      tableRows,
    ].join('\n');
  }

  private formatIssueSeverityLabel(severity: ClaudeIssue['severity']): string {
    switch (severity) {
      case 'high':
        return 'Alta';
      case 'medium':
        return 'Média';
      case 'low':
        return 'Baixa';
    }
  }

  private escapeMarkdownTableCell(value: string): string {
    return value.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  }

  private ensureMissingPullRequestDescriptionNegative(
    negatives: string[],
  ): string[] {
    if (
      negatives.some((negative) =>
        this.mentionsMissingPullRequestDescription(negative),
      )
    ) {
      return negatives;
    }

    return [
      ...negatives,
      'O PR está sem descrição, o que dificulta validar contexto, escopo e impactos antes do merge.',
    ];
  }

  private ensureMissingPullRequestDescriptionIssue(
    issues: ClaudeIssue[],
  ): ClaudeIssue[] {
    const existingIssueIndex = issues.findIndex((issue) =>
      this.mentionsMissingPullRequestDescription(
        `${issue.file} ${issue.reason}`,
      ),
    );

    if (existingIssueIndex === -1) {
      return [
        ...issues,
        {
          severity: 'medium',
          file: 'Descrição do PR',
          reason:
            'O PR está sem descrição. Adicione contexto, resumo das mudanças e impactos antes do merge.',
        },
      ];
    }

    const existingIssue = issues[existingIssueIndex];
    if (
      existingIssue.severity === 'medium' ||
      existingIssue.severity === 'high'
    ) {
      return issues;
    }

    const updatedIssues = [...issues];
    updatedIssues[existingIssueIndex] = {
      ...existingIssue,
      severity: 'medium',
    };

    return updatedIssues;
  }

  private ensureMissingBackendTestNote(testsNotes: string): string {
    const trimmedTestsNotes = testsNotes.trim();

    if (this.mentionsMissingBackendTests(trimmedTestsNotes)) {
      return trimmedTestsNotes;
    }

    return `${trimmedTestsNotes}\n\nAlém disso, o PR altera comportamento de back-end sem trazer testes automatizados para validar os cenários alterados. Isso precisa ser corrigido antes do merge.`;
  }

  private ensureMissingBackendTestIssue(
    issues: ClaudeIssue[],
    fallbackFile: string,
  ): ClaudeIssue[] {
    const existingIssueIndex = issues.findIndex((issue) =>
      this.mentionsMissingBackendTests(`${issue.file} ${issue.reason}`),
    );

    if (existingIssueIndex === -1) {
      return [
        ...issues,
        {
          severity: 'medium',
          file: fallbackFile,
          reason:
            'O PR altera comportamento de back-end sem incluir testes automatizados cobrindo os cenários alterados.',
        },
      ];
    }

    const existingIssue = issues[existingIssueIndex];
    if (
      existingIssue.severity === 'medium' ||
      existingIssue.severity === 'high'
    ) {
      return issues;
    }

    const updatedIssues = [...issues];
    updatedIssues[existingIssueIndex] = {
      ...existingIssue,
      severity: 'medium',
    };

    return updatedIssues;
  }

  private hasBlockingIssue(claudeReview: ClaudeReview): boolean {
    return claudeReview.issues.some(
      (issue) => issue.severity === 'high' || issue.severity === 'medium',
    );
  }

  private hasIssueWithSeverity(
    claudeReview: ClaudeReview,
    severity: ClaudeIssue['severity'],
  ): boolean {
    return claudeReview.issues.some((issue) => issue.severity === severity);
  }

  private mentionsMissingPullRequestDescription(text: string): boolean {
    const normalizedText = text.toLowerCase();
    const mentionsDescription = /descri[cç][aã]o|description/.test(
      normalizedText,
    );
    const mentionsGap = /falt|aus[eê]ncia|sem |vazi|missing|nao |não /.test(
      normalizedText,
    );

    return mentionsDescription && mentionsGap;
  }

  private mentionsMissingBackendTests(text: string): boolean {
    const normalizedText = text.toLowerCase();
    const mentionsTests =
      /teste|testes|test|spec|specs|cobertura|coverage|unit|unitário|unitario|automatizado/.test(
        normalizedText,
      );
    const mentionsGap =
      /falt|ausencia|ausência|sem |nao |não |insuficient|missing|necess[aá]ri|adicionar|incluir|obrigat[oó]ri|precisa/.test(
        normalizedText,
      );

    return mentionsTests && mentionsGap;
  }
}
