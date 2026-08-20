import { CalendarBlock02Icon, RouteBlockIcon, Moon01Icon, TranslateIcon } from 'hugeicons-react';
import type { ComponentType } from 'react';

const ITEMS: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  problem: string;
  detail: string;
  fix: string;
}[] = [
  {
    icon: CalendarBlock02Icon,
    problem: 'No timetable you can search',
    detail:
      "Which government bus goes where, and when, lives on paper, on notice boards, in a conductor's memory — not anywhere you can check before you leave home.",
    fix: 'One ledger of every stop and timing, in a form a computer can actually read.',
  },
  {
    icon: RouteBlockIcon,
    problem: 'Connections nobody checked',
    detail:
      "A single-route timetable has nothing to say when no one bus goes all the way — you're left guessing where to change.",
    fix: 'Multi-leg journeys worked out leg by leg, transfers included, up to three route options.',
  },
  {
    icon: Moon01Icon,
    problem: 'Stranded until morning',
    detail:
      'Catch the wrong last bus and you can end up stuck at an unfamiliar stop overnight, with nothing warning you beforehand.',
    fix: 'Every connection is checked for a safe wait — a risky one is flagged, plainly, not softened.',
  },
  {
    icon: TranslateIcon,
    problem: 'Built for English only',
    detail:
      "Most riders don't plan a trip in English — most transit tools assume they do, or bolt on translation as an afterthought.",
    fix: 'Ask in Tamil, Hindi, Telugu, or English — typed or spoken — and the answer comes back the same way.',
  },
];

export function ProblemsSection() {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="font-mono text-[0.75rem] uppercase tracking-[0.16em] text-ink-muted">
          Why this exists
        </h2>
        <p className="mx-auto max-w-md text-[1.0625rem] leading-snug font-medium text-ink">
          Intercity buses in Tamil Nadu move millions of people a day on a system nobody wrote down.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ITEMS.map(({ icon: Icon, problem, detail, fix }) => (
          <div
            key={problem}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised p-5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <h3 className="text-[0.9375rem] font-semibold text-ink">{problem}</h3>
            <p className="text-[0.8125rem] leading-relaxed text-ink-muted">{detail}</p>
            <p className="mt-auto border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-signal">
              {fix}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
