'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Zap } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<{ status?: number; message: string; detail?: string } | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setLoading(true);
    setServerError(null);
    try {
      const result = await authApi.login(data.email, data.password);
      setAuth(result.user, result.clinic ?? result.tenant, result.accessToken, result.refreshToken);
      toast.success(`Welcome back, ${result.user.fullName}!`);
      router.push('/dashboard');
    } catch (err: any) {
      const status = err.response?.status;
      const body   = err.response?.data;
      const message = !err.response
        ? `Cannot reach API at ${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}. Is it running?`
        : body?.message
          ? (Array.isArray(body.message) ? body.message.join(', ') : body.message)
          : `Login failed (HTTP ${status})`;
      setServerError({ status, message, detail: JSON.stringify(body, null, 2) });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] bg-sidebar text-sidebar-foreground flex-col justify-between p-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20" />
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">DentalEase</span>
        </div>

        <div className="relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur rounded-full px-4 py-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-white text-sm font-medium">WhatsApp-First Platform</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight">
            Manage your clinic<br />the smart way
          </h2>
          <p className="text-sidebar-muted text-lg leading-relaxed max-w-sm">
            Appointments, billing, patient CRM, and WhatsApp automation — all in one place.
          </p>

        </div>

        <p className="relative z-10 text-sidebar-muted text-sm">
          DentalEase · Clinic management platform
        </p>
      </div>

      {/* Right panel — form */}
      <main id="main-content" className="flex flex-1 items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900">DentalEase</span>
          </div>

          <div>
            <h1 className="font-display text-display text-foreground">Welcome back</h1>
            <p className="text-slate-500 text-sm mt-1">Sign in to your clinic dashboard</p>
          </div>

          {serverError && (
            <Alert variant="destructive" title={serverError.status ? `Error ${serverError.status}` : 'Connection error'}>
              {serverError.message}
              {process.env.NODE_ENV === 'development' && serverError.detail && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">Show response</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">
                    {serverError.detail}
                  </pre>
                </details>
              )}
            </Alert>
          )}

          <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label className="label">Email address</label>
              <Input
                {...register('email')}
                type="email"
                placeholder="doctor@clinic.com"
                error={!!errors.email}
              />
              {errors.email && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Password</label>
              </div>
              <Input
                {...register('password')}
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                error={!!errors.password}
                iconRight={
                  <button type="button" onClick={() => setShowPw(!showPw)} className="rounded p-0.5" aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              {errors.password && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" className="w-full h-11 text-base" loading={loading}>
              Sign in
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-xs text-muted-foreground">New to DentalEase?</span>
            </div>
          </div>

          <Button variant="outline" className="w-full h-11" asChild>
            <a href="/register">Create clinic account — it&apos;s free</a>
          </Button>
        </div>
      </main>
    </div>
  );
}
