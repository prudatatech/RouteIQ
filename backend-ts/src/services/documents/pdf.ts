/**
 * margixindia — PDFs of the documents the logistic company generates (A4, pdfkit), in the look of the tax invoice
 * (services/invoice-pdf.service.ts): the issuer on the left, the document title on the right, then labelled
 * sections and tables. Rendered from the document's stored `fields`, so a document prints exactly as recorded.
 * What is not recorded is left out. The built-in PDF font has no rupee sign, so amounts are written "Rs.".
 */
import PDFDocument from 'pdfkit';
import { formatISTDate, formatISTDateTime } from '../../core/format';
import { rupeesInWords } from '../../core/words';
import { pdfMoney } from '../invoice-pdf.service';
import { DOC_LABELS, type DocKind } from './kinds';
import type { DocumentRow } from './documents.service';

const INK = '#1d2320';
const MUTED = '#5d6862';
const LINE = '#c9d0ca';
const GREEN = '#1f6b4a';
const RED = '#a4332a';

type Row = [string, string | undefined | null];
interface Section { heading: string; rows: Row[] }
interface Table { heading: string; headers: string[]; align: Array<'left' | 'right'>; widths: number[]; rows: string[][] }
interface Layout { sections: Section[]; tables: Table[]; words?: string; signatures?: string[]; note?: string }

const TERMS: Record<string, string> = { paid: 'Paid', to_pay: 'To pay', to_be_billed: 'To be billed' };
const date = (v: unknown) => (typeof v === 'string' && v ? formatISTDate(v) : undefined);
const dateTime = (v: unknown) => (typeof v === 'string' && v ? formatISTDateTime(v) : undefined);
const num = (v: unknown, unit = '') => (typeof v === 'number' && Number.isFinite(v) ? `${v.toLocaleString('en-IN')}${unit}` : undefined);
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? pdfMoney(v) : undefined);
const label = (s: unknown) => (typeof s === 'string' && s ? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : undefined);

