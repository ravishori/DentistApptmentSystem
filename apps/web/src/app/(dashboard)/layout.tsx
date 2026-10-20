'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { SidebarContext } from '@/components/layout/sidebar-context';
import { useAuth } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, []);

  const ctx = useMemo(() => ({ open: sidebarOpen, setOpen: setSidebarOpen }), [sidebarOpen]);

  return (
    <SidebarContext.Provider value={ctx}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <div className="flex min-h-screen bg-background">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main id="main-content" tabIndex={-1} className="flex min-h-screen min-w-0 flex-1 flex-col focus:outline-none md:ml-[260px]">
          <div className="flex-1">{children}</div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
