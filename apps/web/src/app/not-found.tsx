import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-slate-500">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page you are looking for does not exist or has moved.</p>
      <Link href="/dashboard" className="mt-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-slate-50">Go to dashboard</Link>
    </div>
  );
}
