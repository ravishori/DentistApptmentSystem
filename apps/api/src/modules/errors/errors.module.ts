import { Module } from '@nestjs/common';
import { ErrorsController } from './errors.controller';
import { ErrorEmailService } from '../../common/logger/error-email.service';

@Module({
  controllers: [ErrorsController],
  providers:   [ErrorEmailService],
  exports:     [ErrorEmailService],
})
export class ErrorsModule {}
