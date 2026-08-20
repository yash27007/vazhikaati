import { ChatWindow } from '../../components/chat/ChatWindow';
import { AboutPanel } from '../../components/chat/AboutPanel';

export default function ChatPage() {
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto bg-surface lg:flex-row lg:overflow-hidden lg:border-x lg:border-line">
      <div className="flex min-h-0 flex-1 flex-col lg:h-full lg:min-w-0">
        <header className="border-b border-line px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[1.35rem] font-semibold leading-none tracking-[-0.02em] text-ink">
              VazhiKaatti
            </h1>
            <span aria-hidden="true" lang="ta" className="text-[0.8125rem] tracking-[0.05em] text-accent">
              வழிகாட்டி
            </span>
          </div>
          <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-muted">
            Ask about a bus journey, in Tamil, Hindi, Telugu, or English.
          </p>
        </header>
        <ChatWindow />
      </div>

      <div aria-hidden="true" className="vk-perforation hidden w-px shrink-0 lg:block" />

      {/* Desktop: a standing sidebar. Mobile: tucked behind a disclosure below
          the chat, so the primary task loads first on a small screen. */}
      <aside className="hidden w-[22rem] shrink-0 overflow-y-auto lg:block lg:h-full">
        <AboutPanel />
      </aside>
      <details className="border-t border-line lg:hidden">
        <summary className="cursor-pointer select-none px-4 py-3 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-ink-muted">
          About this app
        </summary>
        <AboutPanel />
      </details>
    </div>
  );
}
