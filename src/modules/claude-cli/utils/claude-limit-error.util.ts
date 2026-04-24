import { getErrorMessage } from '../../../common/utils/error-message.util';

const CLAUDE_LIMIT_ERROR_PATTERNS = [
  /you['’]?ve hit (?:your )?limit/i,
  /usage limit/i,
  /rate limit/i,
];

export function isClaudeUsageLimitError(error: unknown): boolean {
  const errorMessage = getErrorMessage(error);
  return CLAUDE_LIMIT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(errorMessage),
  );
}
