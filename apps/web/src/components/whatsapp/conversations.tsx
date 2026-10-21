import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/** The API answers { items: [...], total, page, limit }; each item has patientPhone, lastMessageAt, patient?.fullName and the latest message. */
export function toConversationRows(payload: unknown) {
  const items = Array.isArray(payload) ? payload : Array.isArray((payload as { items?: unknown })?.items) ? (payload as { items: any[] }).items : [];
  return items.map((c: any) => ({
    id: String(c.id),
    title: c.patient?.fullName ?? c.patientName ?? c.patientPhone ?? c.phone ?? 'Unknown contact',
    preview: c.messages?.[0]?.content ?? c.lastMessage ?? '',
    at: c.lastMessageAt ?? c.messages?.[0]?.createdAt ?? null,
  }));
}

export function ConversationsList({ rows }: { rows: ReturnType<typeof toConversationRows> }) {
  return (
    <div className="space-y-2">
      {rows.map((conv) => (
        <Card key={conv.id} className="hover:shadow-sm transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">{conv.title}</p>
              <p className="text-xs text-slate-400 truncate mt-0.5">{conv.preview}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-400">{conv.at ? new Date(conv.at).toLocaleString('en-IN') : ''}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ConversationsEmpty() {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <MessageCircle className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">No conversations yet</p>
        <p className="text-xs text-slate-400 mt-1">Inbound WhatsApp messages from patients appear here</p>
      </CardContent>
    </Card>
  );
}
