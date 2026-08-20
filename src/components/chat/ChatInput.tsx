'use client';

import { useState } from 'react';
import { ArrowUp01Icon } from 'hugeicons-react';
import { MicButton } from './MicButton';
import { LanguagePicker } from './LanguagePicker';

/**
 * `hero`: the large centered composer shown before the first message.
 * `bar`: the compact composer pinned under an active transcript.
 * Both keep the language picker in its own row above the input — sharing
 * a row with the textarea is what wrapped everything into a tangle on a
 * narrow phone screen.
 */
type Variant = 'hero' | 'bar';

export function ChatInput({
  disabled,
  onSend,
  variant = 'bar',
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  variant?: Variant;
}) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('');

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  const hasText = text.trim().length > 0;
  const isHero = variant === 'hero';

  return (
    <div className={isHero ? 'flex w-full flex-col items-center gap-3' : 'flex w-full flex-col gap-2'}>
      {!isHero && <LanguagePicker value={language} onChange={setLanguage} compact />}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={
          isHero
            ? 'flex w-full items-end gap-2 rounded-3xl border border-line bg-surface-raised p-2.5 pl-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_60px_-20px_rgba(0,0,0,0.7)]'
            : 'flex w-full items-end gap-2 rounded-2xl border border-line bg-surface-raised p-2 pl-3.5'
        }
      >
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
          placeholder="Ask about a journey — e.g. Ooty to Srivilliputhur tonight"
          className={`field-sizing-content max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent text-ink placeholder:text-ink-faint focus:outline-none ${
            isHero ? 'py-1.5 text-[1rem]' : 'py-1 text-[0.9375rem]'
          }`}
        />
        {hasText ? (
          <button
            type="submit"
            disabled={disabled}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp01Icon size={18} strokeWidth={2} />
          </button>
        ) : (
          <MicButton language={language} onTranscribed={(transcribed) => setText(transcribed)} />
        )}
      </form>
      {isHero && <LanguagePicker value={language} onChange={setLanguage} />}
    </div>
  );
}
