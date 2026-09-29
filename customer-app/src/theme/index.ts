/**
 * MargixIndia theme for React Native.
 *
 * Builds on the generated tokens (tokens.ts, from design/tokens.json). Screens
 * and components use these values only: no raw hex colours or font sizes.
 *
 * Fonts: Inter for the UI, JetBrains Mono for IDs, plate numbers and
 * coordinates. Each weight is its own font family (loaded in fonts.ts), so
 * text styles set `fontFamily` and never `fontWeight` — Android does not
 * synthesise weights for custom fonts.
 */
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { tokens } from './tokens';

export { tokens };

export const colors = {
  ...tokens.color,
  /** Text and icons placed on a solid danger, success or info fill. */
  onSolid: tokens.color.surface,
} as const;

export type ColorName = keyof typeof colors;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export const fontSize = {
  xs: tokens.fontSize.xs,
  sm: tokens.fontSize.sm,
  base: tokens.fontSize.base,
  lg: tokens.fontSize.lg,
  xl2: tokens.fontSize['2xl'],
  xl3: tokens.fontSize['3xl'],
  xl5: tokens.fontSize['5xl'],
} as const;

/** Font family per weight, for composing with a size preset. */
export const weight = {
  regular: { fontFamily: fontFamily.regular },
  medium: { fontFamily: fontFamily.medium },
  semibold: { fontFamily: fontFamily.semibold },
} as const satisfies Record<string, TextStyle>;

const preset = (size: number, lineHeight: number, family: string): TextStyle => ({
  fontFamily: family,
  fontSize: size,
  lineHeight,
});

/** Text style presets. Use these for every piece of text. */
export const type = {
  /** 12 — labels, timestamps, meta. */
  caption: preset(fontSize.xs, 16, fontFamily.regular),
  captionMedium: preset(fontSize.xs, 16, fontFamily.medium),
  /** 14 — secondary text. */
  bodySmall: preset(fontSize.sm, 20, fontFamily.regular),
  bodySmallMedium: preset(fontSize.sm, 20, fontFamily.medium),
  /** 16 — body text and form fields. */
  body: preset(fontSize.base, 24, fontFamily.regular),
  bodyMedium: preset(fontSize.base, 24, fontFamily.medium),
  /** 16 medium — buttons. */
  label: preset(fontSize.base, 20, fontFamily.medium),
  /** 18 — card and section titles. */
  title: preset(fontSize.lg, 24, fontFamily.semibold),
  /** 24 — key figures, dialog titles. */
  heading: preset(fontSize.xl2, 32, fontFamily.semibold),
  /** 30 — screen titles. */
  display: preset(fontSize.xl3, 36, fontFamily.semibold),
  /** 14 mono — IDs, plate numbers, coordinates. */
  mono: preset(fontSize.sm, 20, fontFamily.mono),
  monoMedium: preset(fontSize.sm, 20, fontFamily.monoMedium),
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Spacing scale: space[1] = 4 … space[16] = 64. */
export const space = tokens.space;

export const radius = tokens.radius;

export const size = {
  /** Minimum touch target and control height on mobile. */
  control: tokens.size.controlMobile,
  hairline: StyleSheet.hairlineWidth,
  border: 1,
  icon: { sm: 16, md: 20, lg: 24, xl: 32 },
} as const;

/** Cards use a border and no shadow. Menus and sheets use `sm`, dialogs `lg`. */
export const elevation = {
  sm: {
    shadowColor: tokens.color.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: tokens.color.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
} as const satisfies Record<string, ViewStyle>;

export const theme = { colors, fontFamily, fontSize, weight, type, space, radius, size, elevation } as const;
export type Theme = typeof theme;
