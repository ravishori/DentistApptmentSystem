'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { describeApiError } from '@/lib/api-error';
import { clinicApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Building2, Clock, MessageCircle, Users, Shield, Save, Eye, EyeOff, Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppearanceSettings } from '@/components/settings/appearance-settings';
import { useAuth } from '@/lib/auth';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType; title: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
            <Icon className="w-4 h-4 text-slate-600" />
          </div>
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [showApiKey, setShowApiKey] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['clinic-profile'],
    queryFn: clinicApi.getProfile,
  });

  const [profile, setProfile] = useState<any>(null);
  const [hours, setHours] = useState<any>(null);
  const [whatsapp, setWhatsapp] = useState<any>(null);

  // Sync local state once data loads
  const profile_ = profile ?? data;
  const hours_ = hours ?? data?.settings?.workingHours ?? {};
  const whatsapp_ = whatsapp ?? { number: data?.whatsappNumber ?? '', apiKey: '' };

  const updateProfile = useMutation({
    mutationFn: (dto: any) => clinicApi.update(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-profile'] });
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(describeApiError(e, 'Failed to save')),
  });

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (updateProfile.isPending) return;           // double-submit protection
    updateProfile.mutate({
      clinicName: profile_?.clinicName,
      phone: profile_?.phone,
      email: profile_?.email,
      address: profile_?.address,
      city: profile_?.city,
      gstNumber: profile_?.gstNumber,
    });
  };

  const handleHoursSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (updateProfile.isPending) return;
    updateProfile.mutate({ settings: { workingHours: hours_ } });
  };

  const handleWhatsappSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (updateProfile.isPending) return;
    updateProfile.mutate({
      whatsappNumber: whatsapp_.number,
      ...(whatsapp_.apiKey ? { waApiKey: whatsapp_.apiKey } : {}),
    });
  };

  const setField = (setter: any, field: string, val: string) =>
    setter((prev: any) => ({ ...(prev ?? {}), [field]: val }));

  // Appearance is a local, per-browser preference: it never depends on the clinic profile request, so it stays
  // available while that request is loading or has failed.
  const appearance = (
    <Section icon={Palette} title="Appearance & Personalisation">
      <AppearanceSettings />
    </Section>
  );

  if (isLoading) return (
    <div>
      <Header title="Settings" subtitle="Clinic configuration" />
      <div className="page-content max-w-2xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}><CardContent className="p-5"><Skeleton className="h-32" /></CardContent></Card>
        ))}
        {appearance}
      </div>
    </div>
  );

  // A failed profile load must NOT fall through to the editable form: it would show blank fields that look like real
  // settings, and saving them would overwrite the clinic's profile with empty values.
  if (isError && !data) return (
    <div>
      <Header title="Settings" subtitle="Clinic configuration" />
      <div className="page-content max-w-2xl">
        <Card><CardContent>
          <ErrorState title="Could not load the clinic settings" error={error} onRetry={() => { void refetch(); }} retrying={isFetching} />
        </CardContent></Card>
        {appearance}
      </div>
    </div>
  );

  return (
    <div>
      <Header title="Settings" subtitle="Clinic configuration" />

      <div className="page-content max-w-2xl">
        {/* Plan badge */}
        <div className="flex items-center gap-2">
          <Badge variant="default" className="capitalize">{tenant?.plan ?? 'pro'} Plan</Badge>
          <span className="text-xs text-slate-400">·</span>
          <span className="text-xs text-slate-400">{data?.clinicName}</span>
        </div>

        {appearance}

        {/* Clinic Profile */}
        <Section icon={Building2} title="Clinic Profile">
          <form onSubmit={handleProfileSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Clinic Name</label>
                <Input
                  value={profile_?.clinicName ?? ''}
                  onChange={(e) => setField(setProfile, 'clinicName', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Phone</label>
                <Input
                  value={profile_?.phone ?? ''}
                  onChange={(e) => setField(setProfile, 'phone', e.target.value)}
                  type="tel"
                />
              </div>
              <div>
                <label className="label">Email</label>
                <Input
                  value={profile_?.email ?? ''}
                  onChange={(e) => setField(setProfile, 'email', e.target.value)}
                  type="email"
                />
              </div>
              <div>
                <label className="label">City</label>
                <Input
                  value={profile_?.city ?? ''}
                  onChange={(e) => setField(setProfile, 'city', e.target.value)}
                />
              </div>
              <div>
                <label className="label">GST Number</label>
                <Input
                  value={profile_?.gstNumber ?? ''}
                  onChange={(e) => setField(setProfile, 'gstNumber', e.target.value)}
                  placeholder="27AAAAA0000A1Z5"
                />
              </div>
              <div className="col-span-2">
                <label className="label">Address</label>
                <Input
                  value={profile_?.address ?? ''}
                  onChange={(e) => setField(setProfile, 'address', e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" size="sm" loading={updateProfile.isPending}>
              <Save className="w-3.5 h-3.5" />
              Save Profile
            </Button>
          </form>
        </Section>

        {/* Working Hours */}
        <Section icon={Clock} title="Working Hours & Appointment Slots">
          <form onSubmit={handleHoursSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'workStart', label: 'Work Start', default: '09:00' },
                { key: 'workEnd', label: 'Work End', default: '18:00' },
                { key: 'breakStart', label: 'Break Start', default: '13:00' },
                { key: 'breakEnd', label: 'Break End', default: '14:00' },
              ].map(({ key, label, default: def }) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <Input
                    type="time"
                    value={hours_?.[key] ?? def}
                    onChange={(e) => setHours((h: any) => ({ ...(h ?? hours_), [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="label">Slot Duration</label>
                <select
                  className="input-base w-full"
                  value={hours_?.slotDuration ?? 30}
                  onChange={(e) => setHours((h: any) => ({ ...(h ?? hours_), slotDuration: parseInt(e.target.value, 10) }))}
                >
                  {[15, 20, 30, 45, 60].map((v) => (
                    <option key={v} value={v}>{v} minutes</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label mb-2">Working Days</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => {
                  const active = hours_?.workingDays?.includes(day) ?? ['monday','tuesday','wednesday','thursday','friday'].includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const current: string[] = hours_?.workingDays ?? DAYS.slice(0, 5);
                        const next = active
                          ? current.filter((d) => d !== day)
                          : [...current, day];
                        setHours((h: any) => ({ ...(h ?? hours_), workingDays: next }));
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition-colors ${
                        active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button type="submit" size="sm" loading={updateProfile.isPending}>
              <Save className="w-3.5 h-3.5" />
              Save Hours
            </Button>
          </form>
        </Section>

        {/* WhatsApp Config */}
        <Section icon={MessageCircle} title="WhatsApp Configuration">
          <form onSubmit={handleWhatsappSave} className="space-y-3">
            <div>
              <label className="label">WhatsApp Business Number</label>
              <Input
                type="tel"
                value={whatsapp_?.number}
                onChange={(e) => setWhatsapp((w: any) => ({ ...(w ?? whatsapp_), number: e.target.value }))}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label className="label">Twilio Auth Token</label>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={whatsapp_?.apiKey}
                onChange={(e) => setWhatsapp((w: any) => ({ ...(w ?? whatsapp_), apiKey: e.target.value }))}
                placeholder="Leave blank to keep existing"
                iconRight={
                  <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="p-0.5">
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              <p className="text-xs text-slate-400 mt-1">
                Found in your Twilio Console → Account Info
              </p>
            </div>
            <Button type="submit" size="sm" loading={updateProfile.isPending}>
              <Save className="w-3.5 h-3.5" />
              Save WhatsApp Config
            </Button>
          </form>
        </Section>

        {/* Account */}
        <Section icon={Shield} title="Account & Security">
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-slate-900">Change Password</p>
                <p className="text-xs text-slate-400">Update your login credentials</p>
              </div>
              <Button variant="outline" size="sm">Change</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-slate-900">Two-Factor Authentication</p>
                <p className="text-xs text-slate-400">Add an extra layer of security</p>
              </div>
              <Button variant="outline" size="sm">Enable</Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-slate-900">Staff & Roles</p>
                <p className="text-xs text-slate-400">Manage your team members</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/settings/staff">Manage →</a>
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
