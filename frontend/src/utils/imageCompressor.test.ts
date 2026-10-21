import { describe, expect, it } from 'vitest'
import {
  calculateTargetDimensions,
  compressDocumentFile,
  isCompressibleImage,
} from './imageCompressor'

describe('imageCompressor', () => {
  it('correctly calculates proportional target dimensions for landscape image', () => {
    const { width, height } = calculateTargetDimensions(4000, 3000, 1600)
    expect(width).toBe(1600)
    expect(height).toBe(1200)
  })

  it('correctly calculates proportional target dimensions for portrait image', () => {
    const { width, height } = calculateTargetDimensions(3000, 4000, 1600)
    expect(width).toBe(1200)
    expect(height).toBe(1600)
  })

  it('preserves dimensions when image is smaller than max dimension', () => {
    const { width, height } = calculateTargetDimensions(800, 600, 1600)
    expect(width).toBe(800)
    expect(height).toBe(600)
  })

  it('identifies compressible image types', () => {
    const jpg = new File([''], 'pan.jpg', { type: 'image/jpeg' })
    const png = new File([''], 'cheque.png', { type: 'image/png' })
    const pdf = new File([''], 'gst.pdf', { type: 'application/pdf' })

    expect(isCompressibleImage(jpg)).toBe(true)
    expect(isCompressibleImage(png)).toBe(true)
    expect(isCompressibleImage(pdf)).toBe(false)
  })

  it('passes through non-image files such as PDFs untouched', async () => {
    const pdf = new File(['pdf-content'], 'gst.pdf', { type: 'application/pdf' })
    const result = await compressDocumentFile(pdf)

    expect(result.wasCompressed).toBe(false)
    expect(result.file).toBe(pdf)
    expect(result.file.name).toBe('gst.pdf')
  })
})
