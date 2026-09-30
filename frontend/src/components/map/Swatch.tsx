/**
 * A small key for a colour drawn on a map (a route, a speed band). The colour is data (one colour per
 * vehicle, per speed band), not a theme colour, so it is painted as an SVG fill or stroke.
 */
export function Swatch({ color, shape = 'line', className }: {
  color: string
  /** line: a solid bar; dash: a dashed line; dot: a round marker. */
  shape?: 'line' | 'dash' | 'dot'
  className?: string
}) {
  if (shape === 'dot') {
    return <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={className}><circle cx="5" cy="5" r="5" fill={color} /></svg>
  }
  return (
    <svg aria-hidden="true" width="18" height="6" viewBox="0 0 18 6" className={className}>
      {shape === 'dash'
        ? <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray="4 3" />
        : <rect x="0" y="0.5" width="18" height="5" rx="2.5" fill={color} />}
    </svg>
  )
}
