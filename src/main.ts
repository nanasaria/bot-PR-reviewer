import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

const SWAGGER_PATH = 'docs';

async function bootstrap() {
  const application = await NestFactory.create(AppModule);

  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PR Review Bot')
    .setDescription(
      'API que recebe a URL de um Pull Request do GitHub e publica reviews automatizadas usando Claude CLI com fallback local para Ollama.',
    )
    .setVersion('1.0.0')
    .addTag('pr-review', 'Review inicial automatizada de Pull Requests')
    .addTag(
      're-review',
      'Re-review automatizada limitada ao escopo dos comentários anteriores do reviewer configurado',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(
    application,
    swaggerConfig,
  );
  SwaggerModule.setup(SWAGGER_PATH, application, swaggerDocument, {
    swaggerOptions: { persistAuthorization: true },
  });

  const configService = application.get(ConfigService);
  const httpPort = configService.get<number>('PORT') ?? 3081;

  await application.listen(httpPort);
  Logger.log(
    `PR Review Bot ouvindo em http://localhost:${httpPort}`,
    'Bootstrap',
  );
  Logger.log(
    `Swagger disponível em http://localhost:${httpPort}/${SWAGGER_PATH}`,
    'Bootstrap',
  );
}

void bootstrap();
