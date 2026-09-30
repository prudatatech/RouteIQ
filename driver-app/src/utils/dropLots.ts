/**
 * The lots to hand over at one drop. A consignment booked to several drops is
 * split into lots, each with its own delivery point and route stop; lots for
 * the same place (one warehouse gate, several consignees) are recorded from
 * one delivery sheet. Only lots are grouped: a consignment that was never
 * split keeps its own sheet, exactly as before.
 */
import { NO_LOT, readLotTag, type ConsignmentRef, type LotTag, type OnBoardItem } from '../services/cargo';
import type { DriverRoute, RouteStop } from '../types/route';
import { distanceMeters, sortedStops, stopCoord } from './route';
import { sameParcelCode } from './parcel';

/** Stops this close together are the same drop. */
const SAME_PLACE_M = 60;

export interface DropLot {
  stop: RouteStop;
  /** The code on the parcel (the lot's tracking ID); empty for a stop with no parcel. */
  code: string;
  ref: ConsignmentRef | null;
  pieces: number | null;
  lot: LotTag;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sameAddress = (a: RouteStop, b: RouteStop) => {
  const x = a.delivery_point?.address?.trim().toLowerCase();
  const y = b.delivery_point?.address?.trim().toLowerCase();
  return !!x && x === y;
};

const samePlace = (a: RouteStop, b: RouteStop) => {
  const p = stopCoord(a);
  const q = stopCoord(b);
  return sameAddress(a, b) || (!!p && !!q && distanceMeters(p, q) <= SAME_PLACE_M);
};

/** One stop as a lot: its code, the on-board record of it, and the drop's own consignee and pieces. */
export function dropLotOf(stop: RouteStop, onBoard: readonly OnBoardItem[]): DropLot {
  const code = stop.parcel?.code ?? '';
  const item = onBoard.find((i) => i.stopId === stop.id) ?? (code ? onBoard.find((i) => sameParcelCode(i.code, code)) : undefined);
  const fromDrop = code ? readLotTag(stop.delivery_point, code) : NO_LOT;
  const tag = item?.lot ?? NO_LOT;
  return {
    stop,
    code,
    ref: item?.ref ?? null,
    pieces: item?.pieces ?? toNumber(stop.delivery_point?.pieces),
    lot: {
      label: tag.label ?? fromDrop.label,
      masterCode: tag.masterCode ?? fromDrop.masterCode,
      consigneeName: tag.consigneeName ?? fromDrop.consigneeName,
      consigneePhone: tag.consigneePhone ?? fromDrop.consigneePhone,
    },
  };
}

/** The lots still to deliver at this stop's place, this stop first. */
export function dropLotsFor(stop: RouteStop, route: DriverRoute | null | undefined, onBoard: readonly OnBoardItem[]): DropLot[] {
  const first = dropLotOf(stop, onBoard);
  if (!first.lot.label) return [first];
  const others = sortedStops(route)
    .filter((s) => s.id !== stop.id && s.status === 'pending' && !!s.parcel?.code && s.parcel.purpose !== 'pickup' && samePlace(s, stop))
    .map((s) => dropLotOf(s, onBoard))
    .filter((l) => !!l.lot.label);
  return [first, ...others];
}

/** Who a lot goes to, for grouping: the same name and phone are the same consignee. */
export function consigneeKey(lot: DropLot): string {
  const name = lot.lot.consigneeName?.trim().toLowerCase() ?? '';
  const phone = (lot.lot.consigneePhone ?? '').replace(/\D/g, '').slice(-10);
  return name || phone ? `${name}|${phone}` : `stop:${lot.stop.id}`;
}
