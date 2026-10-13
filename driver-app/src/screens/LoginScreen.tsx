/**
 * MargixIndia Driver App — OTP Login Screen
 * Phone number → Send OTP → Verify OTP → Auto-login
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useTranslation } from '../hooks/useTranslation';
import LanguagePicker from '../components/LanguagePicker';
import { Button, Card, Text } from '../components/ui';
import { colors, radius, size, space, type } from '../theme';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

type Step = 'phone' | 'otp';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;
const emptyOtp = () => Array<string>(OTP_LENGTH).fill('');

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { t, setLanguage, isLoaded } = useTranslation();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(emptyOtp);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [error, setError] = useState('');
  const [autoFetchedOtp, setAutoFetchedOtp] = useState<string | null>(null);
  const [fetchingOtp, setFetchingOtp] = useState(false);

  const otpRefs = useRef<(TextInput | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // ── Send OTP ───────────────────────────────────────────────
  const handleSendOTP = async () => {
    const cleaned = phone.replace(/\s/g, '');
    if (cleaned.length < 10) {
      setError(t('invalid_phone'));
      return;
    }

    setLoading(true);
    setError('');
    setAutoFetchedOtp(null);
    try {
      const result = await api.sendOTP(cleaned);
      setMaskedPhone(result.phone || `+91******${cleaned.slice(-4)}`);
      setCountdown(RESEND_SECONDS);
      setStep('otp');

      // Auto-fetch direct from server
      let serverOtp = result.otp;
      if (!serverOtp) {
        try {
          const latest = await api.getLatestOTP(cleaned);
          if (latest?.otp) serverOtp = latest.otp;
        } catch {
          // ignore
        }
      }

      if (serverOtp && serverOtp.length === OTP_LENGTH) {
        setAutoFetchedOtp(serverOtp);
        const digits = serverOtp.split('');
        setOtp(digits);
        setTimeout(() => {
          handleVerifyOTP(serverOtp);
        }, 500);
      } else {
        setOtp(emptyOtp());
        setTimeout(() => otpRefs.current[0]?.focus(), 300);
      }
    } catch (e: any) {
      setError(e.message || t('send_otp_failed'));
    } finally {
      setLoading(false);
    }
  };

  // ── Direct OTP Fetch from Server ───────────────────────────
  const handleFetchOtpFromServer = async () => {
    const cleaned = phone.replace(/\s/g, '');
    if (cleaned.length < 10) return;
    setFetchingOtp(true);
    setError('');
    try {
      const latest = await api.getLatestOTP(cleaned);
      if (latest?.otp && latest.otp.length === OTP_LENGTH) {
        setAutoFetchedOtp(latest.otp);
        setOtp(latest.otp.split(''));
        setTimeout(() => {
          handleVerifyOTP(latest.otp);
        }, 400);
      } else {
        setError('No active OTP found on server. Please request a new OTP.');
      }
    } catch (e: any) {
      setError(e.message || 'Could not fetch OTP from server');
    } finally {
      setFetchingOtp(false);
    }
  };

  // ── Verify OTP ─────────────────────────────────────────────
  const handleVerifyOTP = async (overrideOtp?: string) => {
    const otpString = overrideOtp || otp.join('');
    if (otpString.length !== OTP_LENGTH) {
      setError(t('invalid_otp'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await api.verifyOTP(phone.replace(/\s/g, ''), otpString);
      if (data.driver?.language_preference) {
        await setLanguage(data.driver.language_preference as any);
      }
      onLoginSuccess();
    } catch (e: any) {
      setError(e.message || t('login_failed'));
      setOtp(emptyOtp());
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  // ── OTP Input Handler ──────────────────────────────────────
  const handleOTPChange = (value: string, index: number) => {
    const digits = value.replace(/\D/g, '');

    // Handle paste / autofill (if OS pastes 6 digits at once)
    if (digits.length > 1) {
      const newOtp = [...otp];
      for (let i = 0; i < digits.length && i + index < OTP_LENGTH; i++) {
        newOtp[index + i] = digits[i];
      }
      setOtp(newOtp);

      const nextFocus = Math.min(index + digits.length, OTP_LENGTH - 1);
      otpRefs.current[nextFocus]?.focus();

      const full = newOtp.join('');
      if (full.length === OTP_LENGTH) {
        setTimeout(() => handleVerifyOTP(full), 200);
      }
      return;
    }

    // Normal single-digit entry
    const newOtp = [...otp];
    newOtp[index] = digits;
    setOtp(newOtp);

    // Auto-advance to next input
    if (digits && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (index === OTP_LENGTH - 1 && digits) {
      const full = newOtp.join('');
      if (full.length === OTP_LENGTH) {
        setTimeout(() => handleVerifyOTP(full), 200);
      }
    }
  };

  const handleOTPKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const goBackToPhone = () => {
    setStep('phone');
    setOtp(emptyOtp());
    setAutoFetchedOtp(null);
    setError('');
  };

  if (!isLoaded) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text variant="title" color="accent" style={styles.brand} accessibilityRole="header">
            MargixIndia
          </Text>

          {/* Before signing in, the driver can already read the screen in their own language. */}
          <LanguagePicker />

          <Card style={styles.card}>
            {step === 'phone' ? (
              <>
                <View style={styles.heading}>
                  <Text variant="heading" accessibilityRole="header">
                    {t('driver_login')}
                  </Text>
                  <Text variant="bodySmall" color="textMuted">
                    {t('phone_number')}
                  </Text>
                </View>

                <View style={[styles.phoneRow, error ? styles.inputError : null]}>
                  <View style={styles.countryCode}>
                    <Text variant="bodyMedium">+91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder={t('login_phone_placeholder')}
                    placeholderTextColor={colors.textPlaceholder}
                    value={phone}
                    onChangeText={(v) => {
                      setPhone(v.replace(/\D/g, ''));
                      if (error) setError('');
                    }}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={10}
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      if (phone.length >= 10 && !loading) handleSendOTP();
                    }}
                    accessibilityLabel={t('phone_number')}
                  />
                </View>

                {error ? (
                  <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}

                <Button
                  title={t('send_otp')}
                  onPress={handleSendOTP}
                  loading={loading}
                  disabled={phone.length < 10}
                />

                <Text variant="caption" color="textMuted" align="center">
                  {t('login_terms')}
                </Text>
              </>
            ) : (
              <>
                <Button
                  title={t('back')}
                  variant="ghost"
                  block={false}
                  style={styles.back}
                  onPress={goBackToPhone}
                  icon={(color) => <Ionicons name="arrow-back" size={size.icon.md} color={color} />}
                />

                <View style={styles.heading}>
                  <Text variant="heading" accessibilityRole="header">
                    {t('enter_otp')}
                  </Text>
                  <Text variant="bodySmall" color="textMuted">
                    {t('otp_sent_to')}{' '}
                    <Text variant="monoMedium">{maskedPhone}</Text>
                  </Text>
                </View>

                {autoFetchedOtp ? (
                  <View style={styles.autoFetchBadge}>
                    <Ionicons name="flash" size={16} color={colors.accent} />
                    <Text variant="bodySmall" color="accent" style={styles.autoFetchText}>
                      Auto-fetched OTP: {autoFetchedOtp}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.otpRow}>
                  {otp.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={(ref) => {
                        otpRefs.current[index] = ref;
                      }}
                      style={[styles.otpInput, digit ? styles.otpInputFilled : null, error ? styles.inputError : null]}
                      value={digit}
                      onChangeText={(v) => handleOTPChange(v, index)}
                      onKeyPress={(e) => handleOTPKeyPress(e, index)}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={OTP_LENGTH}
                      selectTextOnFocus
                      accessibilityLabel={`${t('otp_digit_label')} ${index + 1} ${t('of')} ${OTP_LENGTH}`}
                    />
                  ))}
                </View>

                {error ? (
                  <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}

                <Button
                  title={t('verify_otp')}
                  onPress={() => handleVerifyOTP()}
                  loading={loading}
                  disabled={otp.join('').length < OTP_LENGTH}
                />

                <View style={styles.resend}>
                  <Button
                    title={fetchingOtp ? 'Fetching from server...' : '⚡ Fetch OTP from server'}
                    variant="ghost"
                    block={false}
                    onPress={handleFetchOtpFromServer}
                    disabled={loading || fetchingOtp}
                  />
                  {countdown > 0 ? (
                    <Text variant="bodySmall" color="textMuted">
                      {t('resend_otp_in')}{' '}
                      <Text variant="monoMedium">
                        {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                      </Text>
                    </Text>
                  ) : (
                    <Button title={t('resend_otp')} variant="ghost" block={false} onPress={handleSendOTP} disabled={loading || fetchingOtp} />
                  )}
                </View>
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const OTP_BOX_WIDTH = 44; // boxes share the row and shrink on a 360 dp phone
const OTP_BOX_HEIGHT = 56;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space[4], gap: space[6] },
  brand: { textAlign: 'center' },
  card: { gap: space[4], padding: space[6] },
  heading: { gap: space[1] },
  back: { alignSelf: 'flex-start', paddingHorizontal: space[2] },
  autoFetchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    backgroundColor: colors.accentSoft,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    alignSelf: 'stretch',
  },
  autoFetchText: {
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.control,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  countryCode: {
    paddingHorizontal: space[3],
    alignSelf: 'stretch',
    justifyContent: 'center',
    borderRightWidth: size.border,
    borderRightColor: colors.border,
  },
  phoneInput: {
    ...type.body,
    flex: 1,
    color: colors.text,
    paddingHorizontal: space[3],
    minHeight: size.control,
  },
  inputError: { borderColor: colors.danger },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2] },
  otpInput: {
    ...type.heading,
    flex: 1,
    maxWidth: OTP_BOX_WIDTH + space[1],
    minWidth: 0,
    height: OTP_BOX_HEIGHT,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.text,
    textAlign: 'center',
  },
  otpInputFilled: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  resend: { alignItems: 'center', minHeight: size.control, justifyContent: 'center', gap: space[2] },
});
