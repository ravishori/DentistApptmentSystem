import {
  Controller, Post, Body, HttpCode, HttpStatus, Ip, Headers, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { ErrorEmailService } from '../../common/logger/error-email.service';
import { winstonLogger } from '../../common/logger/winston.logger';
import { v4 as uuid } from 'uuid';

class ClientErrorDto {
  @IsString()   message!:    string;
  @IsOptional() @IsString()  stack?:     string;
  @IsOptional() @IsString()  componentStack?: string;
  @IsOptional() @IsIn(['error','warning','fatal'])  level?:    string;
  @IsOptional() @IsString()  context?:   string;
  @IsOptional()              extra?:     Record<string, unknown>;
  @IsOptional() @IsString()  url?:       string;
  @IsOptional() @IsString()  userAgent?: string;
  @IsOptional() @IsString()  timestamp?: string;
}

@ApiTags('Errors')
@Controller({ path: 'errors', version: '1' })
export class ErrorsController {
  private readonly logger = new Logger(ErrorsController.name);

  constructor(private readonly emailService: ErrorEmailService) {}

  @Post('client')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive and log a frontend client error' })
  async receiveClientError(
    @Body()    dto:       ClientErrorDto,
    @Ip()      ip:        string,
    @Headers('user-agent') ua: string,
  ) {
    const eventId = uuid();

    // Persist to Winston log
    winstonLogger.error('Client-side error', {
      eventId,
      message:   dto.message,
      stack:     dto.stack,
      componentStack: dto.componentStack,
      level:     dto.level ?? 'error',
      context:   dto.context,
      url:       dto.url,
      userAgent: dto.userAgent ?? ua,
      ip,
      extra:     dto.extra,
    });

    // Email alert for fatal/error level (not warnings)
    if (dto.level !== 'warning') {
      await this.emailService.sendAlert({
        subject: `[Frontend ${dto.level ?? 'error'}] ${dto.message.slice(0, 80)}`,
        error:   { message: dto.message, stack: dto.stack, name: 'ClientError' } as Error,
        context: dto.context ?? 'Frontend',
        request: { ip, url: dto.url },
        extra:   { componentStack: dto.componentStack, ...dto.extra },
      });
    }

    return { eventId };
  }
}
