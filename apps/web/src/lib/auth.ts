import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string; fullName: string; email: string; role: string; avatarUrl?: string;
}
interface AuthTenant {
  id: string; slug: string; clinicName: string; plan: string; status: string;
}

interface AuthStore {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  accessToken: string | null;
  setAuth: (user: AuthUser, tenant: AuthTenant, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuth = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      tenant: null,
      accessToken: null,
      setAuth: (user, tenant, accessToken, refreshToken) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        set({ user, tenant, accessToken });
      },
      logout: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, tenant: null, accessToken: null });
      },
      isAuthenticated: () => !!get().accessToken,
    }),
    { name: 'dentalease_auth', partialize: (s) => ({ user: s.user, tenant: s.tenant, accessToken: s.accessToken }) },
  ),
);
