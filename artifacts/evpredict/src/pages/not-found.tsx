import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="surface w-full max-w-md rounded-xl p-8 text-center">
        <AlertCircle className="mx-auto mb-4 h-8 w-8 text-[hsl(var(--primary))]" />
        <h1 className="text-[20px] font-bold">Сторінку не знайдено</h1>
        <p className="mt-2 text-[12px] text-dim">Такої адреси в застосунку немає.</p>
        <Link href="/dashboard" className="action-secondary mx-auto mt-5 inline-flex">На головну</Link>
      </div>
    </div>
  );
}
