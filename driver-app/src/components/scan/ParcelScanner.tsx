import React, { useCallback, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';

export type ScanMethod = 'camera' | 'manual';

interface ParcelScannerProps {
  /** Called once per scan; the scanner pauses until `busy` clears or the driver taps again. */
  onCode: (code: string, method: ScanMethod) => void;
  /** Pauses the camera while a result is being worked out. */
  busy?: boolean;
  /** Camera preview height. */
  height?: number;
}

const BARCODE_TYPES = ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a'] as const;
/** Ignore the same code read again this soon (the camera reports it every frame). */
const REPEAT_WINDOW_MS = 2500;

/**
 * Camera scanner for parcel QR codes and barcodes, with a typed-code fallback for
 * a torn label or a refused camera permission.
 */
export default function ParcelScanner({ onCode, busy = false, height = 260 }: ParcelScannerProps) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const last = useRef<{ code: string; at: number } | null>(null);

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      const code = data?.trim();
      if (!code || busy) return;
      const now = Date.now();
      if (last.current && last.current.code === code && now - last.current.at < REPEAT_WINDOW_MS) return;
      last.current = { code, at: now };
      onCode(code, 'camera');
    },
    [busy, onCode],
  );

  const submitTyped = () => {
    const code = typed.trim();
    if (!code) return;
    onCode(code, 'manual');
    setTyped('');
  };

  const cameraBlocked = permission && !permission.granted;

  return (
    <View style={styles.wrap}>
      {!typing ? (
        permission?.granted ? (
          <View style={[styles.camera, { height }]}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={busy ? undefined : handleScanned}
            />
            <View style={styles.frame} pointerEvents="none" />
          </View>
        ) : (
          <View style={[styles.camera, styles.placeholder, { height }]}>
            <Ionicons name="camera-outline" size={size.icon.xl} color={colors.textMuted} />
            <Text variant="bodySmall" color="textMuted" align="center">
              {cameraBlocked ? t('scan_camera_denied') : t('scan_camera_needed')}
            </Text>
            {permission?.canAskAgain === false ? (
              <Button title={t('open_settings')} variant="secondary" block={false} onPress={() => Linking.openSettings()} />
            ) : (
              <Button title={t('scan_allow_camera')} variant="secondary" block={false} onPress={requestPermission} />
            )}
          </View>
        )
      ) : null}

      {typing ? (
        <View style={styles.typing}>
          <TextField
            label={t('scan_code_label')}
            placeholder={t('scan_code_placeholder')}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitTyped}
          />
          <Button title={t('scan_check_code')} onPress={submitTyped} disabled={!typed.trim() || busy} loading={busy} />
        </View>
      ) : null}

      <Button
        title={typing ? t('scan_use_camera') : t('scan_enter_manually')}
        variant="ghost"
        onPress={() => setTyping((v) => !v)}
        icon={(color) => <Ionicons name={typing ? 'camera-outline' : 'keypad-outline'} size={size.icon.md} color={color} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  camera: { overflow: 'hidden', borderRadius: radius.card, backgroundColor: colors.surfaceSubtle },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: space[3], padding: space[4] },
  frame: {
    position: 'absolute',
    top: '18%',
    bottom: '18%',
    left: '18%',
    right: '18%',
    borderWidth: 2,
    borderColor: colors.onSolid,
    borderRadius: radius.card,
  },
  typing: { gap: space[3] },
});
