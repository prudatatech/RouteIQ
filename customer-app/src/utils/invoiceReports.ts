import type { InvoiceReport } from '../services/api';
import type { Tone } from '../components/ui';

/** The seven ways a customer can say they paid, as the server accepts them. */
export const REPORT_METHODS = ['upi', 'neft', 'rtgs', 'imps', 'cheque', 'cash', 'other'] as const;
export type ReportMethod = (typeof REPORT_METHODS)[number];

/** The pill for a report: a locale key and a tone. A payment waits for confirmation, a question for a reply. */
export function reportStatus(report: Pick<InvoiceReport, 'kind' | 'status'>): { labelKey: string; tone: Tone } {
  const labelKey = `report_status_${report.kind}_${report.status}`;
  if (report.status === 'confirmed' || report.status === 'answered') return { labelKey, tone: 'success' };
  if (report.status === 'rejected') return { labelKey, tone: 'danger' };
  return { labelKey, tone: 'warning' };
}

/** The India calendar day (YYYY-MM-DD) of an ISO instant, or null. */
export function istDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kolkata' }).format(date);
}
