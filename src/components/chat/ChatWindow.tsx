'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { Hero } from './Hero';
import { ProblemsSection } from './ProblemsSection';
import { AboutPanel } from './AboutPanel';

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
  // Guards the persistence effect from writing before hydration has run —
  // without this, the persistence effect's first commit (messages === [])
  // races the hydration effect and can momentarily overwrite stored history
  // right before the real data lands.
  const hydratedRef = useRef(false);

  // Hydrate from localStorage after mount only — reading it during the
  // initial render would make the client's first render diverge from the
  // server-rendered (window-less) markup and trigger a hydration mismatch.
  useEffect(() => {
    const stored = loadStoredMessages();
    if (stored.length > 0) setMessages(stored);
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    // Skip mid-stream writes — persist once a turn settles rather than on
    // every streamed token, which is both wasteful and unnecessary (a
    // refresh mid-stream just loses the in-flight reply, same as today).
    if (status === 'streaming') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (err) {
      console.error('Failed to persist chat history to localStorage:', err);
    }
  }, [messages, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const disabled = status === 'submitted' || status === 'streaming';

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Hero onSend={(text) => sendMessage({ text })} />
        <ProblemsSection />
        <AboutPanel />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-6 sm:gap-4 sm:px-6">
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <ChatInput variant="bar" disabled={disabled} onSend={(text) => sendMessage({ text })} />
      </div>
    </div>
  );
}
