'use client';
import { createContext, useContext, type ReactNode } from 'react';

// The APP's own context (a client module: Server Components can render <ThemeProvider> but not create it).
// Overrides rendered deep inside @acme/core still see it: proof that the override is the project's module
// instance and that the SDK renders it in the app's tree.
export type Theme = 'light' | 'dark';
const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ value, children }: { value: Theme; children?: ReactNode }) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme | 'no-theme' {
  return useContext(ThemeContext) ?? 'no-theme';
}