function layoutOf(doc: Pick<DocumentRow, 'kind' | 'fields'>): Layout {
  const f = doc.fields ?? {};
  switch (doc.kind) {
    case 'lr':
      return {
        sections: [
          { heading: 'Parties', rows: [['Consignor', f.consignor_name], ['Consignor GSTIN', f.consignor_gstin], ['Consignee', f.consignee_name], ['Transporter', f.transporter_name], ['Transporter GSTIN', f.transporter_gstin]] },
          { heading: 'Route', rows: [['Pickup', f.pickup_address], ['Delivery', f.delivery_address], ['Route', f.route]] },
          { heading: 'Goods', rows: [['Description', f.goods_description], ['Packages', num(f.packages)], ['Actual weight', num(f.actual_weight_kg, ' kg')]] },
          { heading: 'Vehicle', rows: [['Vehicle number', f.vehicle_number], ['Driver', f.driver_name], ['Driver phone', f.driver_phone]] },
          { heading: 'References', rows: [['Invoice number', f.invoice_number], ['E-way bill number', f.eway_bill_number]] },
          { heading: 'Freight', rows: [['Freight amount', money(f.freight_amount)], ['Payment terms', TERMS[f.payment_terms]]] },
        ],
        tables: [],
        words: typeof f.freight_amount === 'number' ? rupeesInWords(f.freight_amount) : undefined,
        signatures: ['Consignor', 'Driver', 'Consignee (receiving)'],
        note: 'Goods are carried subject to the transporter\'s conditions of carriage.',
      };
    case 'freight_sheet':
      return {
        sections: [
          { heading: 'Movement', rows: [['LR number', f.lr_number], ['Vehicle number', f.vehicle_number], ['From', f.from_location], ['To', f.to_location], ['Consignor', f.consignor_name], ['Consignee', f.consignee_name], ['Actual weight', num(f.actual_weight_kg, ' kg')]] },
          { heading: 'Freight', rows: [['Rate', f.rate !== undefined ? `${pdfMoney(f.rate)}${f.rate_basis ? ` ${f.rate_basis}` : ''}` : undefined], ['Total freight', money(f.total_freight)], ['Paid / advance', money(f.paid_advance)], ['Amount to pay', money(f.amount_to_pay)], ['Payment terms', TERMS[f.payment_terms]]] },
          { heading: 'Delivery acknowledgement', rows: [['Acknowledgement', f.delivery_acknowledgement], ['Remarks', f.remarks]] },
        ],
        tables: [],
        words: typeof f.amount_to_pay === 'number' ? rupeesInWords(f.amount_to_pay) : undefined,
        signatures: ['Driver', 'Receiver'],
      };
    case 'pod':
      return {
        sections: [
          { heading: 'Delivery', rows: [['Delivered', dateTime(f.delivered_at)], ['Receiver', f.receiver_name], ['Receiver contact', f.receiver_contact], ['Outcome', f.complete === true ? 'Fully delivered' : f.complete === false ? 'Part delivered' : undefined]] },
          { heading: 'Quantities', rows: [['Delivered', num(f.delivered_quantity)], ['Short', num(f.shortage_quantity)], ['Damaged', num(f.damaged_quantity)], ['Damage details', f.damage_details]] },
          { heading: 'Evidence', rows: [['Delivery photos', Array.isArray(f.photo_paths) && f.photo_paths.length ? `${f.photo_paths.length} attached` : undefined], ['Signature', f.signature_path ? 'Captured' : undefined], ['Remarks', f.remarks]] },
        ],
        tables: [],
        signatures: ['Receiver'],
      };
    case 'loading_report':
    case 'unloading_report': {
      const events: any[] = Array.isArray(f.events) ? f.events : [];
      return {
        sections: [
          { heading: doc.kind === 'loading_report' ? 'Loading' : 'Unloading', rows: [['When', dateTime(f.occurred_at)], ['Location', f.location], ['Quantity', num(f.loaded_quantity, ' pieces')], ['Weight', num(f.weight_kg, ' kg')], ['Confirmed by', f.confirmed_by], ['Photos', Array.isArray(f.photo_paths) && f.photo_paths.length ? `${f.photo_paths.length} attached` : undefined], ['Remarks', f.remarks]] },
        ],
        tables: events.length ? [{
          heading: 'Recorded events', headers: ['When', 'Event', 'Pieces', 'Weight', 'Condition'], align: ['left', 'left', 'right', 'right', 'left'], widths: [0.28, 0.24, 0.1, 0.14, 0.24],
          rows: events.map(e => [dateTime(e.at) ?? '-', label(e.kind) ?? '-', num(e.pieces) ?? '-', num(e.weight_kg, ' kg') ?? '-', label(e.condition) ?? '-']),
        }] : [],
        signatures: [doc.kind === 'loading_report' ? 'Loaded by' : 'Received by'],
      };
    }
    case 'damage_report': {
      const items: any[] = Array.isArray(f.items) ? f.items : [];
      return {
        sections: [
          { heading: 'Exception', rows: [['Type', label(f.exception_type)], ['Affected quantity', num(f.affected_quantity)], ['Description', f.description], ['Receiver remarks', f.receiver_remarks], ['Photos', Array.isArray(f.photo_paths) && f.photo_paths.length ? `${f.photo_paths.length} attached` : undefined], ['Report date', date(f.report_date)], ['Responsible person', f.responsible_person]] },
        ],
        tables: items.length ? [{
          heading: 'Affected goods', headers: ['Case', 'Type', 'Pieces', 'Weight', 'Condition', 'Note'], align: ['left', 'left', 'right', 'right', 'left', 'left'], widths: [0.14, 0.14, 0.1, 0.12, 0.18, 0.32],
          rows: items.map(i => [i.exception_code ?? '-', label(i.type) ?? '-', num(i.pieces_affected) ?? '-', num(i.weight_affected_kg, ' kg') ?? '-', label(i.condition) ?? '-', i.note ?? '']),
        }] : [],
        signatures: ['Reported by', 'Receiver'],
      };
    }
    case 'trip_closure': {
      const extras: any[] = Array.isArray(f.extra_charges) ? f.extra_charges : [];
      const deductions: any[] = Array.isArray(f.deductions) ? f.deductions : [];
      return {
        sections: [
          { heading: 'Delivery', rows: [['Final delivery status', f.final_delivery_status], ['POD reference', f.pod_reference], ['Closure date', date(f.closure_date)], ['Payment status', label(f.payment_status)]] },
          { heading: 'Reconciliation', rows: [['Final freight', money(f.final_freight)], ['Approved extra charges', money(f.additional_charges)], ['Deductions', money(f.deductions_total)], ['Expenses', money(f.expenses)], ['Advance paid', money(f.advance_paid)], ['Balance payable', money(f.balance_payable)]] },
        ],
        tables: [
          ...(extras.length ? [{ heading: 'Extra charges', headers: ['Charge', 'Amount', 'Approved'], align: ['left', 'right', 'left'] as Array<'left' | 'right'>, widths: [0.5, 0.25, 0.25], rows: extras.map(e => [e.label, pdfMoney(e.amount), e.approved ? 'Approved' : 'Not approved (not counted)']) }] : []),
          ...(deductions.length ? [{ heading: 'Deductions', headers: ['Deduction', 'Amount', 'Reason'], align: ['left', 'right', 'left'] as Array<'left' | 'right'>, widths: [0.35, 0.25, 0.4], rows: deductions.map(d => [d.label, pdfMoney(d.amount), d.reason ?? '']) }] : []),
        ],
        words: typeof f.balance_payable === 'number' && f.balance_payable >= 0 ? rupeesInWords(f.balance_payable) : undefined,
      };
    }
    default:
      return { sections: [], tables: [] };
  }
}

export const documentFileName = (doc: Pick<DocumentRow, 'kind' | 'number' | 'id'>): string =>
  `${(doc.number ?? `${doc.kind}-${doc.id.slice(0, 8)}`).replace(/[^\w.-]+/g, '_')}.pdf`;

