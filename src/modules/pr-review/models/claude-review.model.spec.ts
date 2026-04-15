import { ClaudeReviewSchema } from './claude-review.model';

describe('ClaudeReviewSchema', () => {
  it('valida resposta completa e correta', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'APPROVE',
      overview: 'Tudo certo',
      improvements: ['Extrair helper para reduzir duplicação.'],
      testsNotes: 'Os testes cobrem os cenários relevantes.',
      negatives: ['Falta um caso de borda específico.'],
      positives: ['A implementação está bem organizada.'],
      issues: [],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(true);
  });

  it('aplica defaults para listas quando omitidas', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'COMMENT',
      overview: 'Sugestões leves',
      testsNotes: 'Os testes precisam de cobertura adicional.',
      confidence: 'medium',
    });
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.improvements).toEqual([]);
      expect(parseResult.data.negatives).toEqual([]);
      expect(parseResult.data.positives).toEqual([]);
      expect(parseResult.data.issues).toEqual([]);
    }
  });

  it('rejeita decision inválida', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'LGTM',
      overview: 'x',
      testsNotes: 'y',
      issues: [],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(false);
  });

  it('rejeita severity inválida em issues', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'REQUEST_CHANGES',
      overview: 'x',
      testsNotes: 'y',
      issues: [{ severity: 'critical', file: 'a.ts', reason: 'y' }],
      confidence: 'high',
    });
    expect(parseResult.success).toBe(false);
  });

  it('rejeita overview vazio', () => {
    const parseResult = ClaudeReviewSchema.safeParse({
      decision: 'COMMENT',
      overview: '',
      testsNotes: 'Cobertura insuficiente.',
      issues: [],
      confidence: 'low',
    });
    expect(parseResult.success).toBe(false);
  });
});
