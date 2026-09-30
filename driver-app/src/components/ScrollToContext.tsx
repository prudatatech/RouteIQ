import { createContext, useContext } from 'react';
import type { View } from 'react-native';

/**
 * Lets an item deep inside a tab (a document row) ask the Home scroll view to bring it into view.
 * Home provides the real function; outside Home it does nothing.
 */
export const ScrollToContext = createContext<(view: View | null) => void>(() => {});

export const useScrollTo = () => useContext(ScrollToContext);
