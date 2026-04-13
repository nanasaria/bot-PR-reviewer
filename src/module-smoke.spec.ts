describe('module smoke tests', () => {
  const originalGitHubToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    jest.resetModules();
    process.env.GITHUB_TOKEN = 'github-token';
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalGitHubToken;
  });

  it('expõe os módulos principais da aplicação', () => {
    jest.isolateModules(() => {
      const { AppModule } =
        jest.requireActual<typeof import('./app.module')>('./app.module');
      const { PrReviewModule } = jest.requireActual<
        typeof import('./modules/pr-review/pr-review.module')
      >('./modules/pr-review/pr-review.module');
      const { GitHubModule } = jest.requireActual<
        typeof import('./modules/github/github.module')
      >('./modules/github/github.module');
      const { ClaudeCliModule } = jest.requireActual<
        typeof import('./modules/claude-cli/claude-cli.module')
      >('./modules/claude-cli/claude-cli.module');
      const { OllamaModule } = jest.requireActual<
        typeof import('./modules/ollama/ollama.module')
      >('./modules/ollama/ollama.module');

      expect(AppModule).toBeDefined();
      expect(PrReviewModule).toBeDefined();
      expect(GitHubModule).toBeDefined();
      expect(ClaudeCliModule).toBeDefined();
      expect(OllamaModule).toBeDefined();
    });
  });
});
