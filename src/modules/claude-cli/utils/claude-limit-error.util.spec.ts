import { InternalServerErrorException } from '@nestjs/common';
import { isClaudeUsageLimitError } from './claude-limit-error.util';

describe('isClaudeUsageLimitError', () => {
  it("retorna true para a mensagem exata you've hit limit", () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException("you've hit limit"),
      ),
    ).toBe(true);
  });

  it('retorna true para variação com apóstrofo tipográfico', () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException('you’ve hit limit'),
      ),
    ).toBe(true);
  });

  it('retorna true para variação com "your limit"', () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException("you've hit your limit"),
      ),
    ).toBe(true);
  });

  it('retorna true para mensagem composta contendo stdout com erro de limite', () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException(
          "Claude CLI retornou código 1: stderr: warning | stdout: you've hit limit",
        ),
      ),
    ).toBe(true);
  });

  it('retorna true para menção genérica de usage limit', () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException('Claude usage limit reached'),
      ),
    ).toBe(true);
  });

  it('retorna false para erros que não são de limite', () => {
    expect(
      isClaudeUsageLimitError(
        new InternalServerErrorException('falha genérica do Claude'),
      ),
    ).toBe(false);
  });
});
