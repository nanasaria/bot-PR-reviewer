import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  type ValidationError,
  validateSync,
} from 'class-validator';

export class EnvironmentConfig {
  @IsOptional()
  @IsInt()
  @Min(1)
  PORT: number = 3081;

  @IsString()
  GITHUB_TOKEN!: string;

  @IsOptional()
  @IsString()
  GITHUB_API_BASE_URL: string = 'https://api.github.com';

  @IsOptional()
  @IsString()
  CLAUDE_COMMAND: string = 'claude';

  @IsOptional()
  @IsString()
  OLLAMA_API_BASE_URL: string = 'http://localhost:11434/api';

  @IsOptional()
  @IsString()
  OLLAMA_MODEL: string = 'qwen3-coder:30b';

  @IsOptional()
  @IsInt()
  @Min(1)
  OLLAMA_TIMEOUT_MS: number = 180000;
}

export function validateEnv(
  rawConfig: Record<string, unknown>,
): EnvironmentConfig {
  const environmentConfig = plainToInstance(EnvironmentConfig, rawConfig, {
    enableImplicitConversion: true,
  });

  const validationErrors = validateSync(environmentConfig, {
    skipMissingProperties: false,
  });

  if (validationErrors.length > 0) {
    const formattedErrors = formatValidationErrors(validationErrors);
    throw new Error(`Configuração de ambiente inválida: ${formattedErrors}`);
  }

  return environmentConfig;
}

function formatValidationErrors(validationErrors: ValidationError[]): string {
  return validationErrors
    .map((validationError) =>
      Object.values(validationError.constraints ?? {}).join(', '),
    )
    .join('; ');
}
