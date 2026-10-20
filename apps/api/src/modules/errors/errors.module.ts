import { Module } from '@nestjs/common';
import { ErrorsController } from './errors.controller';

// ErrorEmailService comes from the @Global() LoggerModule. Re-providing it here created a second
// instance (second SMTP transport, second startup log, and a separate de-duplication window).
@Module({
  controllers: [ErrorsController],
})
export class ErrorsModule {}
