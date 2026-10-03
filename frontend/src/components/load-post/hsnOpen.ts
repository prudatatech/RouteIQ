/** Only one HSN suggestion list is open at a time: a row that opens its list closes the one that was open. */
let closeCurrent: (() => void) | null = null

export function claimHsnList(close: () => void): void {
  if (closeCurrent && closeCurrent !== close) closeCurrent()
  closeCurrent = close
}

export function releaseHsnList(close: () => void): void {
  if (closeCurrent === close) closeCurrent = null
}
