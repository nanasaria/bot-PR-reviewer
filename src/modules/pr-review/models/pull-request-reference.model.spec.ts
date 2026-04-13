import { parsePullRequestUrl } from './pull-request-reference.model';

describe('parsePullRequestUrl', () => {
  it('extrai owner, repositoryName e pullRequestNumber de uma URL válida', () => {
    expect(
      parsePullRequestUrl('https://github.com/acme/widgets/pull/42'),
    ).toEqual({
      owner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
    });
  });

  it('aceita http e ignora querystring/fragment/barra final', () => {
    expect(
      parsePullRequestUrl('http://github.com/acme/widgets/pull/42/'),
    ).toEqual({
      owner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
    });
    expect(
      parsePullRequestUrl('https://github.com/acme/widgets/pull/42?diff=split'),
    ).toEqual({
      owner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
    });
    expect(
      parsePullRequestUrl('https://github.com/acme/widgets/pull/42#files'),
    ).toEqual({
      owner: 'acme',
      repositoryName: 'widgets',
      pullRequestNumber: 42,
    });
  });

  it('aceita hífens e pontos no owner/repo', () => {
    expect(
      parsePullRequestUrl('https://github.com/my-org/my.repo/pull/7'),
    ).toEqual({
      owner: 'my-org',
      repositoryName: 'my.repo',
      pullRequestNumber: 7,
    });
  });

  it('rejeita URL vazia ou não-string', () => {
    expect(() => parsePullRequestUrl('')).toThrow(/obrigatória/);
    expect(() => parsePullRequestUrl(undefined as unknown as string)).toThrow(
      /obrigatória/,
    );
  });

  it('rejeita URLs de issues ou domínios errados', () => {
    expect(() =>
      parsePullRequestUrl('https://github.com/acme/widgets/issues/42'),
    ).toThrow(/inválida/);
    expect(() =>
      parsePullRequestUrl('https://gitlab.com/acme/widgets/pull/42'),
    ).toThrow(/inválida/);
    expect(() => parsePullRequestUrl('not a url')).toThrow(/inválida/);
  });

  it('rejeita número de PR não positivo', () => {
    expect(() =>
      parsePullRequestUrl('https://github.com/acme/widgets/pull/0'),
    ).toThrow();
  });
});
