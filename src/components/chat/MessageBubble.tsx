import type { UIMessage } from 'ai';
import { getPlanOutput } from './planPart';
import { JourneyPlanCard } from './JourneyPlanCard';

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
        }`}
      >
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <p key={index} className="whitespace-pre-wrap text-sm">
                {part.text}
              </p>
            );
          }

          const planOutput = getPlanOutput(part);
          if (planOutput) {
            const { plan, narration } = planOutput;
            return (
              <div key={index} className="flex flex-col gap-2">
                <p className="whitespace-pre-wrap text-sm">{narration}</p>
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
