import { ChatWindow } from '../../components/chat/ChatWindow';

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col h-full max-w-2xl w-full mx-auto">
      <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">VazhiKaatti</h1>
        <p className="text-xs text-zinc-500">Ask about a bus journey, in Tamil, Hindi, Telugu, or English.</p>
      </header>
      <ChatWindow />
    </div>
  );
}
