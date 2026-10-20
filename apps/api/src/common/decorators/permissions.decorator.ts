import { SetMetadata } from '@nestjs/common';

/**
 * Permission tokens follow the pattern  resource:action
 *
 * Examples:
 *   patients:read      — view patient list / detail
 *   patients:write     — create / update patients
 *   appointments:read
 *   appointments:write — book / cancel / reschedule
 *   appointments:manage — generate slots (admin-only op)
 *   billing:read
 *   billing:write      — create invoices, send payment links
 *   treatments:read
 *   treatments:write
 *   whatsapp:send
 *   whatsapp:broadcast
 *   analytics:read
 *   clinic:write       — update clinic settings
 *   users:write        — invite / deactivate staff
 */
export type Permission =
  | 'patients:read'    | 'patients:write'
  | 'appointments:read'| 'appointments:write' | 'appointments:manage'
  | 'billing:read'     | 'billing:write'
  | 'treatments:read'  | 'treatments:write'
  | 'whatsapp:send'    | 'whatsapp:broadcast'
  | 'analytics:read'
  | 'clinic:write'
  | 'users:write';

export const PERMISSIONS_KEY = 'permissions';

/** Declare one or more permissions required to access a route. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
