'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { appointmentsApi, usersApi } from '@/lib/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Calendar, Clock } from 'lucide-react';
import { ModalBehavior } from '@/components/ui/modal-behavior';

interface Props { onClose: () => void; defaultDate?: string; }

const APPT_TYPES = [
  'consultation', 'cleaning', 'filling', 'extraction',
  'root_canal', 'crown', 'braces', 'followup', 'emergency',
];

export function BookAppointmentModal({ onClose, defaultDate }: Props) {
  const qc = useQueryClient();
  const [selectedDentist, setSelectedDentist] = useState('');
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? '');
  const { register, handleSubmit, formState: { errors } } = useForm();

  const { data: dentists } = useQuery({
    queryKey: ['dentists'],
    queryFn: usersApi.dentists,
  });

  const { data: slots, isLoading: slotsLoading } = useQuery({
    queryKey: ['slots', selectedDentist, selectedDate],
    queryFn: () => appointmentsApi.slots(selectedDentist, selectedDate),
    enabled: !!(selectedDentist && selectedDate),
  });

  const book = useMutation({
    mutationFn: (dto: any) => appointmentsApi.book(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Appointment booked! WhatsApp confirmation will be sent.');
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Booking failed'),
  });

  const onSubmit = (data: any) => {
    book.mutate({ ...data, dentistId: selectedDentist, date: selectedDate, bookedVia: 'web' });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Book Appointment" className="fixed inset-0 z-50 flex items-center justify-center p-4"><ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <Card className="relative w-full max-w-lg shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Book Appointment</CardTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring rounded">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label">Patient ID *</label>
              <Input
                {...register('patientId', { required: true })}
                placeholder="Patient UUID or code"
                error={!!errors.patientId}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Dentist *</label>
                <select
                  className="input-base w-full"
                  value={selectedDentist}
                  onChange={(e) => setSelectedDentist(e.target.value)}
                  required
                >
                  <option value="">Select dentist</option>
                  {dentists?.map((d: any) => (
                    <option key={d.id} value={d.id}>Dr. {d.fullName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Date *</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  required
                  icon={<Calendar className="w-3.5 h-3.5" />}
                />
              </div>
            </div>

            <div>
              <label className="label">Time Slot *</label>
              <select
                {...register('startTime', { required: true })}
                className="input-base w-full"
              >
                <option value="">
                  {slotsLoading ? 'Loading slots…' : 'Choose a time slot'}
                </option>
                {slots?.map((s: any) => (
                  <option key={s.id} value={s.startTime}>
                    {s.startTime?.slice(0, 5)} – {s.endTime?.slice(0, 5)}
                  </option>
                ))}
              </select>
              {slots?.length === 0 && selectedDentist && selectedDate && !slotsLoading && (
                <p className="text-xs text-orange-500 mt-1">No available slots for this date</p>
              )}
            </div>

            <div>
              <label className="label">Appointment Type *</label>
              <select
                {...register('type', { required: true })}
                className="input-base w-full"
              >
                {APPT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Chief Complaint</label>
              <Input
                {...register('chiefComplaint')}
                placeholder="e.g. Toothache upper right (optional)"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" loading={book.isPending}>
                Book Appointment
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
