import { InternalServerErrorException } from '@nestjs/common';

export function extractJsonPayload(
  rawResponse: string,
  emptyResponseMessage = 'O provider de IA retornou resposta vazia.',
  invalidJsonMessage = 'Não foi possível extrair JSON da resposta do provider de IA.',
): unknown {
  const trimmedResponse = rawResponse.trim();

  if (!trimmedResponse) {
    throw new InternalServerErrorException(emptyResponseMessage);
  }

  const directlyParsedJson = tryParseJson(trimmedResponse);
  if (directlyParsedJson !== undefined) {
    return directlyParsedJson;
  }

  const fencedJsonMatch = trimmedResponse.match(
    /```(?:json)?\s*([\s\S]*?)```/i,
  );
  if (fencedJsonMatch) {
    const fencedJsonPayload = tryParseJson(fencedJsonMatch[1].trim());
    if (fencedJsonPayload !== undefined) {
      return fencedJsonPayload;
    }
  }

  const firstOpeningBraceIndex = trimmedResponse.indexOf('{');
  const lastClosingBraceIndex = trimmedResponse.lastIndexOf('}');

  if (
    firstOpeningBraceIndex !== -1 &&
    lastClosingBraceIndex > firstOpeningBraceIndex
  ) {
    const inlineJsonPayload = tryParseJson(
      trimmedResponse.slice(firstOpeningBraceIndex, lastClosingBraceIndex + 1),
    );

    if (inlineJsonPayload !== undefined) {
      return inlineJsonPayload;
    }
  }

  throw new InternalServerErrorException(invalidJsonMessage);
}

function tryParseJson(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}
