import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  Vibration,
  LayoutAnimation,
  UIManager,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../services/api';
import { Button, Text } from '../components/ui';
import LanguagePicker from '../components/LanguagePicker';
import { useTranslation } from '../hooks/useTranslation';
import { colors, radius, size, space, type } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function LoginScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [otpFocused, setOtpFocused] = useState(false);
  const otpInputRef = React.useRef<TextInput>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (step === 'otp' && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const handleSendOtp = async () => {
    if (!phone || phone.length < 10) {
      setError(t('login_phone_invalid'));
      return;
    }

    setIsLoading(true);
    setError('');
    setOtp(''); // Reset OTP when sending new one
    try {
      await api.sendOTP(phone);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStep('otp');
      setTimer(RESEND_SECONDS);
    } catch (err: any) {
      setError(err.message || t('login_send_failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < OTP_LENGTH) {
      setError(t('login_otp_invalid'));
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await api.verifyOTP(phone, otp);
      navigation.replace('Main');
    } catch (err: any) {
      Vibration.vibrate(400); // Vibrate on wrong OTP
      setError(err.message || t('login_otp_wrong'));
    } finally {
      setIsLoading(false);
    }
  };

  const changePhone = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStep('phone');
    setOtp('');
    setError('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.hero}>
            <Image
              source={require('../../assets/margix_truck_illustration.jpg')}
              style={styles.illustration}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
          </View>

          <View style={styles.sheet}>
            <Image
              source={require('../../assets/margix-logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="MargixIndia"
            />

            <LanguagePicker />

            <View style={styles.heading}>
              <Text variant="heading" align="center" accessibilityRole="header">
                {t('login_welcome')}
              </Text>
              <Text variant="bodySmall" color="textMuted" align="center">
                {step === 'phone' ? t('login_subtitle') : t('login_code_sent', { phone })}
              </Text>
            </View>

            {step === 'phone' ? (
              <View style={styles.form}>
                <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
                  <Text variant="bodyMedium">+91</Text>
                  <View style={styles.divider} />
                  <TextInput
                    style={styles.input}
                    placeholder={t('login_phone_placeholder')}
                    placeholderTextColor={colors.textPlaceholder}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={10}
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      if (phone.length >= 10 && !isLoading) handleSendOtp();
                    }}
                    value={phone}
                    accessibilityLabel={t('login_phone_label')}
                    onChangeText={(text) => {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      setPhone(cleaned);
                      if (error) setError('');
                      if (cleaned.length === 10) Keyboard.dismiss();
                    }}
                  />
                </View>

                {error ? (
                  <Text variant="bodySmall" color="danger" align="center" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}

                <Button title={t('login_get_otp')} onPress={handleSendOtp} loading={isLoading} disabled={phone.length < 10} />
              </View>
            ) : (
              <View style={styles.form}>
                <Pressable
                  style={styles.otpContainer}
                  onPress={() => otpInputRef.current?.focus()}
                  accessibilityRole="none"
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  {Array.from({ length: OTP_LENGTH }, (_, index) => {
                    const isActive = otpFocused && otp.length === index;
                    return (
                      <View key={index} style={[styles.otpBox, isActive && styles.otpBoxActive]}>
                        <Text variant="heading">{otp[index] || ''}</Text>
                      </View>
                    );
                  })}
                </Pressable>

                {/* The visible boxes mirror this input, which holds the code. */}
                <TextInput
                  ref={otpInputRef}
                  style={styles.hiddenOtpInput}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={OTP_LENGTH}
                  value={otp}
                  accessibilityLabel={t('login_otp_label')}
                  onFocus={() => setOtpFocused(true)}
                  onBlur={() => setOtpFocused(false)}
                  onChangeText={(text) => {
                    const cleaned = text.replace(/[^0-9]/g, '');
                    setOtp(cleaned);
                    if (error) setError('');
                    if (cleaned.length === OTP_LENGTH) Keyboard.dismiss();
                  }}
                  autoFocus
                />

                {error ? (
                  <Text variant="bodySmall" color="danger" align="center" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}

                <Button title={t('login_verify')} onPress={handleVerifyOtp} loading={isLoading} disabled={otp.length < OTP_LENGTH} />

                <View style={styles.secondaryActions}>
                  <Button
                    title={timer > 0 ? t('login_resend_in', { sec: timer.toString().padStart(2, '0') }) : t('login_resend')}
                    variant="ghost"
                    block={false}
                    onPress={handleSendOtp}
                    disabled={timer > 0 || isLoading}
                  />
                  <Button title={t('login_change_number')} variant="ghost" block={false} onPress={changePhone} />
                </View>
              </View>
            )}

            <Text variant="caption" color="textMuted" align="center" style={styles.terms}>
              {t('login_terms')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const OTP_BOX_WIDTH = 44;
const OTP_BOX_HEIGHT = 56;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.accentSoft },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  hero: {
    flex: 1,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
  },
  illustration: { width: '100%', height: 200 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: space[6],
    paddingTop: space[6],
    paddingBottom: space[6],
    gap: space[4],
  },
  logo: { width: 150, height: 40, alignSelf: 'center' },
  heading: { gap: space[1] },
  form: { gap: space[3] },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    borderRadius: radius.control,
    minHeight: size.control,
    paddingHorizontal: space[4],
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  divider: {
    width: size.border,
    height: space[6],
    backgroundColor: colors.border,
    marginHorizontal: space[3],
  },
  input: {
    ...type.body,
    flex: 1,
    color: colors.text,
    minHeight: size.control,
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[2],
  },
  otpBox: {
    width: OTP_BOX_WIDTH,
    height: OTP_BOX_HEIGHT,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpBoxActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  hiddenOtpInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: space[2],
  },
  terms: { paddingTop: space[2] },
});
