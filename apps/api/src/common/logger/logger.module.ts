import { Global, Module } from '@nestjs/common';
import { ErrorEmailService } from './error-email.service';

@Global()
@Module({
  providers: [ErrorEmailService],
  exports:   [ErrorEmailService],
})
export class LoggerModule {}
