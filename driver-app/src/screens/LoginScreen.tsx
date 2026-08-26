/**
 * margixindia Driver App — OTP Login Screen
 * Phone number → Send OTP → Verify OTP → Auto-login
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { api } from '../services/api';
import { useTranslation } from '../hooks/useTranslation';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

type Step = 'phone' | 'otp';

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { t, lang, setLanguage, isLoaded } = useTranslation();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [maskedPhone, setMaskedPhone] = useState('');

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
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    try {
      const result = await api.sendOTP(cleaned);
      setMaskedPhone(result.phone || `+91******${cleaned.slice(-4)}`);
      setCountdown(30);
      setStep('otp');
      setOtp(['', '', '', '', '', '']);

      setTimeout(() => otpRefs.current[0]?.focus(), 300);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ─────────────────────────────────────────────
  const handleVerifyOTP = async (overrideOtp?: string) => {
    const otpString = overrideOtp || otp.join('');
    if (otpString.length !== 6) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const data = await api.verifyOTP(phone.replace(/\s/g, ''), otpString);
      if (data.driver?.language_preference) {
        await setLanguage(data.driver.language_preference as any);
      }
      onLoginSuccess();
    } catch (e: any) {
      Alert.alert(t('login_failed'), e.message || 'Incorrect OTP');
      setOtp(['', '', '', '', '', '']);
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
      for (let i = 0; i < digits.length && (i + index) < 6; i++) {
        newOtp[index + i] = digits[i];
      }
      setOtp(newOtp);

      const nextFocus = Math.min(index + digits.length, 5);
      otpRefs.current[nextFocus]?.focus();

      const full = newOtp.join('');
      if (full.length === 6) {
        setTimeout(() => handleVerifyOTP(full), 200);
      }
      return;
    }

    // Normal single-digit entry
    const newOtp = [...otp];
    newOtp[index] = digits;
    setOtp(newOtp);

    // Auto-advance to next input
    if (digits && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (index === 5 && digits) {
      const full = newOtp.join('');
      if (full.length === 6) {
        setTimeout(() => handleVerifyOTP(full), 200);
      }
    }
  };

  const handleOTPKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  if (!isLoaded) return null;

  // ── PHONE STEP ─────────────────────────────────────────────
  if (step === 'phone') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Top Header */}
        <View style={styles.topHeader}>
          <Text style={styles.topLogo}>ROUTE<Text style={{ color: '#27A150' }}>IQ</Text></Text>
        </View>

        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('driver_login')}</Text>
            <Text style={styles.subtitle}>{t('phone_number')}</Text>
          </View>
          <View style={styles.phoneInputContainer}>
            <View style={styles.countryCode}>
              <Text style={styles.countryFlag}>🇮🇳</Text>
              <Text style={styles.countryCodeText}>+91</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              placeholder="10-digit mobile number"
              placeholderTextColor="#9CA3AF"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={10}
              autoFocus
            />
          </View>

          <TouchableOpacity
            style={[styles.button, phone.length < 10 && styles.buttonDisabled]}
            onPress={handleSendOTP}
            disabled={loading || phone.length < 10}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('send_otp')}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            By continuing, you agree to margixindia's Terms of Service
          </Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── OTP STEP ───────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <TouchableOpacity style={styles.backButton} onPress={() => { setStep('phone'); setOtp(['', '', '', '', '', '']); }}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{t('enter_otp')}</Text>
        <Text style={styles.subtitle}>
          {t('enter_otp')} sent to{'\n'}
          <Text style={styles.phoneHighlight}>{maskedPhone}</Text>
        </Text>

        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => { otpRefs.current[index] = ref; }}
              style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
              value={digit}
              onChangeText={(v) => handleOTPChange(v, index)}
              onKeyPress={(e) => handleOTPKeyPress(e, index)}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              selectTextOnFocus
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.button, otp.join('').length < 6 && styles.buttonDisabled]}
          onPress={() => handleVerifyOTP()}
          disabled={loading || otp.join('').length < 6}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('verify_otp')}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.resendContainer}>
          {countdown > 0 ? (
            <Text style={styles.resendText}>
              Resend OTP in <Text style={styles.countdownText}>{Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}</Text>
            </Text>
          ) : (
            <TouchableOpacity onPress={handleSendOTP}>
              <Text style={styles.resendLink}>Resend OTP</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  langBtn: { minWidth: 40, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E8E8' },
  langBtnActive: { backgroundColor: '#FFF5F6', borderColor: '#E23744' },
  langText: { fontSize: 13, fontWeight: '700', color: '#4F4F4F' },
  langTextActive: { fontSize: 13, fontWeight: '800', color: '#E23744' },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBox: {
    marginBottom: 24,
  },
  logoIcon: {
    fontSize: 32,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    fontWeight: '500',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRightWidth: 2,
    borderRightColor: '#E5E7EB',
    paddingVertical: 18,
  },
  countryFlag: {
    fontSize: 22,
    marginRight: 6,
  },
  countryCodeText: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
    color: '#111827',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  button: {
    backgroundColor: '#27A150',
    borderRadius: 16,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#27A150',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  buttonDisabled: {
    backgroundColor: '#E5E7EB',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  disclaimer: { color: '#9CA3AF', fontSize: 12, textAlign: 'center', marginTop: 24 },

  topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20 },
  topLogo: { color: '#111827', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  langToggleGroup: { flexDirection: 'row', backgroundColor: '#F1F3F5', borderRadius: 20, padding: 2 },
  langToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18 },
  langToggleActive: { backgroundColor: '#E23744' },
  langToggleText: { fontSize: 10, fontWeight: '800', color: '#6B7280' },
  langToggleTextActive: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  backButton: {
    marginBottom: 16,
  },
  backText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
  phoneHighlight: {
    color: '#111827',
    fontWeight: '700',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 36,
  },
  otpInput: {
    width: 48,
    height: 60,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    textAlign: 'center',
    color: '#111827',
    fontSize: 24,
    fontWeight: '800',
  },
  otpInputFilled: {
    borderColor: '#27A150',
    backgroundColor: '#FFFFFF',
    shadowColor: '#27A150',
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  resendText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '500',
  },
  countdownText: {
    color: '#27A150',
    fontWeight: '800',
  },
  resendLink: {
    color: '#27A150',
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
