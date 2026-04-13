import { extractJsonPayload } from './json-payload.util';

describe('extractJsonPayload', () => {
  it('extrai JSON quando a resposta já é JSON puro', () => {
    expect(extractJsonPayload('{"decision":"COMMENT","body":"ok"}')).toEqual({
      decision: 'COMMENT',
      body: 'ok',
    });
  });

  it('extrai JSON envolvido por cerca markdown', () => {
    expect(
      extractJsonPayload(
        '```json\n{"decision":"APPROVE","body":"tudo certo"}\n```',
      ),
    ).toEqual({
      decision: 'APPROVE',
      body: 'tudo certo',
    });
  });

  it('extrai JSON embutido em texto livre', () => {
    expect(
      extractJsonPayload(
        'Segue o resultado da análise: {"decision":"REQUEST_CHANGES","body":"corrigir bug"} fim.',
      ),
    ).toEqual({
      decision: 'REQUEST_CHANGES',
      body: 'corrigir bug',
    });
  });

  it('lança erro claro quando a resposta vem vazia', () => {
    expect(() => extractJsonPayload('   ')).toThrow(
      'O provider de IA retornou resposta vazia.',
    );
  });

  it('lança erro claro quando não encontra JSON válido', () => {
    expect(() => extractJsonPayload('sem nenhum json aqui')).toThrow(
      'Não foi possível extrair JSON da resposta do provider de IA.',
    );
  });
});
