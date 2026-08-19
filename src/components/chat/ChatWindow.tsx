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
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6 sm:gap-4 sm:px-6">
        {messages.length === 0 && (
          <div className="my-auto flex flex-col items-center gap-3 px-2 py-10 text-center">
            <span
              aria-hidden="true"
              className="h-px w-10 bg-line-strong"
            />
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-balance text-ink-muted">
              Ask about a journey — e.g. &quot;How do I get from Ooty to Srivilliputhur tonight?&quot;
            </p>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {status === 'submitted' && (
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
            />
            Thinking…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[0.8125rem] leading-snug text-danger"
          >
            Something went wrong: {error.message}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        disabled={status === 'submitted' || status === 'streaming'}
        onSend={(text) => sendMessage({ text })}
      />
    </div>
  );
}
