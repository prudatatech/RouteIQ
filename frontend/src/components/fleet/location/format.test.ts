import { describe, expect, it } from 'vitest'
import {
  accuracyText, activitySentence, compassPoint, coordinatesText, googleMapsUrl, hasPosition, headingText,
  jobText, loadText, routeText, shareUrl, speedText, trackCoordinates,
  type VehicleActivity,
} from './format'

const activity = (patch: Partial<VehicleActivity>): VehicleActivity => ({
  vehicle_id: 'v1', plate_number: 'MH12AB1234', state: 'idle', vehicle_status: 'available', live: true,
  last_seen_at: '2026-09-29T09:58:00Z', since: null, position: { lat: 18.5, lng: 73.8 }, place_name: null,
  load: { percent_full: null, load_kg: null, capacity_kg: null, basis: null },
  jobs: [], stationary: null, last_moved_at: null,
  ...patch,
})

describe('GPS readout text', () => {
  it('names the compass point of a heading', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(44)).toBe('NE')
    expect(compassPoint(200)).toBe('S')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(-90)).toBe('W')
    expect(compassPoint(null)).toBeNull()
    expect(headingText(90)).toBe('E (90°)')
    expect(headingText(undefined)).toBe('Not reported')
  })

  it('says "Not reported" instead of inventing a value', () => {
    expect(speedText(null)).toBe('Not reported')
    expect(speedText(54.6)).toBe('55 km/h')
    expect(speedText(0)).toBe('0 km/h')
    expect(accuracyText(null)).toBe('Not reported')
    expect(accuracyText(6.4)).toBe('±6 m')
  })

  it('formats coordinates and the Google Maps link', () => {
    expect(coordinatesText(18.5, 73.8)).toBe('18.50000, 73.80000')
    expect(coordinatesText(null, 73.8)).toBeNull()
    expect(googleMapsUrl(18.5, 73.8)).toBe('https://www.google.com/maps?q=18.5,73.8')
  })

  it('treats 0,0 and out-of-range values as no position', () => {
    expect(hasPosition(18.5, 73.8)).toBe(true)
    expect(hasPosition(0, 0)).toBe(false)
    expect(hasPosition(null, 73.8)).toBe(false)
    expect(hasPosition(95, 10)).toBe(false)
  })
})

describe('what the vehicle is doing', () => {
  it('describes places and jobs', () => {
    expect(routeText('Pune Hub', 'Surat')).toBe('Pune Hub to Surat')
    expect(routeText(null, 'Surat')).toBe('To Surat')
    expect(routeText(null, null)).toBeNull()
    const route = { kind: 'route' as const, id: 'r', status: 'active', from: 'Pune Hub', to: 'Surat', next_stop: 'Surat', stops_total: 2, stops_done: 1, weight_kg: null, tracking_ids: [], started_at: null }
    expect(jobText(route)).toBe('Trip, Pune Hub to Surat, 1 of 2 stops done')
    expect(jobText({ ...route, kind: 'manifest', stops_total: null, stops_done: null, weight_kg: 250 })).toBe('Shipment, Pune Hub to Surat, 250 kg')
  })

  it('says how full the vehicle is', () => {
    expect(loadText({ percent_full: 60, load_kg: 600, capacity_kg: 1000, basis: 'reported' })).toBe('60% full (600 kg of 1,000 kg)')
    expect(loadText({ percent_full: 60, load_kg: null, capacity_kg: null, basis: 'declared' })).toBe('60% full')
    expect(loadText({ percent_full: null, load_kg: 400, capacity_kg: null, basis: 'manifest' })).toBe('400 kg on board')
    expect(loadText({ percent_full: null, load_kg: null, capacity_kg: null, basis: null })).toBeNull()
  })

  it('writes one sentence for each state', () => {
    const now = Date.parse('2026-09-29T10:00:00Z')
    expect(activitySentence(activity({ state: 'offline', live: false, last_seen_at: '2026-09-29T09:40:00Z' }), now)).toBe('Offline, last heard from 20 minutes ago')
    expect(activitySentence(activity({ state: 'offline', live: false, last_seen_at: null }), now)).toBe('Never reported a position')
    expect(activitySentence(activity({ state: 'carrying', since: null }), now)).toBe('Carrying a load')
    expect(activitySentence(activity({ state: 'idle', place_name: 'Pune Hub', stationary: { since: '2026-09-29T08:00:00Z', minutes: 120, at_least: false } }), now))
      .toBe('Idle since 1:30 pm (2 h) at Pune Hub')
    expect(activitySentence(activity({ state: 'idle', stationary: { since: '2026-09-29T08:00:00Z', minutes: 120, at_least: true } }), now))
      .toContain('Idle since at least 1:30 pm')
    expect(activitySentence(activity({ state: 'idle' }), now)).toBe('Idle')
  })
})

describe('trail and share link helpers', () => {
  it('turns a track into [lng, lat] pairs, oldest first', () => {
    const points = [
      { lat: 18.5, lng: 73.8, at: 'a', speed_kmph: null, heading: null, accuracy: null },
      { lat: 18.6, lng: 73.9, at: 'b', speed_kmph: null, heading: null, accuracy: null },
    ]
    expect(trackCoordinates({ points })).toEqual([[73.8, 18.5], [73.9, 18.6]])
    expect(trackCoordinates(undefined)).toEqual([])
  })

  it('joins a share path to the site address once', () => {
    expect(shareUrl('/share/abc', 'https://margixindia.vercel.app/')).toBe('https://margixindia.vercel.app/share/abc')
  })
})
