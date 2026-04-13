import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const application = await NestFactory.create(AppModule);

  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = application.get(ConfigService);
  const httpPort = configService.get<number>('PORT') ?? 3081;

  await application.listen(httpPort);
  Logger.log(
    `PR Review Bot ouvindo em http://localhost:${httpPort}`,
    'Bootstrap',
  );
}

void bootstrap();
