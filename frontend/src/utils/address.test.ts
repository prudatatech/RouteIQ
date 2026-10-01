import { describe, expect, it } from 'vitest'
import { formatAddress, placeLines, stripLeadingName } from './address'

describe('stripLeadingName', () => {
  it('drops a duplicated leading name', () => {
    expect(stripLeadingName('Fab Hostels', 'Fab Hostels, Kanakapura Main Road, Bengaluru')).toBe('Kanakapura Main Road, Bengaluru')
  })
  it('ignores case and spacing', () => {
    expect(stripLeadingName('fab  hostels', 'Fab Hostels , Kanakapura Main Road')).toBe('Kanakapura Main Road')
  })
  it('keeps a name that is only a prefix of a word', () => {
    expect(stripLeadingName('Fab', 'Fabrication Road, Pune')).toBe('Fabrication Road, Pune')
  })
  it('returns nothing when the address is the name', () => {
    expect(stripLeadingName('Pune', 'pune')).toBe('')
  })
})

describe('placeLines', () => {
  it('has no second line when it would repeat', () => {
    expect(placeLines('Pune', 'Pune')).toEqual({ primary: 'Pune', secondary: null })
  })
  it('uses the address alone when there is no name', () => {
    expect(placeLines(null, 'MG Road, Pune')).toEqual({ primary: 'MG Road, Pune', secondary: null })
  })
  it('is null with nothing', () => {
    expect(placeLines('', ' ')).toBeNull()
  })
  it('splits name and the rest', () => {
    expect(placeLines('Acme', 'Acme, Plot 4, Bhiwandi')).toEqual({ primary: 'Acme', secondary: 'Plot 4, Bhiwandi' })
  })
})

describe('formatAddress', () => {
  it('prints the name once', () => {
    expect(formatAddress('Fab Hostels', 'Fab Hostels, Kanakapura Main Road')).toBe('Fab Hostels, Kanakapura Main Road')
  })
})
