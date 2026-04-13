import { OllamaService } from './ollama.service';

describe('OllamaService', () => {
  const originalFetch = global.fetch;

  const buildService = (
    overrides: Partial<Record<string, string | number>> = {},
  ): OllamaService => {
    const configServiceMock = {
      get: jest.fn((key: string) => {
        const defaultValues: Record<string, string | number> = {
          OLLAMA_API_BASE_URL: 'http://ollama.local',
          OLLAMA_MODEL: 'qwen3-coder:30b',
          OLLAMA_TIMEOUT_MS: 180000,
        };

        return overrides[key] ?? defaultValues[key];
      }),
    };

    return new OllamaService(configServiceMock as never);
  };

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('envia prompt ao Ollama e valida a resposta', async () => {
    const ollamaService = buildService({
      OLLAMA_API_BASE_URL: 'http://ollama.local/api',
      OLLAMA_TIMEOUT_MS: 120000,
    });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest
        .fn()
        .mockResolvedValue(
          '{"message":{"content":"{\\"decision\\":\\"COMMENT\\",\\"body\\":\\"ok\\",\\"issues\\":[],\\"confidence\\":\\"medium\\"}"}}',
        ),
    } as never);

    await expect(ollamaService.runReview('analise este PR')).resolves.toEqual({
      decision: 'COMMENT',
      body: 'ok',
      issues: [],
      confidence: 'medium',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.local/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? '{}'),
    ).toEqual({
      model: 'qwen3-coder:30b',
      format: 'json',
      stream: false,
      messages: [{ role: 'user', content: 'analise este PR' }],
    });
  });

  it('lança erro claro quando não consegue conectar ao Ollama', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Falha ao conectar ao Ollama (qwen3-coder:30b): connect ECONNREFUSED',
    );
  });

  it('lança erro claro para resposta HTTP inválida com corpo JSON', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('{"error":"model not found"}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama retornou HTTP 503: model not found',
    );
  });

  it('lança erro claro para resposta HTTP inválida com corpo texto puro', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('erro bruto'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama retornou HTTP 500: erro bruto',
    );
  });

  it('lança erro quando o corpo da resposta não é JSON válido', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('nao-e-json'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Resposta inválida do Ollama',
    );
  });

  it('lança erro quando o Ollama não retorna conteúdo em message.content', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('{"message":{}}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama não retornou conteúdo na mensagem.',
    );
  });

  it('lança erro quando o JSON retornado não passa no schema de review', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest
        .fn()
        .mockResolvedValue('{"message":{"content":"{\\"body\\":\\"ok\\"}"}}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Resposta inválida do Ollama',
    );
  });
});
