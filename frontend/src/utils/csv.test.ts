import { describe, expect, it, vi, afterEach } from 'vitest'
import { toCsv, downloadCsv } from './csv'

describe('toCsv', () => {
  it('writes the header row from column headers, not keys', () => {
    const csv = toCsv([], [{ key: 'trackingId', header: 'Tracking ID' }, { key: 'status', header: 'Status' }])
    expect(csv).toBe('Tracking ID,Status')
  })

  it('joins rows with CRLF', () => {
    const csv = toCsv(
      [{ id: 'A1', status: 'Delivered' }, { id: 'A2', status: 'Pending' }],
      [{ key: 'id', header: 'ID' }, { key: 'status', header: 'Status' }],
    )
    expect(csv).toBe('ID,Status\r\nA1,Delivered\r\nA2,Pending')
  })

  it('quotes fields containing a comma', () => {
    const csv = toCsv([{ place: 'Mumbai, MH' }], [{ key: 'place', header: 'Place' }])
    expect(csv).toBe('Place\r\n"Mumbai, MH"')
  })

  it('quotes fields containing a quote and doubles the internal quote', () => {
    const csv = toCsv([{ note: 'She said "hello"' }], [{ key: 'note', header: 'Note' }])
    expect(csv).toBe('Note\r\n"She said ""hello"""')
  })

  it('quotes fields containing a newline', () => {
    const csv = toCsv([{ note: 'Line one\nLine two' }], [{ key: 'note', header: 'Note' }])
    expect(csv).toBe('Note\r\n"Line one\nLine two"')
  })

  it('passes ISO dates through unquoted', () => {
    const csv = toCsv([{ created_at: '2026-09-29T10:00:00.000Z' }], [{ key: 'created_at', header: 'Created at' }])
    expect(csv).toBe('Created at\r\n2026-09-29T10:00:00.000Z')
  })

  it('renders null and undefined values as empty fields', () => {
    const csv = toCsv([{ a: null, b: undefined }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }])
    expect(csv).toBe('A,B\r\n,')
  })

  it('returns only the header row for empty input', () => {
    const csv = toCsv([], [{ key: 'a', header: 'A' }])
    expect(csv).toBe('A')
  })
})

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a UTF-8 CSV blob with a BOM and triggers a download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })

    const clickSpy = vi.fn()
    const anchor = { download: '', href: '', click: clickSpy } as unknown as HTMLAnchorElement
    const appendChild = vi.fn()
    const removeChild = vi.fn()
    const createElement = vi.fn(() => anchor)
    Object.assign(globalThis, {
      document: { createElement, body: { appendChild, removeChild } },
    })

    downloadCsv('shipments-2026-09-29.csv', 'A,B\r\n1,2')

    expect(createElement).toHaveBeenCalledWith('a')
    expect(anchor.download).toBe('shipments-2026-09-29.csv')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv;charset=utf-8;')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // UTF-8 BOM (EF BB BF) followed by the CSV bytes.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder('utf-8').decode(bytes)).toBe('A,B\r\n1,2')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    // @ts-expect-error cleanup the stub
    delete globalThis.document
  })
})
