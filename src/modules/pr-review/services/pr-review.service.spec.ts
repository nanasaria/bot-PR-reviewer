import { PrReviewService } from './pr-review.service';
import type { ClaudeReview } from '../models/claude-review.model';

describe('PrReviewService.determineReviewEvent', () => {
  const prReviewService = Object.create(
    PrReviewService.prototype,
  ) as PrReviewService;

  const buildClaudeReview = (
    overrides: Partial<ClaudeReview> = {},
  ): ClaudeReview => ({
    decision: 'APPROVE',
    body: 'ok',
    issues: [],
    confidence: 'high',
    ...overrides,
  });

  it('APPROVE sem issues nem low-confidence => APPROVE', () => {
    expect(prReviewService.determineReviewEvent(buildClaudeReview())).toBe(
      'APPROVE',
    );
  });

  it('APPROVE com issue high => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          issues: [{ severity: 'high', file: 'a.ts', reason: 'bug' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('APPROVE com issue medium => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          issues: [{ severity: 'medium', file: 'a.ts', reason: 'x' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('APPROVE com confidence low e sem issues obrigatórias => COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({ decision: 'APPROVE', confidence: 'low' }),
      ),
    ).toBe('COMMENT');
  });

  it('APPROVE com confidence low e apenas issue low => COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'APPROVE',
          confidence: 'low',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('COMMENT');
  });

  it('REQUEST_CHANGES com issue high => REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'REQUEST_CHANGES',
          issues: [{ severity: 'high', file: 'a.ts', reason: 'bug' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('REQUEST_CHANGES sem issues obrigatórias vira COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'REQUEST_CHANGES',
          issues: [{ severity: 'low', file: 'a.ts', reason: 'nit' }],
        }),
      ),
    ).toBe('COMMENT');
  });

  it('COMMENT com issue medium vira REQUEST_CHANGES', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({
          decision: 'COMMENT',
          issues: [{ severity: 'medium', file: 'a.ts', reason: 'x' }],
        }),
      ),
    ).toBe('REQUEST_CHANGES');
  });

  it('COMMENT sem issues obrigatórias permanece COMMENT', () => {
    expect(
      prReviewService.determineReviewEvent(
        buildClaudeReview({ decision: 'COMMENT', confidence: 'medium' }),
      ),
    ).toBe('COMMENT');
  });
});
