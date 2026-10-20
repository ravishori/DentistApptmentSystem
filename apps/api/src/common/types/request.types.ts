import { Request } from 'express';
import { UserRole } from '@prisma/client';

/** Shape attached to every authenticated request by JwtStrategy + TenantMiddleware */
export interface AuthenticatedUser {
  id:          string;
  email:       string;
  role:        UserRole;
  clinicId:    string;
  clinicSlug:  string;
  clinicName:  string;
}

export interface AppRequest extends Request {
  user:     AuthenticatedUser;
  clinicId: string;          // shortcut — same as user.clinicId
}
