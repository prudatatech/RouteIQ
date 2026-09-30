/**
 * margixindia — A customer's device push token.
 *
 * The customer app registers the Expo push token of the phone after sign-in (and once the customer
 * has agreed to notifications). One phone belongs to one customer: a token already saved for someone
 * else (the phone changed hands, or another customer signed in on it) is moved to the new owner.
 * Sign-out clears it, so the next person on the phone is not sent this customer's news.
 */
import { Expo } from 'expo-server-sdk';
import { HttpError } from '../core/errors';
import { supabase } from '../core/supabase';

/** The column is capped at 200 characters (migration 20260930016100). */
const MAX_TOKEN_LENGTH = 200;

export async function saveCustomerPushToken(customerId: string, token: unknown): Promise<{ registered: true }> {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !Expo.isExpoPushToken(token)) {
    throw new HttpError(400, 'That is not a valid push token');
  }
  const { data: others, error: readError } = await supabase.from('customers').select('id').eq('push_token', token).neq('id', customerId);
  if (readError) throw new Error(`Failed to read push tokens: ${readError.message}`);
  for (const other of others ?? []) {
    await supabase.from('customers').update({ push_token: null }).eq('id', other.id);
  }
  const { data, error } = await supabase.from('customers').update({ push_token: token }).eq('id', customerId).select('id');
  if (error) throw new Error(`Failed to save the push token: ${error.message}`);
  if (!data?.length) throw new HttpError(404, 'Customer not found');
  return { registered: true };
}

export async function clearCustomerPushToken(customerId: string): Promise<{ registered: false }> {
  const { error } = await supabase.from('customers').update({ push_token: null }).eq('id', customerId);
  if (error) throw new Error(`Failed to clear the push token: ${error.message}`);
  return { registered: false };
}
