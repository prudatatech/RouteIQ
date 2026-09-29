/**
 * Keeps pages on the shared theme (see docs/ui-plan.md, section 2).
 *
 * design/no-off-theme-classes  class names that bypass the tokens: arbitrary values
 *                              (text-[10px], bg-[#fff], rounded-[24px]), raw Tailwind
 *                              palettes (slate-500, blue-600), sizes and weights outside
 *                              the scale (text-xl, text-4xl, font-black, rounded-xl).
 * design/no-inline-visual-style  inline style for colour, type, radius or shadow.
 *                              Layout values computed at runtime (width, transform) are fine.
 */

const PALETTES = [
  'slate', 'gray', 'zinc', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const COLOR_UTILS = ['text', 'bg', 'border', 'ring', 'from', 'via', 'to', 'fill', 'stroke', 'outline', 'divide', 'placeholder', 'accent', 'shadow', 'decoration', 'caret']

const rules = [
  {
    test: new RegExp(`(^|:)(${COLOR_UTILS.join('|')})-(${PALETTES.join('|')})-\\d{2,3}(\\/\\d+)?$`),
    message: 'Use a theme colour (text, muted, brand, success, warning, danger, info, neutral, border, surface) instead of a Tailwind palette colour.',
  },
  { test: /(^|:)(text|bg|border|ring|fill|stroke|from|via|to|shadow|outline|decoration)-\[(#|rgb|hsl|color:|var\()/, message: 'Arbitrary colours bypass the theme. Use a theme colour class.' },
  { test: /(^|:)text-\[\d/, message: 'Arbitrary font size. Use text-xs, text-sm, text-base, text-lg, text-2xl or text-3xl.' },
  { test: /(^|:)text-(xl|4xl|6xl|7xl|8xl|9xl)$/, message: 'Font size outside the type scale. Use text-xs, text-sm, text-base, text-lg, text-2xl or text-3xl (text-5xl on the landing page only).' },
  { test: /(^|:)font-(black|extrabold|bold|light|thin|extralight)$/, message: 'Use font-normal, font-medium or font-semibold.' },
  { test: /(^|:)rounded(-[trblse]{1,2})?-(\[|xl|3xl|md|sm)/, message: 'Use rounded-control (8px), rounded-card (16px) or rounded-full.' },
  { test: /(^|:)tracking-(\[|widest|wider|tighter)/, message: 'Letter spacing is set by the theme; remove custom tracking.' },
  { test: /(^|:)shadow-(\[|sm$|md$|lg$|xl$|2xl$|inner$)/, message: 'Use shadow-raised (menus) or shadow-dialog (dialogs); cards have a border and no shadow.' },
  { test: /(^|:)backdrop-blur/, message: 'No blur effects in the theme.' },
  { test: /(^|:)(bg-gradient|bg-clip-text)/, message: 'No gradients in the theme.' },
]

function checkClassString(context, node, value) {
  for (const cls of value.split(/\s+/).filter(Boolean)) {
    const hit = rules.find(r => r.test.test(cls))
    if (hit) context.report({ node, message: `"${cls}": ${hit.message}` })
  }
}

function checkExpression(context, expr) {
  if (!expr) return
  switch (expr.type) {
    case 'Literal':
      if (typeof expr.value === 'string') checkClassString(context, expr, expr.value)
      break
    case 'TemplateLiteral':
      expr.quasis.forEach(q => checkClassString(context, q, q.value.cooked ?? ''))
      expr.expressions.forEach(e => checkExpression(context, e))
      break
    case 'ConditionalExpression':
      checkExpression(context, expr.consequent)
      checkExpression(context, expr.alternate)
      break
    case 'LogicalExpression':
      checkExpression(context, expr.right)
      break
    case 'CallExpression':
      expr.arguments.forEach(a => checkExpression(context, a))
      break
    case 'ArrayExpression':
      expr.elements.forEach(e => checkExpression(context, e))
      break
    case 'ObjectExpression':
      expr.properties.forEach(p => {
        if (p.type === 'Property') {
          if (p.key.type === 'Literal' && typeof p.key.value === 'string') checkClassString(context, p.key, p.key.value)
          checkExpression(context, p.value)
        }
      })
      break
  }
}

const CLASS_ATTRS = new Set(['className', 'class', 'inputClassName'])

const noOffThemeClasses = {
  meta: { type: 'suggestion', schema: [], docs: { description: 'Disallow class names that bypass the design tokens' } },
  create(context) {
    return {
      JSXAttribute(node) {
        if (!CLASS_ATTRS.has(node.name.name) || !node.value) return
        if (node.value.type === 'Literal') checkClassString(context, node.value, String(node.value.value))
        else if (node.value.type === 'JSXExpressionContainer') checkExpression(context, node.value.expression)
      },
      // clsx(...) / cn(...) calls outside JSX, e.g. class maps.
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && (node.callee.name === 'clsx' || node.callee.name === 'cn')) {
          if (node.parent?.type === 'JSXExpressionContainer') return
          node.arguments.forEach(a => checkExpression(context, a))
        }
      },
    }
  },
}

const VISUAL_STYLE_KEYS = new Set([
  'color', 'background', 'backgroundColor', 'backgroundImage', 'borderColor', 'border', 'borderRadius',
  'boxShadow', 'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'lineHeight', 'textTransform',
])

const noInlineVisualStyle = {
  meta: { type: 'suggestion', schema: [], docs: { description: 'Disallow inline colour, type, radius and shadow styles' } },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return
        const expr = node.value.expression
        if (expr.type !== 'ObjectExpression') return
        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue
          const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value
          if (VISUAL_STYLE_KEYS.has(key)) {
            context.report({ node: prop, message: `Inline "${key}" bypasses the theme. Use a theme class instead.` })
          }
        }
      },
    }
  },
}

export default {
  rules: {
    'no-off-theme-classes': noOffThemeClasses,
    'no-inline-visual-style': noInlineVisualStyle,
  },
}
