/**
 * margixindia — The PDF of a partner statement (A4, pdfkit), in the look of the other documents
 * (services/documents/pdf.ts): the company that settles on the left, the title on the right, both parties with their
 * GSTINs, the orders table, the deductions, and the balance. Amounts are written "Rs." (the built-in font has no rupee sign).
 */
import PDFDocument from 'pdfkit';
import { formatISTDate, formatISTDateTime } from '../core/format';
import { rupeesInWords } from '../core/words';
import { pdfMoney } from './invoice-pdf.service';
import type { OrgParty, StatementView } from './tpl-statement.service';

const INK = '#1d2320';
const MUTED = '#5d6862';
const LINE = '#c9d0ca';
const GREEN = '#1f6b4a';
const RED = '#a4332a';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (period: string): string => `${MONTHS[Number(period.slice(4)) - 1] ?? period.slice(4)} ${period.slice(0, 4)}`;
const rupees = (paise: number) => pdfMoney(paise / 100);
const place = (v: string | null) => (v ?? '').split(',')[0].trim() || '-';

export const statementFileName = (s: Pick<StatementView, 'period' | 'id'>): string => `statement-${s.period}-${s.id.slice(0, 8)}.pdf`;

const addressOf = (p: OrgParty | null) => [p?.address, p?.city, p?.state, p?.pincode].filter(Boolean).join(', ');

export function renderStatementPdf(statement: StatementView, parties: { company: OrgParty | null; partner: OrgParty | null }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const company = parties.company;
    const partner = parties.partner;
    const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Partner statement ${periodLabel(statement.period)}`, Author: company?.legal_name ?? company?.name ?? 'margixindia' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = 40;
    const width = pdf.page.width - 80;
    const right = left + width;
    const rule = (y: number) => pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(LINE).stroke();
    const text = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
      const { font, size, color, ...rest } = o;
      pdf.font(font ?? 'Helvetica').fontSize(size ?? 9).fillColor(color ?? INK).text(s, x, y, rest);
    };
    const room = (y: number, need: number) => {
      if (y + need <= pdf.page.height - 70) return y;
      pdf.addPage();
      return 40;
    };

    // Header: the company left, the title right
    text(company?.legal_name ?? company?.name ?? statement.company_name ?? 'Company', left, 40, { font: 'Helvetica-Bold', size: 15, width: width * 0.6 });
    let y = pdf.y + 2;
    for (const l of [addressOf(company), company?.gstin ? `GSTIN: ${company.gstin}` : ''].filter(Boolean)) {
      text(l, left, y, { color: MUTED, width: width * 0.6 });
      y = pdf.y + 1;
    }
    text('PARTNER STATEMENT', left + width * 0.55, 40, { font: 'Helvetica-Bold', size: 14, color: GREEN, width: width * 0.45, align: 'right' });
    const badge = statement.status === 'draft' ? 'DRAFT' : statement.status === 'paid' ? 'PAID' : '';
    if (badge) text(badge, left + width * 0.6, 60, { font: 'Helvetica-Bold', size: 10, color: statement.status === 'draft' ? RED : GREEN, width: width * 0.4, align: 'right' });
    y = Math.max(y, 80) + 8;
    rule(y);
    y += 10;

    const facts: Array<[string, string | undefined]> = [
      ['Month', periodLabel(statement.period)],
      ['Partner', partner?.legal_name ?? partner?.name ?? statement.partner_name ?? undefined],
      ['Partner GSTIN', partner?.gstin ?? undefined],
      ['Partner address', addressOf(partner) || undefined],
      ['Issued', statement.issued_at ? formatISTDateTime(statement.issued_at) : undefined],
      ['Paid', statement.paid_at ? `${formatISTDateTime(statement.paid_at)}${statement.paid_reference ? ` (ref. ${statement.paid_reference})` : ''}` : undefined],
    ];
    for (const [k, v] of facts) {
      if (!v) continue;
      text(k, left, y, { color: MUTED, width: 90 });
      text(v, left + 92, y, { font: 'Helvetica-Bold', width: width - 92 });
      y = Math.max(pdf.y, y + 12) + 1;
    }
    y += 8;

    // Orders
    const cols = [0.16, 0.54, 0.3];
    const xs: number[] = [];
    let acc = left;
    for (const w of cols) { xs.push(acc); acc += w * width; }
    const header = (title: string, heads: string[], aligns: Array<'left' | 'right'>) => {
      y = room(y, 50);
      text(title, left, y, { font: 'Helvetica-Bold', size: 9 });
      y = pdf.y + 3;
      pdf.rect(left, y, width, 16).fillColor('#eef2ee').fill();
      heads.forEach((h, i) => text(h, xs[i] + 3, y + 4, { font: 'Helvetica-Bold', size: 8.5, width: cols[i] * width - 6, align: aligns[i] }));
      y += 18;
    };
    const row = (cells: string[], aligns: Array<'left' | 'right'>) => {
      y = room(y, 16);
      let bottom = y;
      cells.forEach((cell, i) => {
        text(cell, xs[i] + 3, y, { size: 8.5, width: cols[i] * width - 6, align: aligns[i] });
        bottom = Math.max(bottom, pdf.y);
      });
      y = bottom + 3;
      rule(y);
      y += 3;
    };

    const orders = statement.orders ?? [];
    header(`Orders delivered (${orders.length})`, ['Delivered', 'Trip', 'Amount'], ['left', 'left', 'right']);
    for (const o of orders) {
      row([o.delivered_at ? formatISTDate(o.delivered_at) : '-', `${place(o.pickup_location)} to ${place(o.drop_location)}`, rupees(o.amount_paise)], ['left', 'left', 'right']);
    }
    y += 6;

    if (statement.deductions.length > 0) {
      header('Deductions', ['', 'Label and reason', 'Amount'], ['left', 'left', 'right']);
      for (const d of statement.deductions) row(['', d.reason ? `${d.label}: ${d.reason}` : d.label, `- ${rupees(d.amount_paise)}`], ['left', 'left', 'right']);
      y += 6;
    }

    // Totals
    const total = (label: string, value: string, bold = false) => {
      y = room(y, 18);
      text(label, left + width * 0.5, y, { font: bold ? 'Helvetica-Bold' : 'Helvetica', size: bold ? 10 : 9, width: width * 0.28 });
      text(value, left + width * 0.78, y, { font: bold ? 'Helvetica-Bold' : 'Helvetica', size: bold ? 10 : 9, width: width * 0.22, align: 'right' });
      y += bold ? 17 : 13;
    };
    total('Orders total', rupees(statement.orders_total_paise));
    total('Deductions', `- ${rupees(statement.deductions_total_paise)}`);
    total('Balance payable', rupees(statement.balance_paise), true);
    y += 6;
    const words = rupeesInWords(statement.balance_paise / 100);
    if (words) {
      y = room(y, 30);
      text(`Amount in words: ${words}`, left, y, { font: 'Helvetica-Bold', width });
    }
    text('This is a computer generated document.', left, pdf.page.height - 60, { color: MUTED, size: 8, width, align: 'center' });
    pdf.end();
  });
}
