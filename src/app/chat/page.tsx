import { ChatWindow } from '../../components/chat/ChatWindow';

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col h-full w-full max-w-2xl mx-auto bg-surface sm:border-x sm:border-line">
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[1.35rem] font-semibold leading-none tracking-[-0.02em] text-ink">
            VazhiKaatti
          </h1>
          <span
            aria-hidden="true"
            lang="ta"
            className="text-[0.8125rem] tracking-[0.05em] text-accent"
          >
            வழிகாட்டி
          </span>
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-muted">
          Ask about a bus journey, in Tamil, Hindi, Telugu, or English.
        </p>
      </header>
      <ChatWindow />
    </div>
  );
}
