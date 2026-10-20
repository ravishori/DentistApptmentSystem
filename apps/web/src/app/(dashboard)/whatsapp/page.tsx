'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { whatsappApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageCircle, Zap, Send, CheckCircle2, Clock, X, Users,
  ChevronRight, Megaphone, Bot, Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── Static data ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    name: 'appointment_confirmation',
    display: 'Appointment Confirmation',
    category: 'Appointment',
    body: 'Hi {{1}}, your appointment with Dr. {{2}} is confirmed for {{3}} at {{4}} at {{5}}. Reply CANCEL to cancel.',
    status: 'approved',
  },
  {
    name: 'appointment_reminder_24h',
    display: '24-Hour Reminder',
    category: 'Appointment',
    body: 'Hi {{1}}, reminder: your appointment with Dr. {{2}} is tomorrow {{3}} at {{4}}. See you at {{5}}! Reply 1 to confirm or 2 to reschedule.',
    status: 'approved',
  },
  {
    name: 'appointment_reminder_2h',
    display: '2-Hour Reminder',
    category: 'Appointment',
    body: 'Hi {{1}}, your appointment is in 2 hours at {{2}}. Please arrive 5 minutes early. – {{3}}',
    status: 'approved',
  },
  {
    name: 'invoice_payment_link',
    display: 'Invoice Payment Link',
    category: 'Billing',
    body: 'Hi {{1}}, your invoice {{2}} for ₹{{3}} is ready. Pay securely: {{4}}. Valid for 48 hours.',
    status: 'approved',
  },
  {
    name: 'appointment_followup',
    display: 'Post-Visit Follow-up',
    category: 'Appointment',
    body: 'Hi {{1}}, hope you\'re feeling better after your visit with Dr. {{2}}. On a scale of 1-5, how would you rate your experience?',
    status: 'approved',
  },
  {
    name: 'reactivation',
    display: 'Re-activation (3 months)',
    category: 'Marketing',
    body: 'Hi {{1}}, we miss you at {{2}}! It\'s been a while since your last visit. Book your check-up today — reply BOOK to get started.',
    status: 'approved',
  },
];

const FLOWS = [
  { trigger: 'appointment_booked', description: 'Send confirmation immediately on booking', icon: CheckCircle2, active: true },
  { trigger: 'reminder_48h', description: 'Send reminder 48 hours before appointment', icon: Clock, active: true },
  { trigger: 'reminder_24h', description: 'Send reminder with quick-action buttons 24h before', icon: Clock, active: true },
  { trigger: 'appointment_completed', description: 'Send follow-up + rating request 24h after visit', icon: MessageCircle, active: true },
  { trigger: 'appointment_cancelled', description: 'Notify patient of cancellation + rebook prompt', icon: X, active: true },
  { trigger: 'invoice_sent', description: 'Send Razorpay payment link via WhatsApp', icon: Send, active: true },
];

// ── Broadcast Modal ────────────────────────────────────────────────────────────
function BroadcastModal({ onClose }: { onClose: () => void }) {
  const [audience, setAudience] = useState<'all' | 'inactive_90d' | 'outstanding_balance' | 'custom'>('all');
  const [templateName, setTemplateName] = useState(TEMPLATES[0].name);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await whatsappApi.broadcast({ audience, templateName });
      toast.success('Broadcast campaign queued');
      onClose();
    } catch {
      toast.error('Failed to send broadcast');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-md shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">New Broadcast Campaign</CardTitle>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="label">Audience</label>
            <div className="space-y-2">
              {[
                { value: 'all', label: 'All patients with WhatsApp opt-in', desc: 'Everyone in your CRM' },
                { value: 'inactive_90d', label: 'Inactive (90+ days)', desc: 'Patients with no visit in 3 months' },
                { value: 'outstanding_balance', label: 'Outstanding balance', desc: 'Patients with unpaid invoices' },
              ].map((opt) => (
                <label key={opt.value}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                    audience === opt.value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50',
                  )}>
                  <input type="radio" name="audience" value={opt.value}
                    checked={audience === opt.value}
                    onChange={() => setAudience(opt.value as any)}
                    className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{opt.label}</p>
                    <p className="text-xs text-slate-400">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Template</label>
            <select
              className="input-base w-full"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            >
              {TEMPLATES.filter((t) => t.category === 'Marketing' || t.category === 'Appointment').map((t) => (
                <option key={t.name} value={t.name}>{t.display}</option>
              ))}
            </select>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-800 font-medium">WhatsApp Business Policy</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Only send to opted-in patients. Marketing messages require a 24h session window or approved template.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" loading={sending} onClick={handleSend}>
              <Megaphone className="w-3.5 h-3.5" />
              Send Campaign
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Conversations stub ─────────────────────────────────────────────────────────
function ConversationsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['wa-conversations'],
    queryFn: whatsappApi.conversations,
  });

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}><CardContent className="p-4"><Skeleton className="h-12" /></CardContent></Card>
      ))}
    </div>
  );

  if (!data?.length) return (
    <Card>
      <CardContent className="py-16 text-center">
        <MessageCircle className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">No active conversations</p>
        <p className="text-xs text-slate-400 mt-1">Inbound WhatsApp messages from patients appear here</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-2">
      {data.map((conv: any) => (
        <Card key={conv.id} className="cursor-pointer hover:shadow-sm transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{conv.patientName ?? conv.phone}</p>
              <p className="text-xs text-slate-400 truncate mt-0.5">{conv.lastMessage}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-400">{conv.lastMessageAt}</p>
              {conv.unread > 0 && (
                <span className="mt-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  {conv.unread}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WhatsappPage() {
  const [tab, setTab] = useState<'flows' | 'templates' | 'conversations'>('flows');
  const [showBroadcast, setShowBroadcast] = useState(false);

  return (
    <div>
      <Header
        title="WhatsApp Automation"
        subtitle="Powered by Twilio WhatsApp Business API"
        actions={
          <Button size="sm" onClick={() => setShowBroadcast(true)}>
            <Megaphone className="w-3.5 h-3.5" />
            New Campaign
          </Button>
        }
      />

      <div className="page-content">
        {/* Status banner */}
        <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Automation Engine Active</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                All flows are running. Messages fire automatically on system events and respect patient opt-in.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="flows" className="gap-1.5">
              <Bot className="w-3.5 h-3.5" /> Automation Flows
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" /> Templates
            </TabsTrigger>
            <TabsTrigger value="conversations" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> Conversations
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Flows */}
        {tab === 'flows' && (
          <div className="space-y-2">
            {FLOWS.map((f) => (
              <Card key={f.trigger}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                      <f.icon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {f.trigger.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </p>
                      <p className="text-xs text-slate-400">{f.description}</p>
                    </div>
                  </div>
                  <Badge variant="success" className="shrink-0 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Templates */}
        {tab === 'templates' && (
          <div className="space-y-3">
            {TEMPLATES.map((t) => (
              <Card key={t.name}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{t.display}</p>
                      <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                      <Badge variant="success" className="text-[10px]">{t.status}</Badge>
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <p className="text-xs text-slate-600 font-mono leading-relaxed whitespace-pre-wrap">{t.body}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Conversations */}
        {tab === 'conversations' && <ConversationsTab />}
      </div>

      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
    </div>
  );
}
