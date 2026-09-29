import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, type, type ColorName, type TypeVariant } from '../../theme';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
}

/** Text with a theme preset. Defaults to body text in the main text colour. */
export function Text({ variant = 'body', color = 'text', align, style, ...rest }: TextProps) {
  return <RNText {...rest} style={[type[variant], { color: colors[color] }, align ? { textAlign: align } : null, style]} />;
}
