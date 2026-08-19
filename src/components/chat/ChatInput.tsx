'use client';

import { useState } from 'react';
import { MicButton } from './MicButton';
import { LanguagePicker } from './LanguagePicker';

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid grid-cols-[auto_1fr_auto] items-end gap-x-2 gap-y-2.5 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:grid-cols-[auto_auto_1fr_auto] sm:px-6"
    >
      {/* Mobile stacks the composer into two rows with the mic running down
          the left edge; from sm up everything sits on a single line. */}
      <div className="col-start-1 row-span-2 row-start-1 self-end sm:row-span-1">
        <MicButton language={language} onTranscribed={(transcribed) => setText(transcribed)} />
      </div>
      <div className="col-span-2 col-start-2 row-start-1 justify-self-start sm:col-span-1 sm:self-end">
        <LanguagePicker value={language} onChange={setLanguage} />
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about a journey…"
        className="col-start-2 row-start-2 max-h-40 min-h-11 w-full resize-none rounded-2xl border border-line bg-surface-raised px-3.5 py-2.5 text-[0.9375rem] leading-snug text-ink placeholder:text-ink-faint field-sizing-content sm:col-start-3 sm:row-start-1"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="col-start-3 row-start-2 h-11 rounded-2xl bg-accent px-4 text-[0.9375rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:col-start-4 sm:row-start-1"
      >
        Send
      </button>
    </form>
  );
}
