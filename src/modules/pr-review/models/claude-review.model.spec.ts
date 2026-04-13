import { ClaudeReviewSchema } from './claude-review.model';

describe('ClaudeReviewSchema', () => {
  it('valida resposta completa e correta', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'APPROVE',
      body: 'Tudo certo',
      issues: [],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(true);
  });

  it('aplica default de issues quando omitido', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'COMMENT',
      body: 'Sugestões leves',
      confidence: 'medium',
    });
    expect(parseResult.success).toBe(true);
    if (parseResult.success) expect(parseResult.data.issues).toEqual([]);
  });

  it('rejeita decision inválida', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'LGTM',
      body: 'x',
      issues: [],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(false);
  });

  it('rejeita severity inválida em issues', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'REQUEST_CHANGES',
      body: 'x',
      issues: [{ severity: 'critical', file: 'a.ts', reason: 'y' }],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(false);
  });

  it('rejeita body vazio', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'COMMENT',
      body: '',
      issues: [],
      confidence: 'low',
    });
    expect(parseResult.success).toBe(false);
  });
});
