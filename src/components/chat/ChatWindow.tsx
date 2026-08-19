'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

const STORAGE_KEY = 'vazhikaati-chat-history';

function loadStoredMessages(): UIMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function ChatWindow() {
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage after mount only — reading it during the
  // initial render would make the client's first render diverge from the
  // server-rendered (window-less) markup and trigger a hydration mismatch.
  useEffect(() => {
    const stored = loadStoredMessages();
    if (stored.length > 0) setMessages(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            Ask about a journey — e.g. &quot;How do I get from Ooty to Srivilliputhur tonight?&quot;
          </p>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {status === 'submitted' && <p className="text-sm text-zinc-500">Thinking…</p>}
        {error && <p className="text-sm text-red-600">Something went wrong: {error.message}</p>}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        disabled={status === 'submitted' || status === 'streaming'}
        onSend={(text) => sendMessage({ text })}
      />
    </div>
  );
}
