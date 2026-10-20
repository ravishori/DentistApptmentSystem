import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

export interface ApiResponse<T> {
  success:   boolean;
  data:      T;
  timestamp: string;
  path:      string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => ({
        success:   true,
        data,
        timestamp: new Date().toISOString(),
        path:      req.url,
      })),
    );
  }
}
