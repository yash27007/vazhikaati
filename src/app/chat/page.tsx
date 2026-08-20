import { ChatWindow } from '../../components/chat/ChatWindow';
import { SiteHeader } from '../../components/chat/SiteHeader';

export default function ChatPage() {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-surface">
      <SiteHeader />
      <ChatWindow />
    </div>
  );
}
