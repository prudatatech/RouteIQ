import type { Grouped } from '@/types/network'

export interface CompanySection<T> {
  key: string
  /** The company that handed these over; null when the server did not say (a single unnamed section). */
  name: string | null
  items: T[]
}

/**
 * Splits offers or orders into one section per company, the company name being the section header.
 * Uses the server's grouping; an older answer without it is grouped by each item's own `company_name`.
 * Sections left empty by `keep` are dropped.
 */
export function companySections<T extends { company_name?: string | null }>(
  data: Grouped<T> | undefined,
  keep: (item: T) => boolean = () => true,
): CompanySection<T>[] {
  if (!data) return []
  let sections: CompanySection<T>[]
  if (data.companies.length > 0) {
    sections = data.companies.map(c => ({ key: c.org_id, name: c.name, items: c.items.filter(keep) }))
  } else {
    const byName = new Map<string, CompanySection<T>>()
    for (const item of data.items.filter(keep)) {
      const name = item.company_name ?? null
      const key = name ?? ''
      const section = byName.get(key) ?? { key: key || 'all', name, items: [] }
      section.items.push(item)
      byName.set(key, section)
    }
    sections = [...byName.values()]
  }
  return sections.filter(s => s.items.length > 0)
}
