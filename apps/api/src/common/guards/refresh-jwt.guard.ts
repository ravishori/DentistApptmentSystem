import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Applied only to the /auth/refresh endpoint. */
@Injectable()
export class RefreshJwtGuard extends AuthGuard('jwt-refresh') {}
