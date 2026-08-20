const CORRIDORS = [
  { code: '01', route: 'OOTY → SENGOTTAI', note: 'via Tiruppur' },
  { code: '02', route: 'COIMBATORE → MADURAI', note: 'via Tiruppur' },
  { code: '03', route: 'COIMBATORE → SALEM', note: 'via Tiruppur/Erode' },
  { code: '04', route: 'CHENNAI → TIRUNELVELI', note: 'via Trichy' },
  { code: '05', route: 'TRICHY → MADURAI', note: 'direct' },
] as const;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-muted">
      {children}
    </h2>
  );
}

export function AboutPanel() {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="grid gap-8 sm:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-2.5">
          <Eyebrow>Corridors on file</Eyebrow>
          <ol className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface-raised">
            {CORRIDORS.map((c) => (
              <li key={c.code} className="flex items-baseline gap-3 px-3.5 py-2.5">
                <span className="tabular font-mono text-[0.75rem] text-ink-faint">{c.code}</span>
                <span className="flex-1 truncate font-mono text-[0.8125rem] tracking-tight text-ink">
                  {c.route}
                </span>
                <span className="shrink-0 text-[0.75rem] text-ink-muted">{c.note}</span>
              </li>
            ))}
          </ol>
          <p className="text-[0.75rem] leading-relaxed text-ink-faint">
            Plus 548 real SETC routes from Tamil Nadu&apos;s open-data portal — origin and
            destination only, no stops in between.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <Eyebrow>What&apos;s real, what&apos;s not</Eyebrow>
          <dl className="flex flex-col gap-2.5 text-[0.8125rem] leading-snug">
            <div className="flex gap-2.5">
              <dt className="w-24 shrink-0 font-mono text-[0.6875rem] uppercase tracking-wide text-band-safe">
                Real
              </dt>
              <dd className="text-ink-muted">SETC timetable data, and every stop&apos;s coordinates.</dd>
            </div>
            <div className="flex gap-2.5">
              <dt className="w-24 shrink-0 font-mono text-[0.6875rem] uppercase tracking-wide text-band-tight">
                Estimated
              </dt>
              <dd className="text-ink-muted">Mock-corridor travel times, from real road routing.</dd>
            </div>
            <div className="flex gap-2.5">
              <dt className="w-24 shrink-0 font-mono text-[0.6875rem] uppercase tracking-wide text-band-risky">
                Synthetic
              </dt>
              <dd className="text-ink-muted">Mock-corridor schedules and trip numbers.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