export function renderDocumentPdf(doc: Pick<DocumentRow, 'kind' | 'number' | 'doc_date' | 'status' | 'version' | 'fields'>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const title = DOC_LABELS[doc.kind as DocKind] ?? 'Document';
    const issuer = (doc.fields?.issuer ?? {}) as { name?: string; address?: string; gstin?: string; phone?: string };
    const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${title} ${doc.number ?? ''}`.trim(), Author: issuer.name ?? 'margixindia' } });
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

    // Header: issuer left, title right
    text(issuer.name ?? 'Issuer not recorded', left, 40, { font: 'Helvetica-Bold', size: 15, width: width * 0.6 });
    let y = pdf.y + 2;
    for (const l of [issuer.address, issuer.gstin ? `GSTIN: ${issuer.gstin}` : '', issuer.phone].filter(Boolean) as string[]) {
      text(l, left, y, { color: MUTED, width: width * 0.6 });
      y = pdf.y + 1;
    }
    text(title.toUpperCase(), left + width * 0.6, 40, { font: 'Helvetica-Bold', size: 14, color: GREEN, width: width * 0.4, align: 'right' });
    const statusText = doc.status === 'draft' ? 'DRAFT' : doc.status === 'cancelled' ? 'CANCELLED' : doc.status === 'superseded' ? 'SUPERSEDED' : '';
    if (statusText) text(statusText, left + width * 0.6, 60, { font: 'Helvetica-Bold', size: 10, color: RED, width: width * 0.4, align: 'right' });
    y = Math.max(y, 80) + 8;
    rule(y);
    y += 10;

    // Document facts
    const facts: Row[] = [
      ['Document no.', doc.number ?? undefined],
      ['Date', date(doc.doc_date)],
      ['Load', doc.fields?.load_number],
      ['Version', doc.version > 1 ? String(doc.version) : undefined],
    ];
    for (const [k, v] of facts) {
      if (!v) continue;
      text(k, left, y, { color: MUTED, width: 90 });
      text(v, left + 92, y, { font: 'Helvetica-Bold', width: width - 92 });
      y = Math.max(pdf.y, y + 12) + 1;
    }
    y += 6;

    const layout = layoutOf(doc);
    for (const section of layout.sections) {
      const rows = section.rows.filter(([, v]) => v !== undefined && v !== null && v !== '') as Array<[string, string]>;
      if (rows.length === 0) continue;
      y = room(y, 40);
      pdf.rect(left, y, width, 16).fillColor('#eef2ee').fill();
      text(section.heading, left + 4, y + 4, { font: 'Helvetica-Bold', size: 8.5 });
      y += 20;
      for (const [k, v] of rows) {
        y = room(y, 16);
        text(k, left + 4, y, { color: MUTED, width: 130 });
        text(v, left + 140, y, { width: width - 144 });
        y = Math.max(pdf.y, y + 12) + 2;
      }
      y += 4;
    }

    for (const table of layout.tables) {
      y = room(y, 50);
      text(table.heading, left, y, { font: 'Helvetica-Bold', size: 9 });
      y = pdf.y + 3;
      const xs: number[] = [];
      let acc = left;
      for (const w of table.widths) { xs.push(acc); acc += w * width; }
      pdf.rect(left, y, width, 16).fillColor('#eef2ee').fill();
      table.headers.forEach((h, i) => text(h, xs[i] + 3, y + 4, { font: 'Helvetica-Bold', size: 8.5, width: table.widths[i] * width - 6, align: table.align[i] }));
      y += 18;
      for (const row of table.rows) {
        y = room(y, 16);
        let bottom = y;
        row.forEach((cell, i) => {
          text(cell, xs[i] + 3, y, { size: 8.5, width: table.widths[i] * width - 6, align: table.align[i] });
          bottom = Math.max(bottom, pdf.y);
        });
        y = bottom + 3;
        rule(y);
        y += 3;
      }
      y += 6;
    }

    if (layout.words) {
      y = room(y, 30);
      text(`Amount in words: ${layout.words}`, left, y, { font: 'Helvetica-Bold', width });
      y = pdf.y + 8;
    }
    if (layout.note) {
      y = room(y, 20);
      text(layout.note, left, y, { color: MUTED, size: 8, width });
      y = pdf.y + 8;
    }
    if (layout.signatures?.length) {
      y = room(y + 24, 40);
      const w = width / layout.signatures.length;
      layout.signatures.forEach((s, i) => {
        pdf.moveTo(left + i * w + 6, y).lineTo(left + (i + 1) * w - 14, y).lineWidth(0.6).strokeColor(LINE).stroke();
        text(s, left + i * w + 6, y + 3, { color: MUTED, size: 8 });
      });
    }
    text('This is a computer generated document.', left, pdf.page.height - 60, { color: MUTED, size: 8, width, align: 'center' });
    pdf.end();
  });
}
