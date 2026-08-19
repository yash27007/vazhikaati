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
      className="flex items-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800"
    >
      <MicButton language={language} onTranscribed={(transcribed) => setText(transcribed)} />
      <LanguagePicker value={language} onChange={setLanguage} />
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
        className="flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
