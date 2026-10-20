import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import configuration from './config/configuration';
import { validateEnv } from './config/validate-env';
import { PrismaModule } from './prisma/prisma.module';
import { AppCacheModule } from './cache/cache.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantIsolationGuard } from './common/guards/tenant-isolation.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

import { EncryptionModule } from './common/encryption/encryption.module';
import { LoggerModule } from './common/logger/logger.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClinicModule } from './modules/clinic/clinic.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BillingModule } from './modules/billing/billing.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ErrorsModule } from './modules/errors/errors.module';
import { EhrModule } from './modules/ehr/ehr.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ClinicManagementModule } from './modules/clinic-management/clinic-management.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SanitizationMiddleware } from './common/middleware/sanitization.middleware';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal:   true,
      envFilePath: '../../.env',
      load:       [configuration],
      validate:   validateEnv,   // production fails closed on weak/placeholder secrets
    }),

    // ── Rate limiting ────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // ── Event bus ───────────────────────────────────────────────────────────
    EventEmitterModule.forRoot({ wildcard: false }),

    // ── Bull / Redis queue ───────────────────────────────────────────────────
    BullModule.forRootAsync({
      inject:     [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        redis: {
          host:     cfg.get<string>('redis.host'),
          port:     cfg.get<number>('redis.port'),
          password: cfg.get<string>('redis.password'),
        },
      }),
    }),

    // ── Infrastructure (global) ──────────────────────────────────────────────
    PrismaModule,
    AppCacheModule,
    EncryptionModule,
    LoggerModule,

    // ── Feature modules ──────────────────────────────────────────────────────
    AuthModule,
    ClinicModule,
    PatientsModule,
    AppointmentsModule,
    BillingModule,
    WhatsappModule,
    NotificationsModule,
    ErrorsModule,
    EhrModule,
    PrescriptionsModule,
    DocumentsModule,
    ClinicManagementModule,
    AnalyticsModule,
  ],

  providers: [
    // Global rate-limit guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global guards (order matters — JWT first, then isolation, then roles, then permissions)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantIsolationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },

    // Global exception filter
    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    // Global interceptors (response shape + request logging + audit trail)
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Sanitize all incoming request bodies (SQL injection, XSS, NoSQL injection)
    consumer
      .apply(SanitizationMiddleware)
      .forRoutes('*');

    // TenantMiddleware: resolves + validates clinic context on every route
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'v1/auth/register', method: RequestMethod.POST },
        { path: 'v1/auth/login',    method: RequestMethod.POST },
        { path: 'v1/auth/refresh',  method: RequestMethod.POST },
        { path: 'v1/errors/client', method: RequestMethod.POST },
        { path: 'v1/whatsapp/webhook/(.*)', method: RequestMethod.GET },
        { path: 'v1/whatsapp/webhook/(.*)', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
