import type { GitHubPullRequestFile } from '../../github/models/github-pull-request.model';
import type { ReviewerCommentModel } from '../models/reviewer-comment.model';
import {
  buildReReviewPrompt,
  selectRelevantFilesForReReview,
} from './re-review-prompt.util';

const buildFile = (
  overrides: Partial<GitHubPullRequestFile> = {},
): GitHubPullRequestFile => ({
  filename: 'src/foo.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1 +1 @@',
  ...overrides,
});

const buildComment = (
  overrides: Partial<ReviewerCommentModel> = {},
): ReviewerCommentModel => ({
  id: 'review-comment:1',
  source: 'review-comment',
  author: 'reviewer-bot',
  body: 'comentário',
  filePath: 'src/foo.ts',
  line: 10,
  codeSnippet: null,
  createdAt: '2026-04-26T10:00:00Z',
  outdated: false,
  ...overrides,
});

describe('selectRelevantFilesForReReview', () => {
  it('retorna apenas os arquivos referenciados quando todos os comentários têm filePath', () => {
    const files = [
      buildFile({ filename: 'src/foo.ts' }),
      buildFile({ filename: 'src/bar.ts' }),
      buildFile({ filename: 'src/baz.ts' }),
    ];
    const comments = [
      buildComment({ filePath: 'src/foo.ts' }),
      buildComment({ filePath: 'src/baz.ts' }),
    ];

    const result = selectRelevantFilesForReReview(files, comments);

    expect(result.map((file) => file.filename)).toEqual([
      'src/foo.ts',
      'src/baz.ts',
    ]);
  });

  it('mapeia arquivo renomeado via previousFilename', () => {
    const files = [
      buildFile({
        filename: 'src/new-name.ts',
        previousFilename: 'src/old-name.ts',
        status: 'renamed',
      }),
      buildFile({ filename: 'src/other.ts' }),
    ];
    const comments = [buildComment({ filePath: 'src/old-name.ts' })];

    const result = selectRelevantFilesForReReview(files, comments);

    expect(result.map((file) => file.filename)).toEqual(['src/new-name.ts']);
  });

  it('inclui todos os arquivos quando há comentário sem arquivo associado', () => {
    const files = [
      buildFile({ filename: 'src/foo.ts' }),
      buildFile({ filename: 'src/bar.ts' }),
    ];
    const comments = [
      buildComment({ filePath: 'src/foo.ts' }),
      buildComment({ filePath: null, line: null, source: 'issue-comment' }),
    ];

    const result = selectRelevantFilesForReReview(files, comments);

    expect(result.map((file) => file.filename)).toEqual([
      'src/foo.ts',
      'src/bar.ts',
    ]);
  });

  it('retorna lista vazia quando nenhum arquivo do diff casa com os comentários', () => {
    const files = [buildFile({ filename: 'src/other.ts' })];
    const comments = [buildComment({ filePath: 'src/missing.ts' })];

    expect(selectRelevantFilesForReReview(files, comments)).toEqual([]);
  });
});

describe('buildReReviewPrompt token-saving behaviour', () => {
  const baseSummary = {
    title: 'Improve Button',
    body: 'Lorem ipsum '.repeat(100),
    author: 'notro',
    baseRef: 'main',
    headRef: 'feature/button',
    state: 'open',
    draft: false,
    changedFiles: 3,
    additions: 5,
    deletions: 1,
  };

  it('omite metadados do PR, descrição e identidade do reviewer/comentários', () => {
    const prompt = buildReReviewPrompt({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
      pullRequestSummary: baseSummary,
      reviewerLogin: 'reviewer-bot',
      reviewerComments: [
        buildComment({
          author: 'reviewer-bot',
          createdAt: '2026-04-26T09:00:00Z',
          body: 'Falta tratar erro de rede aqui.',
        }),
      ],
      changedFiles: [buildFile({ filename: 'src/foo.ts' })],
    });

    expect(prompt).not.toContain('acme/widgets');
    expect(prompt).not.toContain('PR #42');
    expect(prompt).not.toContain('Branch:');
    expect(prompt).not.toContain('Estado:');
    expect(prompt).not.toContain('Descrição do PR');
    expect(prompt).not.toContain('Lorem ipsum');
    expect(prompt).not.toContain('Reviewer configurado');
    expect(prompt).not.toContain('Autor:');
    expect(prompt).not.toContain('Data:');
    expect(prompt).toContain('PR: Improve Button');
    expect(prompt).toContain('1. src/foo.ts:10');
    expect(prompt).toContain('Falta tratar erro de rede aqui.');
  });

  it('mantém apenas os arquivos referenciados nos comentários no diff enviado', () => {
    const prompt = buildReReviewPrompt({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
      pullRequestSummary: baseSummary,
      reviewerLogin: 'reviewer-bot',
      reviewerComments: [buildComment({ filePath: 'src/foo.ts' })],
      changedFiles: [
        buildFile({ filename: 'src/foo.ts' }),
        buildFile({ filename: 'src/bar.ts', patch: 'PATCH-DE-OUTRO-ARQUIVO' }),
      ],
    });

    expect(prompt).toContain('### src/foo.ts');
    expect(prompt).not.toContain('### src/bar.ts');
    expect(prompt).not.toContain('PATCH-DE-OUTRO-ARQUIVO');
  });

  it('compacta diff_hunks longos para economizar tokens', () => {
    const longHunk = Array.from(
      { length: 30 },
      (_, index) => `linha-${index + 1}`,
    ).join('\n');
    const prompt = buildReReviewPrompt({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
      pullRequestSummary: baseSummary,
      reviewerLogin: 'reviewer-bot',
      reviewerComments: [buildComment({ codeSnippet: longHunk })],
      changedFiles: [buildFile({ filename: 'src/foo.ts' })],
    });

    expect(prompt).not.toContain('linha-1\n');
    expect(prompt).not.toContain('linha-15\n');
    expect(prompt).toContain('linha-30');
    expect(prompt).toContain('linha-21');
  });
});
