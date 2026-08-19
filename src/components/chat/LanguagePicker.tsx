const LANGUAGES = [
  { code: '', label: 'Auto' },
  { code: 'ta', label: 'Tamil' },
  { code: 'hi', label: 'Hindi' },
  { code: 'te', label: 'Telugu' },
  { code: 'en', label: 'English' },
] as const;

export function LanguagePicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-full border border-line bg-surface-raised px-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:border-line-strong sm:h-11"
      aria-label="Spoken language for voice input"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
