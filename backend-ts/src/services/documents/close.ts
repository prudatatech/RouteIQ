/**
 * margixindia — Closing a trip: the settlement is final, the balance is fixed in paise, and the trip closure
 * report is written. Needs a final proof of delivery; without one the close is refused.
 */
import { z } from 'zod';
import { HttpError } from '../../core/errors';
import { requireCarrier, type LoadAccess } from './context';
import { parseBody } from './schemas';
import { assertFinalPod } from './pod';
import { upsertClosureDocument } from './generate';
import { auditSettlement, computeBalance, openSettlement, saveSettlement, settlementView, type SettlementView } from './settlement';

const closeBody = z.object({ payment_status: z.enum(['pending', 'partial', 'paid']).optional() }).optional().default({});

export async function closeSettlement(access: LoadAccess, raw: unknown): Promise<SettlementView & { trip_closure_document_id: string }> {
  requireCarrier(access);
  const body = parseBody(closeBody, raw);
  const current = await openSettlement(access);
  const podId = await assertFinalPod(access);
  if (current.agreed_freight <= 0) throw new HttpError(409, 'Agree the freight before closing the trip');
  const balance = computeBalance(current);
  const row = await saveSettlement(access, current, {
    status: 'closed',
    closed_at: new Date().toISOString(),
    closed_by: access.userId,
    pod_document_id: podId,
    payment_status: body.payment_status ?? (balance <= 0 ? 'paid' : 'pending'),
  });
  const closure = await upsertClosureDocument(access, row);
  await auditSettlement(access, 'trip_closed', { settlement_id: row.id, balance_paise: balance, pod_document_id: podId, closure_document_id: closure.id });
  return { ...settlementView(row), trip_closure_document_id: closure.id };
}
