import type { UIMessage } from 'ai';
import { getPlanOutput } from './planPart';
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
            const { plan, narration } = planOutput;
            return (
              <div key={index} className="flex flex-col gap-3">
                <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{narration}</p>
                {plan && plan.found && <JourneyPlanCard plan={plan} />}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
