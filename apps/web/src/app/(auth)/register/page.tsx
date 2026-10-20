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
  clinicName: z.string().min(2, 'Clinic name is required'),
  ownerName: z.string().min(2, 'Owner name is required'),
  email:     z.string().email('Enter a valid email'),
  phone:     z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Enter a valid phone (e.g. +919876543210)'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  city:      z.string().optional(),
});
type Form = z.infer<typeof schema>;

export default function RegisterPage() {
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
      const result = await authApi.register(data);
      setAuth(result.user, result.clinic ?? result.tenant, result.accessToken, result.refreshToken);
      toast.success(`Welcome, ${result.user.fullName}! Your clinic is ready.`);
      router.push('/dashboard');
    } catch (err: any) {
      const status = err.response?.status;
      const body   = err.response?.data;
      const message = !err.response
        ? `Cannot reach API at ${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}. Is it running?`
        : body?.message
          ? (Array.isArray(body.message) ? body.message.join(', ') : body.message)
          : `Registration failed (HTTP ${status})`;
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
            <span className="text-white text-sm font-medium">14-day free trial · No credit card</span>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight">
            Set up your clinic<br />in under 2 minutes
          </h2>
          <p className="text-blue-200 text-lg leading-relaxed max-w-sm">
            Get a fully-loaded dental clinic OS with appointments, billing, patient CRM,
            and WhatsApp automation — out of the box.
          </p>

          <ul className="space-y-2 pt-2 text-blue-100 text-sm">
            {[
              'Unlimited patients & appointments during trial',
              'WhatsApp confirmations & reminders',
              'GST-ready invoicing with Razorpay',
              'Multi-doctor scheduling',
            ].map(s => (
              <li key={s} className="flex items-start gap-2">
                <span className="text-emerald-300 mt-1">✓</span>{s}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-blue-300 text-sm">
          © 2024 DentalEase · Trusted by dentists across India
        </p>
      </div>

      {/* Right panel — form */}
      <main id="main-content" className="flex flex-1 items-center justify-center overflow-y-auto bg-background p-6">
        <div className="w-full max-w-sm space-y-6 py-8">
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-900">DentalEase</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">Create your clinic</h1>
            <p className="text-slate-500 text-sm mt-1">Start your 14-day free trial — no card needed</p>
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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
            <div>
              <label className="label">Clinic name</label>
              <Input
                {...register('clinicName')}
                placeholder="Smile Dental Bandra"
                error={!!errors.clinicName}
              />
              {errors.clinicName && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.clinicName.message}</p>}
            </div>

            <div>
              <label className="label">Your full name</label>
              <Input
                {...register('ownerName')}
                placeholder="Dr. Priya Shah"
                error={!!errors.ownerName}
              />
              {errors.ownerName && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.ownerName.message}</p>}
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Phone</label>
                <Input
                  {...register('phone')}
                  placeholder="+919876543210"
                  error={!!errors.phone}
                />
                {errors.phone && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.phone.message}</p>}
              </div>
              <div>
                <label className="label">City</label>
                <Input {...register('city')} placeholder="Mumbai" />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <Input
                {...register('password')}
                type={showPw ? 'text' : 'password'}
                placeholder="At least 8 characters"
                error={!!errors.password}
                iconRight={
                  <button type="button" onClick={() => setShowPw(!showPw)} className="p-0.5">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              {errors.password && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" className="w-full h-11 text-base mt-2" loading={loading}>
              Create my clinic
            </Button>

            <p className="text-xs text-slate-400 text-center pt-1">
              By creating an account you agree to our Terms & Privacy Policy
            </p>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-xs text-muted-foreground">Already have an account?</span>
            </div>
          </div>

          <Button variant="outline" className="w-full h-11" asChild>
            <a href="/login">Sign in instead</a>
          </Button>
        </div>
      </main>
    </div>
  );
}
