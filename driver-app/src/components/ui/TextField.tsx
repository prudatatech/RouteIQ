import React, { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, size, space, type } from '../../theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
}

/** Labelled text input with an optional hint and inline error. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, style, multiline, ...rest },
  ref,
) {
  return (
    <View style={styles.wrap}>
      <Text variant="bodySmallMedium">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.textDisabled}
        multiline={multiline}
        style={[styles.input, multiline ? styles.multiline : null, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space[1], alignSelf: 'stretch' },
  input: {
    ...type.body,
    color: colors.text,
    minHeight: size.control,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: size.control * 2, textAlignVertical: 'top' },
  inputError: { borderColor: colors.danger },
});
