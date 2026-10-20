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
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-blue-900 via-blue-700 to-teal-600 flex-col justify-between p-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-white/5" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-800/30" />
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
          <p className="text-blue-200 text-lg leading-relaxed max-w-sm">
            Appointments, billing, patient CRM, and WhatsApp automation — all in one place.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-4">
            {[
              { label: 'Clinics', value: '500+' },
              { label: 'Appointments', value: '2M+' },
              { label: 'Uptime', value: '99.9%' },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 backdrop-blur rounded-xl p-3 text-center">
                <p className="text-white font-bold text-xl">{s.value}</p>
                <p className="text-blue-200 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-blue-300 text-sm">
          © 2024 DentalEase · Trusted by dentists across India
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900">DentalEase</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
            <p className="text-slate-500 text-sm mt-1">Sign in to your clinic dashboard</p>
          </div>

          {serverError && (
            <div className="border border-red-300 bg-red-50 rounded-lg p-3 text-sm">
              <div className="font-semibold text-red-800">
                {serverError.status ? `Error ${serverError.status}` : 'Connection error'}
              </div>
              <div className="text-red-700 mt-1">{serverError.message}</div>
              {process.env.NODE_ENV === 'development' && serverError.detail && (
                <details className="mt-2">
                  <summary className="text-xs text-red-600 cursor-pointer">Show response</summary>
                  <pre className="mt-1 text-[11px] bg-red-100 p-2 rounded overflow-auto max-h-40">
                    {serverError.detail}
                  </pre>
                </details>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <Input
                {...register('email')}
                type="email"
                placeholder="doctor@clinic.com"
                className={errors.email ? 'border-red-400 focus:border-red-400' : ''}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Password</label>
                <a href="/forgot-password" className="text-xs text-blue-600 hover:underline">
                  Forgot password?
                </a>
              </div>
              <Input
                {...register('password')}
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                className={errors.password ? 'border-red-400' : ''}
                iconRight={
                  <button type="button" onClick={() => setShowPw(!showPw)} className="p-0.5">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
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
              <span className="bg-white px-3 text-xs text-slate-400">New to DentalEase?</span>
            </div>
          </div>

          <Button variant="outline" className="w-full h-11" asChild>
            <a href="/register">Create clinic account — it&apos;s free</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
