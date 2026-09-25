import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
  Vibration
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../services/api';

const { width, height } = Dimensions.get('window');

export default function LoginScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(60);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === 'otp' && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const handleSendOtp = async () => {
    if (!phone || phone.length < 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    setIsLoading(true);
    setError('');
    setOtp(''); // Reset OTP when sending new one
    try {
      await api.sendOTP(phone);
      setStep('otp');
      setTimer(60); // Start or reset the 1-minute countdown
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      setError('Please enter a valid 6-digit OTP');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await api.verifyOTP(phone, otp);
      navigation.replace('Home');
    } catch (err: any) {
      Vibration.vibrate(400); // Vibrate on wrong OTP
      setError(err.message || 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <LinearGradient
            colors={['#0D9488', '#0F766E']}
            style={styles.headerBackground}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Abstract background shapes for premium feel */}
            <View style={styles.abstractCircle1} />
            <View style={styles.abstractCircle2} />

            <View style={styles.headerContent}>
              <Text style={styles.headerTitleRow}>
                <Text style={styles.headerTitle}>MOVE </Text>
                <Text style={styles.dot}>• </Text>
                <Text style={styles.headerTitle}>CONNECT </Text>
                <Text style={styles.dot}>• </Text>
                <Text style={styles.headerTitleHighlight}>GROW</Text>
              </Text>
            </View>

            <Image
              source={require('../../assets/margix_truck_illustration.jpg')}
              style={styles.truckIllustration}
              resizeMode="contain"
            />
          </LinearGradient>

          {/* Bottom Sheet Login Card */}
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />

            <Image
              source={require('../../assets/margix-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />

            <Text style={styles.welcomeText}>Welcome to Margix India</Text>
            <Text style={styles.subText}>Smart, fast, and reliable transport solutions</Text>

            {step === 'phone' ? (
              <View style={styles.formContainer}>
                <View style={styles.inputWrapper}>
                  <Text style={styles.prefix}>+91</Text>
                  <View style={styles.divider} />
                  <TextInput
                    style={styles.input}
                    placeholder="Enter Phone Number"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={(text) => {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      setPhone(cleaned);
                      if (cleaned.length === 10) Keyboard.dismiss();
                    }}
                  />
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <View style={styles.orContainer}>
                  <View style={styles.line} />
                  <Text style={styles.orText}>OR</Text>
                  <View style={styles.line} />
                </View>

                <TouchableOpacity
                  style={[styles.button, (isLoading || phone.length < 10) && styles.buttonDisabled]}
                  onPress={handleSendOtp}
                  disabled={isLoading || phone.length < 10}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={styles.buttonText}>Get OTP via SMS</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.formContainer}>
                <Text style={styles.otpSentText}>Code sent to +91 {phone}</Text>

                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.otpInput}
                    placeholder="Enter 6-digit OTP"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={otp}
                    onChangeText={(text) => {
                      const cleaned = text.replace(/[^0-9]/g, '');
                      setOtp(cleaned);
                      if (cleaned.length === 6) Keyboard.dismiss();
                    }}
                    textAlign="center"
                  />
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.button, (isLoading || otp.length < 6) && styles.buttonDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={isLoading || otp.length < 6}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={styles.buttonText}>Verify & Connect</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.bottomActions}>
                  <TouchableOpacity 
                    style={styles.secondaryBtn} 
                    onPress={handleSendOtp}
                    disabled={timer > 0 || isLoading}
                  >
                    <Text style={[styles.secondaryBtnText, timer > 0 && styles.secondaryBtnTextDisabled]}>
                      {timer > 0 ? `Resend OTP in 00:${timer.toString().padStart(2, '0')}` : 'Resend OTP'}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.actionDivider}>•</Text>

                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setStep('phone'); setOtp(''); }}>
                    <Text style={styles.secondaryBtnText}>Change Phone</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.termsText}>
              By continuing, I agree to the <Text style={styles.linkText}>terms & conditions</Text> and <Text style={styles.linkText}>privacy policy</Text>.
            </Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D9488',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  headerBackground: {
    height: height * 0.5,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  abstractCircle1: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  abstractCircle2: {
    position: 'absolute',
    bottom: 50,
    left: -80,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(255, 200, 0, 0.15)',
  },
  headerContent: {
    alignItems: 'center',
    position: 'absolute',
    top: 30, // Moved closer to the top
    zIndex: 2,
    width: '100%',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  headerTitle: {
    fontSize: 22, // Reduced to fit on one line
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  headerTitleHighlight: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFC800',
    letterSpacing: 1.5,
  },
  dot: {
    fontSize: 22,
    fontWeight: '900',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  truckIllustration: {
    position: 'absolute',
    bottom: height * 0.12, // Adjusted to give more space
    width: width * 1.1,
    height: 220,
    opacity: 0.95,
    zIndex: 1,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 20,
    alignItems: 'center',
    marginTop: height * 0.4, // Create the overlap effect
    minHeight: height * 0.6,
  },
  sheetHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    marginBottom: 24,
  },
  logo: {
    width: 150,
    height: 40,
    marginBottom: 16,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subText: {
    fontSize: 14,
    color: '#4B5563',
    marginBottom: 24,
  },
  formContainer: {
    width: '100%',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB',
  },
  prefix: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    height: '100%',
  },
  otpInput: {
    flex: 1,
    fontSize: 18,
    letterSpacing: 4,
    fontWeight: 'bold',
    color: '#111827',
    height: '100%',
  },
  orContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  orText: {
    marginHorizontal: 12,
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#FFC800', // Margix Yellow
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFC800',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#FCD34D',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  otpSentText: {
    textAlign: 'center',
    color: '#4B5563',
    marginBottom: 16,
    fontSize: 14,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  secondaryBtn: {
    padding: 8,
  },
  secondaryBtnText: {
    color: '#0D9488',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtnTextDisabled: {
    color: '#9CA3AF',
  },
  actionDivider: {
    color: '#D1D5DB',
    marginHorizontal: 8,
    fontSize: 14,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  termsText: {
    marginTop: 'auto',
    textAlign: 'center',
    fontSize: 12,
    color: '#6B7280',
    paddingTop: 24,
  },
  linkText: {
    color: '#0D9488',
    fontWeight: '500',
  },
});
