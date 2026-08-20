import { ChatInput } from './ChatInput';

const EXAMPLES = [
  'Ooty to Srivilliputhur tonight',
  'Coimbatore to Madurai tomorrow morning',
  'Trichy to Madurai now',
  'Chennai to Tirunelveli via Trichy',
];

export function Hero({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-7 px-4 py-16 sm:py-20">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span aria-hidden="true" lang="ta" className="text-[0.9375rem] tracking-[0.05em] text-accent">
          வழிகாட்டி
        </span>
        <h1 className="max-w-lg text-[1.75rem] leading-tight font-semibold tracking-tight text-ink sm:text-[2.25rem]">
          Which bus gets you there — <span className="text-signal">and will you make it?</span>
        </h1>
        <p className="max-w-md text-[0.9375rem] leading-relaxed text-ink-muted">
          Ask in Tamil, Hindi, Telugu, or English, the way you&apos;d ask a friend.
        </p>
      </div>

      <div className="w-full max-w-xl">
        <ChatInput variant="hero" disabled={false} onSend={onSend} />
      </div>

      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onSend(example)}
            className="rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
