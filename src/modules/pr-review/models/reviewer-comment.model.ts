export type ReviewerCommentSource =
  | 'review-comment'
  | 'issue-comment'
  | 'review-body';

export interface ReviewerCommentModel {
  id: string;
  source: ReviewerCommentSource;
  author: string;
  body: string;
  filePath: string | null;
  line: number | null;
  codeSnippet: string | null;
  createdAt: string;
  outdated: boolean;
}
