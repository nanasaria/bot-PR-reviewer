import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  GITHUB_PULL_REQUEST_URL_PATTERN,
  GITHUB_PULL_REQUEST_URL_VALIDATION_MESSAGE,
} from './pull-request-reference.model';

export class ReviewPrRequestModel {
  @Transform(({ value }: TransformFnParams) => normalizePullRequestUrl(value))
  @IsString({ message: 'prUrl deve ser uma string.' })
  @IsNotEmpty({ message: 'prUrl é obrigatória.' })
  @Matches(GITHUB_PULL_REQUEST_URL_PATTERN, {
    message: GITHUB_PULL_REQUEST_URL_VALIDATION_MESSAGE,
  })
  prUrl!: string;
}

function normalizePullRequestUrl(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
