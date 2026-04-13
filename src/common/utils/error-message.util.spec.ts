import { getErrorMessage } from './error-message.util';

describe('getErrorMessage', () => {
  it('retorna a mensagem quando recebe um Error', () => {
    expect(getErrorMessage(new Error('falha inesperada'))).toBe(
      'falha inesperada',
    );
  });

  it('retorna a própria string quando recebe texto', () => {
    expect(getErrorMessage('erro em texto puro')).toBe('erro em texto puro');
  });

  it('serializa objetos simples em JSON', () => {
    expect(getErrorMessage({ status: 'error', code: 500 })).toBe(
      '{"status":"error","code":500}',
    );
  });

  it('retorna mensagem padrão quando não consegue serializar', () => {
    const circularObject: Record<string, unknown> = {};
    circularObject.self = circularObject;

    expect(getErrorMessage(circularObject)).toBe('Erro desconhecido');
  });
});
