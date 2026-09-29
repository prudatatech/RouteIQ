// Generated from design/tokens.json by design/generate-tokens.mjs. Do not edit.
export const tokens = {
  "color": {
    "bg": "#F4F4F5",
    "surface": "#FFFFFF",
    "surfaceSubtle": "#FAFAFA",
    "border": "#E4E4E7",
    "borderStrong": "#D4D4D8",
    "text": "#18181B",
    "textMuted": "#5B5B63",
    "textDisabled": "#A1A1AA",
    "accent": "#8C6600",
    "accentHover": "#734F00",
    "accentFill": "#FFC107",
    "accentFillHover": "#F5B400",
    "accentSoft": "#FFF4D1",
    "onAccentFill": "#18181B",
    "success": "#15803D",
    "successSoft": "#DCFCE7",
    "warning": "#B45309",
    "warningSoft": "#FEF3C7",
    "danger": "#B91C1C",
    "dangerHover": "#991B1B",
    "dangerSoft": "#FEE2E2",
    "info": "#1D4ED8",
    "infoSoft": "#DBEAFE",
    "neutral": "#52525B",
    "neutralSoft": "#F4F4F5",
    "overlay": "rgba(24, 24, 27, 0.5)"
  },
  "font": {
    "sans": "Inter",
    "mono": "JetBrains Mono"
  },
  "fontSize": {
    "xs": 12,
    "sm": 14,
    "base": 16,
    "lg": 18,
    "2xl": 24,
    "3xl": 30,
    "5xl": 48
  },
  "fontWeight": {
    "regular": 400,
    "medium": 500,
    "semibold": 600
  },
  "space": {
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "6": 24,
    "8": 32,
    "12": 48,
    "16": 64
  },
  "radius": {
    "control": 8,
    "card": 16,
    "full": 9999
  },
  "size": {
    "controlWeb": 40,
    "controlMobile": 48,
    "contentMax": 1280,
    "formMax": 720
  }
} as const

export type ColorToken = keyof typeof tokens.color
