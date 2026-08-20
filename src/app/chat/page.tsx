import { ChatWindow } from '../../components/chat/ChatWindow';

export default function ChatPage() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-surface">
      <header className="shrink-0 border-b border-line px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-baseline gap-2.5">
          <h1 className="text-[1.0625rem] font-semibold leading-none tracking-[-0.02em] text-ink">
            VazhiKaatti
          </h1>
          <span aria-hidden="true" lang="ta" className="text-[0.8125rem] tracking-[0.05em] text-accent">
            வழிகாட்டி
          </span>
        </div>
      </header>
      <ChatWindow />
    </div>
  );
}
