'use client';

import { useRouter } from 'next/navigation';
import { SiteHeader } from '../components/chat/SiteHeader';
import { Hero } from '../components/chat/Hero';
import { ProblemsSection } from '../components/chat/ProblemsSection';
import { AboutPanel } from '../components/chat/AboutPanel';

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-surface">
      <SiteHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Hero onSend={(text) => router.push(`/chat?q=${encodeURIComponent(text)}`)} />
        <ProblemsSection />
        <AboutPanel />
      </div>
    </div>
  );
}
