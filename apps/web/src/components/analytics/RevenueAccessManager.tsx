'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { revenueApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useRevenueAccess } from './RevenueTrendCard';

/**
 * Clinic-owner control: decide which staff may see revenue analytics.
 * Renders nothing for anyone who is not an owner; the endpoints enforce the same rule server-side.
 */
export function RevenueAccessManager() {
  const qc = useQueryClient();
  const { data: access } = useRevenueAccess();
  const enabled = !!access?.canManage;

  const { data: staff, isLoading } = useQuery({
    queryKey: ['revenue-access-staff'],
    queryFn: revenueApi.listAccess,
    enabled,
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: ({ userId, granted }: { userId: string; granted: boolean }) => revenueApi.setAccess(userId, granted),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['revenue-access-staff'] });
      toast.success(v.granted ? 'Revenue access granted' : 'Revenue access removed');
    },
    onError: () => toast.error('Could not change revenue access'),
  });

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Who can see revenue
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Clinic owners always can. Turn on staff members who should also see revenue analytics for this clinic.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !staff?.length ? (
          <EmptyState title="No other staff yet" className="py-6" />
        ) : (
          <ul className="divide-y divide-border">
            {staff.map((s: { id: string; fullName: string; role: string; hasAccess: boolean }) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{s.fullName}</p>
                  <p className="text-xs capitalize text-muted-foreground">{s.role.replace('_', ' ')}</p>
                </div>
                <Switch
                  aria-label={`Allow ${s.fullName} to see revenue`}
                  checked={s.hasAccess}
                  disabled={toggle.isPending}
                  onCheckedChange={(granted) => toggle.mutate({ userId: s.id, granted })}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
