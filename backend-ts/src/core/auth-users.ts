/**
 * margixindia — Supabase Auth user lookups shared by sign-in and people management.
 */
import { supabase } from './supabase';

/**
 * Find a Supabase auth.users record by email without loading the whole user
 * base into memory. `supabase.auth.admin.listUsers()` defaults to the first
 * 50 users, so a plain call silently misses any account past that page.
 * Pages through in large batches (bounded) until the email is found.
 */
export async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const perPage = 1000;
  const maxPages = 50; // up to 50,000 users
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u: any) => u.email === email);
    if (match) return { id: match.id };
    if (data.users.length < perPage) break; // last page
  }
  return null;
}
