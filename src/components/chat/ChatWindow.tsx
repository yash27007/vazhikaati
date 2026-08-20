'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { Hero } from './Hero';

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
  // The landing page hands its hero query off as `/chat?q=...` rather than
  // sending it directly — it has no useChat instance of its own. True for
  // exactly the render(s) before that handoff is consumed below, so the
  // empty state can skip straight past the Hero flash into "loading".
  const [pendingFromQuery] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('q'),
  );

  // Hydrate from localStorage after mount only — reading it during the
  // initial render would make the client's first render diverge from the
  // server-rendered (window-less) markup and trigger a hydration mismatch.
  useEffect(() => {
    const stored = loadStoredMessages();
    if (stored.length > 0) setMessages(stored);
    hydratedRef.current = true;

    const query = new URLSearchParams(window.location.search).get('q');
    if (query && query.trim()) {
      sendMessage({ text: query });
      // Drop `?q=` from the address bar so a refresh or back-navigation
      // doesn't resend the same query as a duplicate message.
      window.history.replaceState(null, '', '/chat');
    }
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

  // A query handed off from the landing hero is about to become the first
  // message — render nothing rather than flash the (redundant) chat-page
  // Hero for the one tick before that send lands.
  if (messages.length === 0 && pendingFromQuery) {
    return <div className="min-h-0 flex-1" />;
  }

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Hero onSend={(text) => sendMessage({ text })} />
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
