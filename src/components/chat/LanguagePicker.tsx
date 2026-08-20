// Latin-script codes, not native script — a pill has to stay legible as a
// clickable label on any device, including ones without Indic fonts
// installed; the native scripts get their moment elsewhere on the page.
const LANGUAGES = [
  { code: '', label: 'Auto', short: 'Auto' },
  { code: 'ta', label: 'Tamil', short: 'TA' },
  { code: 'hi', label: 'Hindi', short: 'HI' },
  { code: 'te', label: 'Telugu', short: 'TE' },
  { code: 'en', label: 'English', short: 'EN' },
] as const;

/**
 * A row of pill toggles for the voice-input language, rather than a
 * native <select> — reads as one deliberate choice among a short list
 * (like the example-prompt pills on the hero) instead of a form control.
 * `compact` trades the full names for two-letter codes, for the composer
 * bar that sits above a message every time rather than once on the hero.
 */
export function LanguagePicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (code: string) => void;
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Spoken language for voice input" className="flex flex-wrap items-center gap-1.5">
      {LANGUAGES.map((lang) => {
        const active = lang.code === value;
        return (
          <button
            key={lang.code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(lang.code)}
            title={lang.label}
            className={`shrink-0 rounded-full border font-mono uppercase tracking-[0.06em] transition-colors ${
              compact ? 'px-2 py-0.5 text-[0.625rem]' : 'px-2.5 py-1 text-[0.6875rem]'
            } ${
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {compact ? lang.short : lang.label}
          </button>
        );
      })}
    </div>
  );
}
