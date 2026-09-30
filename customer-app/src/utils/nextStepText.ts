import type { TranslateFn } from '../hooks/useTranslation';
import { formatMinutes } from './bookingStatus';
import type { NextStep } from './nextStep';
import { formatDate, formatDateTime } from './format';

/** The sentence for a next step, in the customer's language. */
export function nextStepText(step: NextStep, t: TranslateFn): string {
  switch (step.kind) {
    case 'eta':
      return t('next_eta', { time: formatMinutes(step.minutes ?? 0, t) });
    case 'problem':
      return step.revisedEta ? `${step.message} ${t('new_eta', { time: formatDateTime(step.revisedEta) })}` : (step.message ?? t('next_problem_failed'));
    case 'invoice_due':
    case 'invoice_overdue':
      return step.dueDate ? t(`next_${step.kind}`, { date: formatDate(step.dueDate) }) : t(`next_${step.kind}_nodate`);
    default:
      return t(`next_${step.kind}`);
  }
}
