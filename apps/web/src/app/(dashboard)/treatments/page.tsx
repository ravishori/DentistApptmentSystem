'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { treatmentsApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, Plus, Stethoscope, X, ChevronDown, ChevronUp, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

function TreatmentCard({ plan }: { plan: any }) {
  const [expanded, setExpanded] = useState(false);
  const completedCount = plan.items?.filter((i: any) => i.isCompleted).length ?? 0;
  const totalCount = plan.items?.length ?? 0;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
              <Stethoscope className="w-5 h-5 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{plan.planTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {plan.patient?.fullName} · Dr. {plan.dentist?.fullName}
                  </p>
                  {plan.diagnosis && (
                    <p className="text-xs text-slate-400 italic mt-1">{plan.diagnosis}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={statusVariant(plan.status)} className="capitalize mb-1.5">
                    {plan.status?.replace(/_/g, ' ')}
                  </Badge>
                  <p className="text-sm font-bold text-slate-800">
                    {formatCurrency(plan.totalEstimatedCost ?? 0)}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              {totalCount > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-400">Progress</span>
                    <span className="text-[11px] font-medium text-slate-600">
                      {completedCount}/{totalCount} items · {pct}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {totalCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-3 ml-13 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              {expanded ? (
                <><ChevronUp className="w-3 h-3" /> Hide items</>
              ) : (
                <><ChevronDown className="w-3 h-3" /> Show {totalCount} items</>
              )}
            </button>
          )}
        </div>

        {expanded && totalCount > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/50">
            {plan.items.map((item: any, idx: number) => (
              <div
                key={item.id}
                className={cn(
                  'flex items-center justify-between px-5 py-2.5 text-sm',
                  idx !== plan.items.length - 1 && 'border-b border-slate-100',
                )}
              >
                <div className="flex items-center gap-2.5">
                  {item.isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
                  )}
                  <span className={cn(
                    'text-slate-700',
                    item.isCompleted && 'line-through text-slate-400',
                  )}>
                    {item.description}
                  </span>
                  {item.toothNumber && (
                    <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                      T#{item.toothNumber}
                    </span>
                  )}
                </div>
                <span className="text-slate-600 font-medium shrink-0 ml-3">
                  {formatCurrency(item.estimatedCost ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TreatmentsPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['treatments', search],
    queryFn: () => treatmentsApi.list({ search: search || undefined, limit: 50 }),
  });

  const filtered = (data ?? []).filter((p: any) =>
    !search ||
    p.planTitle?.toLowerCase().includes(search.toLowerCase()) ||
    p.patient?.fullName?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <Header
        title="Treatment Plans"
        subtitle="Manage patient treatment plans"
        actions={
          <Button size="sm">
            <Plus className="w-3.5 h-3.5" />
            New Plan
          </Button>
        }
      />

      <div className="page-content">
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Plans', value: data?.filter((p: any) => p.status === 'in_progress').length ?? 0, color: 'text-blue-600 bg-blue-50' },
            { label: 'Completed', value: data?.filter((p: any) => p.status === 'completed').length ?? 0, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Pending Acceptance', value: data?.filter((p: any) => p.status === 'presented').length ?? 0, color: 'text-orange-600 bg-orange-50' },
            { label: 'Total Value', value: formatCurrency(data?.reduce((s: number, p: any) => s + (p.totalEstimatedCost ?? 0), 0) ?? 0), color: 'text-purple-600 bg-purple-50' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className={`text-xl font-bold ${s.color.split(' ')[0]}`}>{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by plan title or patient name…"
          icon={<Search className="w-4 h-4" />}
          className="max-w-sm"
        />

        {/* Plans list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-24" /></CardContent></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Stethoscope className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">
                {search ? `No plans matching "${search}"` : 'No treatment plans yet'}
              </p>
              {!search && (
                <Button variant="outline" size="sm" className="mt-3">
                  <Plus className="w-3.5 h-3.5" /> Create first plan
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((plan: any) => (
              <TreatmentCard key={plan.id} plan={plan} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
