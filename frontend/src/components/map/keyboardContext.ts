import { createContext } from 'react'

/**
 * Whether the markers are keyboard stops. A map beside a list that does the same job (choose a
 * vehicle) turns this off, so the list is the way through and the keyboard does not cross the markers first.
 */
export const MapKeyboardContext = createContext(true)
