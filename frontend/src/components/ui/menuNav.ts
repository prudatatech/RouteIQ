/** The item to focus after a key press in a menu of `count` items, or null when the key does nothing. Wraps at both ends. */
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}
