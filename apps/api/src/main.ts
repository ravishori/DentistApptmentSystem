import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
    // Required for raw body access in Razorpay webhook signature checks
    rawBody: true,
  });

  const config = app.get(ConfigService);

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin:      [config.get<string>('WEB_URL') ?? 'http://localhost:3000', 'http://localhost:3000'],
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Routing ────────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  // ── Validation ─────────────────────────────────────────────────────────────
  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,   // strip unknown properties
    forbidNonWhitelisted: false,  // don't throw on extras (use whitelist instead)
    transform:            true,   // auto-cast query params
    transformOptions:     { enableImplicitConversion: true },
  }));

  // ── Swagger ────────────────────────────────────────────────────────────────
  const swaggerDoc = new DocumentBuilder()
    .setTitle('DentalEase API')
    .setDescription('WhatsApp-first dental clinic automation platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth')
    .addTag('Clinic')
    .addTag('Patients')
    .addTag('Appointments')
    .addTag('Billing')
    .addTag('WhatsApp')
    .addTag('Notifications')
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerDoc),
    { swaggerOptions: { persistAuthorization: true } },
  );

  const port = config.get<number>('API_PORT') ?? 3001;
  await app.listen(port);

  console.log(`\n🦷  DentalEase API  →  http://localhost:${port}/api/v1`);
  console.log(`📖  Swagger docs    →  http://localhost:${port}/api/docs\n`);
}

bootstrap();
