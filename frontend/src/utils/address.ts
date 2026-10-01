/**
 * An address as two lines: the place name, then the rest of the address without the name again.
 * Places arrive as a name ("Fab Hostels") and a full address ("Fab Hostels, Kanakapura Main Road, ...");
 * printing both repeats the name.
 */
export interface PlaceLines {
  /** The first line: the place name, or the whole address when there is no name. */
  primary: string
  /** The second line, or null when it would only repeat the first. */
  secondary: string | null
}

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
const fold = (v: string) => v.toLowerCase().replace(/[\s,.-]+$/g, '')

/** The address without a leading copy of `name` ("Fab Hostels, Kanakapura Rd" with "Fab Hostels" gives "Kanakapura Rd"). */
export function stripLeadingName(name: string | null | undefined, address: string | null | undefined): string {
  const n = clean(name)
  const a = clean(address)
  if (!n || !a) return a
  if (fold(a) === fold(n)) return ''
  if (a.toLowerCase().startsWith(n.toLowerCase())) {
    const rest = a.slice(n.length)
    // Only a whole leading name: it must end at a separator, not in the middle of a word.
    if (/^\s*[,;:\-–—]/.test(rest)) return rest.replace(/^[\s,;:\-–—]+/, '')
  }
  return a
}

export function placeLines(name: string | null | undefined, address: string | null | undefined): PlaceLines | null {
  const n = clean(name)
  const a = clean(address)
  if (!n && !a) return null
  if (!n) return { primary: a, secondary: null }
  const rest = stripLeadingName(n, a)
  return { primary: n, secondary: rest || null }
}

/** One line: "Fab Hostels, Kanakapura Main Road" for text that cannot take two lines. */
export function formatAddress(name: string | null | undefined, address: string | null | undefined): string {
  const lines = placeLines(name, address)
  if (!lines) return ''
  return lines.secondary ? `${lines.primary}, ${lines.secondary}` : lines.primary
}
