import type { UIMessage } from 'ai';
import { getPlanOutput, foundPlans } from './planPart';
import { JourneyPlanCard } from './JourneyPlanCard';

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`vk-rise flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-ink shadow-sm'
            : 'max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-surface-raised px-4 py-2.5 text-ink sm:max-w-[85%]'
        }
      >
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <p key={index} className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">
                {part.text}
              </p>
            );
          }

          const planOutput = getPlanOutput(part);
          if (planOutput) {
            const plans = foundPlans(planOutput);
            return (
              <div key={index} className="flex flex-col gap-3">
                <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{planOutput.narration}</p>
                {plans.map((plan, planIndex) => (
                  <div key={planIndex} className="flex flex-col gap-1.5">
                    {plans.length > 1 && (
                      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-muted">
                        Option {planIndex + 1}
                      </span>
                    )}
                    <JourneyPlanCard plan={plan} />
                  </div>
                ))}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
