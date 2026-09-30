/**
 * margixindia — Invoice PDF (GST tax invoice, A4).
 *
 * Renders an InvoiceDetail as it is on record: seller from the company profile, buyer from the vendor
 * or customer, the freight line, the CGST/SGST or IGST split and the total in words. What is not on
 * record is left out or marked "Not recorded"; nothing is filled in. The PDF's built-in font has no
 * rupee sign, so amounts are written "Rs.".
 */
import PDFDocument from 'pdfkit';
import { formatISTDate } from '../core/format';
import type { InvoiceDetail } from './invoice-detail.service';

const INK = '#1d2320';
const MUTED = '#5d6862';
const LINE = '#c9d0ca';
const GREEN = '#1f6b4a';
const RED = '#a4332a';

/** "Rs. 1,25,000.00": PDF amounts always show paise. */
export function pdfMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const METHOD_LABEL: Record<string, string> = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque' };

export function invoiceFileName(inv: Pick<InvoiceDetail, 'invoice_number' | 'id'>): string {
  return `${(inv.invoice_number ?? inv.id).replace(/[^\w.-]+/g, '_')}.pdf`;
}

export function renderInvoicePdf(inv: InvoiceDetail): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 40,
      info: { Title: `Tax invoice ${inv.invoice_number ?? ''}`.trim(), Author: inv.seller.legal_name ?? 'margixindia' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const width = doc.page.width - 80;
    const right = left + width;
    const seller = inv.seller;

    const rule = (y: number) => doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(LINE).stroke();
    const text = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
      const { font, size, color, ...rest } = o;
      doc.font(font ?? 'Helvetica').fontSize(size ?? 9).fillColor(color ?? INK).text(s, x, y, rest);
    };

    // ── Header: seller and document title ─────────────────
    text(seller.legal_name ?? 'Seller name not set', left, 40, { font: 'Helvetica-Bold', size: 15, width: width * 0.62 });
    let y = doc.y + 2;
    const sellerLines = [
      [seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', '),
      seller.gstin ? `GSTIN: ${seller.gstin}${seller.state_name ? ` (${seller.state_name}, code ${seller.state_code})` : ''}` : 'GSTIN: not recorded',
      seller.pan ? `PAN: ${seller.pan}` : '',
      [seller.phone, seller.email].filter(Boolean).join('  |  '),
    ].filter(Boolean);
    for (const l of sellerLines) {
      text(l, left, y, { color: MUTED, width: width * 0.62 });
      y = doc.y + 1;
    }
    text('TAX INVOICE', left + width * 0.62, 40, { font: 'Helvetica-Bold', size: 16, color: GREEN, width: width * 0.38, align: 'right' });
    const statusLabel = inv.status === 'paid' ? 'PAID' : inv.status === 'void' ? 'VOID' : inv.overdue ? `OVERDUE ${inv.days_overdue} DAYS` : 'ISSUED';
    text(statusLabel, left + width * 0.62, 62, { font: 'Helvetica-Bold', size: 11, color: inv.status === 'paid' ? GREEN : inv.status === 'void' || inv.overdue ? RED : MUTED, width: width * 0.38, align: 'right' });
    y = Math.max(y, 84) + 8;
    rule(y);
    y += 10;

    // ── Invoice facts and buyer ───────────────────────────
    const colW = width / 2 - 10;
    const facts: Array<[string, string]> = [
      ['Invoice no.', inv.invoice_number ?? '-'],
      ['Invoice date', inv.issued_at ? formatISTDate(inv.issued_at) : '-'],
      ['Due date', inv.due_date ? formatISTDate(inv.due_date) : '-'],
      ['Currency', 'INR'],
    ];
    if (inv.links.shipment) facts.push(['Shipment', inv.links.shipment.code]);
    if (inv.buyer.state) facts.push(['Place of supply', `${inv.buyer.state} (${inv.buyer.state_code})`]);
    let fy = y;
    for (const [k, v] of facts) {
      text(k, left, fy, { color: MUTED, width: 90 });
      text(v, left + 92, fy, { width: colW - 92 });
      fy = Math.max(doc.y, fy + 12) + 1;
    }

    const bx = left + width / 2 + 10;
    text('Billed to', bx, y, { font: 'Helvetica-Bold', color: MUTED });
    let by = doc.y + 2;
    const b = inv.buyer;
    text(b.name ?? 'Buyer not recorded', bx, by, { font: 'Helvetica-Bold', size: 10, width: colW });
    by = doc.y + 1;
    for (const l of [b.address, b.gstin ? `GSTIN: ${b.gstin}` : 'GSTIN: not registered / not recorded', b.phone, b.email].filter(Boolean) as string[]) {
      text(l, bx, by, { color: MUTED, width: colW });
      by = doc.y + 1;
    }
    y = Math.max(fy, by) + 8;

    // ── Lines table ───────────────────────────────────────
    const cols = [
      { h: 'Description', x: left, w: width * 0.46, a: 'left' as const },
      { h: 'SAC', x: left + width * 0.46, w: width * 0.12, a: 'left' as const },
      { h: 'Qty', x: left + width * 0.58, w: width * 0.06, a: 'right' as const },
      { h: 'Rate', x: left + width * 0.64, w: width * 0.18, a: 'right' as const },
      { h: 'Taxable value', x: left + width * 0.82, w: width * 0.18, a: 'right' as const },
    ];
    doc.rect(left, y, width, 18).fillColor('#eef2ee').fill();
    for (const c of cols) text(c.h, c.x + 4, y + 5, { font: 'Helvetica-Bold', size: 8.5, width: c.w - 8, align: c.a });
    y += 20;
    for (const line of inv.lines) {
      const top = y;
      text(line.description, cols[0].x + 4, top, { width: cols[0].w - 8 });
      const descBottom = doc.y;
      text(line.sac_code ?? 'Not recorded', cols[1].x + 4, top, { width: cols[1].w - 8, color: line.sac_code ? INK : MUTED });
      text(String(line.quantity), cols[2].x + 4, top, { width: cols[2].w - 8, align: 'right' });
      text(pdfMoney(line.unit_price), cols[3].x + 4, top, { width: cols[3].w - 8, align: 'right' });
      text(pdfMoney(line.amount), cols[4].x + 4, top, { width: cols[4].w - 8, align: 'right' });
      y = Math.max(descBottom, top + 12) + 6;
      rule(y);
      y += 6;
    }
    if (inv.goods.length) {
      const goods = inv.goods.map(g => `HSN ${g.hsn_code ?? '-'}${g.description ? ` (${g.description})` : ''}${g.gst_rate != null ? ` @ ${g.gst_rate}%` : ''}`).join('; ');
      text(`Goods carried: ${goods}`, left + 4, y, { color: MUTED, size: 8, width: width - 8 });
      y = doc.y + 8;
    }

    // ── Totals ────────────────────────────────────────────
    const tx = left + width * 0.5;
    const tw = width * 0.5;
    const totalRow = (label: string, value: string, bold = false) => {
      text(label, tx, y, { width: tw * 0.55, font: bold ? 'Helvetica-Bold' : 'Helvetica', size: bold ? 10.5 : 9 });
      text(value, tx + tw * 0.55, y, { width: tw * 0.45, align: 'right', font: bold ? 'Helvetica-Bold' : 'Helvetica', size: bold ? 10.5 : 9 });
      y += bold ? 17 : 13;
    };
    totalRow('Taxable value', pdfMoney(inv.amount));
    const t = inv.tax;
    if (t.basis === 'intra') {
      totalRow(`CGST @ ${t.rate / 2}%`, pdfMoney(t.cgst));
      totalRow(`SGST @ ${t.rate / 2}%`, pdfMoney(t.sgst));
    } else if (t.basis === 'inter') {
      totalRow(`IGST @ ${t.rate}%`, pdfMoney(t.igst));
    } else if (t.basis === 'unknown') {
      totalRow(`GST @ ${t.rate}%`, pdfMoney(t.total));
    } else {
      totalRow('GST', 'None charged');
    }
    rule(y);
    y += 5;
    totalRow('Total', pdfMoney(inv.total), true);
    y += 2;
    text(`Amount in words: ${inv.total_in_words}`, left, y, { font: 'Helvetica-Bold', width });
    y = doc.y + 6;
    if (t.note) {
      text(t.note, left, y, { color: MUTED, size: 8, width });
      y = doc.y + 6;
    }

    // ── Payment ───────────────────────────────────────────
    y += 4;
    rule(y);
    y += 8;
    if (inv.status === 'paid') {
      const paid = [
        `Paid${inv.paid_at ? ` on ${formatISTDate(inv.paid_at)}` : ''}`,
        inv.payment_method ? `by ${METHOD_LABEL[inv.payment_method] ?? inv.payment_method}` : '',
        inv.payment_reference ? `(ref. ${inv.payment_reference})` : '',
      ].filter(Boolean).join(' ');
      text(paid, left, y, { font: 'Helvetica-Bold', color: GREEN, width });
      y = doc.y + 6;
    } else if (inv.status === 'void') {
      text(`This invoice was voided${inv.voided_at ? ` on ${formatISTDate(inv.voided_at)}` : ''}${inv.void_reason ? `: ${inv.void_reason}` : ''}.`, left, y, { font: 'Helvetica-Bold', color: RED, width });
      y = doc.y + 6;
    } else {
      text('Pay by bank transfer, UPI, cash or cheque, quoting the invoice number.', left, y, { width });
      y = doc.y + 3;
      const bank = [
        seller.bank_name ? `Bank: ${seller.bank_name}` : '',
        seller.bank_account_no ? `A/c no.: ${seller.bank_account_no}` : '',
        seller.bank_ifsc ? `IFSC: ${seller.bank_ifsc}` : '',
        seller.upi_id ? `UPI: ${seller.upi_id}` : '',
      ].filter(Boolean);
      if (bank.length) {
        text(bank.join('   '), left, y, { color: MUTED, width });
        y = doc.y + 6;
      }
    }
    if (seller.invoice_footer) {
      text(seller.invoice_footer, left, y, { color: MUTED, size: 8, width });
    }
    text('This is a computer generated invoice.', left, doc.page.height - 60, { color: MUTED, size: 8, width, align: 'center' });

    doc.end();
  });
}
