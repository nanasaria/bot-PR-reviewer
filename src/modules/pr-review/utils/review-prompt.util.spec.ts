import { buildPullRequestReviewPrompt } from './review-prompt.util';

describe('buildPullRequestReviewPrompt', () => {
  it('inclui orientações de profundidade, testes e descrição obrigatória', () => {
    const prompt = buildPullRequestReviewPrompt({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
      pullRequestSummary: {
        title: 'Melhora a revisão de PR',
        body: null,
        author: 'notro',
        baseRef: 'main',
        headRef: 'feature/review-flow',
        state: 'open',
        draft: false,
        changedFiles: 1,
        additions: 20,
        deletions: 4,
      },
      changedFiles: [
        {
          filename: 'src/app.ts',
          status: 'modified',
          additions: 20,
          deletions: 4,
          changes: 24,
          patch: '@@ -1,2 +1,3 @@\n-console.log("old")\n+console.log("new")',
        },
      ],
    });

    expect(prompt).toContain(
      'revisão técnica, crítica e aprofundada de um Pull Request do GitHub',
    );
    expect(prompt).toContain(
      'tratamento de erros, fluxos de falha e estados parciais',
    );
    expect(prompt).toContain(
      'Em alterações de back-end, verifique obrigatoriamente se o PR traz testes automatizados cobrindo o comportamento alterado.',
    );
    expect(prompt).toContain(
      'Se houver mudança de back-end sem testes automatizados no diff, trate isso como mudança obrigatória antes do merge e normalmente use REQUEST_CHANGES.',
    );
    expect(prompt).toContain(
      'Se o PR for apenas de front-end, a ausência de testes não é bloqueante por si só.',
    );
    expect(prompt).toContain(
      'A descrição do PR é obrigatória. Se o PR estiver sem descrição ou com descrição vazia, trate isso como mudança obrigatória antes do merge.',
    );
    expect(prompt).toContain('Descrição do PR:');
    expect(prompt).toContain('(sem descrição)');
    expect(prompt).toContain(
      'não misture palavras em inglês quando houver equivalente natural em português',
    );
    expect(prompt).toContain('prefira "caso de borda" em vez de "edge case"');
    expect(prompt).toContain('Estrutura obrigatória da resposta:');
    expect(prompt).toContain('- overview: 1 a 2 parágrafos curtos');
    expect(prompt).toContain('- improvements: lista de sugestões concretas');
    expect(prompt).toContain(
      '- testsNotes: 1 a 2 frases sobre a cobertura de testes',
    );
    expect(prompt).toContain('- negatives: lista de pontos negativos');
    expect(prompt).toContain('- positives: lista de pontos positivos');
    expect(prompt).toContain(
      'Contexto inferido automaticamente a partir do diff:',
    );
    expect(prompt).toContain('- há alterações de back-end: sim');
    expect(prompt).toContain('- há arquivos de teste no PR: não');
  });
});
