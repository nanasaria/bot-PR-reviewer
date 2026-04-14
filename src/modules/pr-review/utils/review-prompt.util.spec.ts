import { buildPullRequestReviewPrompt } from './review-prompt.util';

describe('buildPullRequestReviewPrompt', () => {
  it('explicita que a descrição do PR é obrigatória', () => {
    const prompt = buildPullRequestReviewPrompt({
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
      pullRequestSummary: {
        title: 'Melhora revisão',
        body: null,
        author: 'notro',
        baseRef: 'main',
        headRef: 'feature/review',
        state: 'open',
        draft: false,
        changedFiles: 1,
        additions: 10,
        deletions: 2,
      },
      changedFiles: [
        {
          filename: 'src/app.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
          patch: '@@ -1 +1 @@',
        },
      ],
    });

    expect(prompt).toContain('Descrição do PR:');
    expect(prompt).toContain('(sem descrição)');
    expect(prompt).toContain(
      'A descrição do PR é obrigatória. Se o PR estiver sem descrição ou com descrição vazia, trate isso como mudança obrigatória antes do merge.',
    );
  });
});
