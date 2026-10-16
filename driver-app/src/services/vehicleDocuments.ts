/**
 * Vehicle documents (RC, insurance, fitness, permit, PUC) picked or photographed on the phone. Each
 * picture is shrunk to a JPEG and uploaded with a signed URL the backend issues for one path, then
 * recorded as the vehicle's document for that slot. Mirrors services/vehiclePhotos.ts.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError, NetworkError, type VehicleDocumentSlot } from './api';

const MAX_WIDTH = 2000;
const QUALITY = 0.75;

export const DOCUMENT_SLOTS: { slot: VehicleDocumentSlot; labelKey: string }[] = [
  { slot: 'rc', labelKey: 'vehicle_document_rc' },
  { slot: 'insurance', labelKey: 'vehicle_document_insurance' },
  { slot: 'fitness', labelKey: 'vehicle_document_fitness' },
  { slot: 'permit', labelKey: 'vehicle_document_permit' },
  { slot: 'puc', labelKey: 'vehicle_document_puc' },
];

/** Asks camera or gallery, then returns a compressed local JPEG, or null when the driver backed out. */
export async function chooseVehicleDocument(t: (key: string) => string): Promise<string | null> {
  const source = await new Promise<'camera' | 'gallery' | null>((resolve) => {
    Alert.alert(
      t('vehicle_document_add'),
      undefined,
      [
        { text: t('doc_take_photo'), onPress: () => resolve('camera') },
        { text: t('doc_choose_gallery'), onPress: () => resolve('gallery') },
        { text: t('cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
  if (!source) return null;
  try {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('error'), t(source === 'camera' ? 'doc_permission_camera' : 'doc_permission_gallery'));
      return null;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return null;
    const jpeg = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: MAX_WIDTH } }], {
      compress: QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return jpeg.uri;
  } catch {
    Alert.alert(t('error'), t('doc_pick_failed'));
    return null;
  }
}

/** Uploads one local JPEG as the vehicle's document for `slot`. Throws on failure so the caller can say so. */
export async function uploadVehicleDocument(vehicleId: string, slot: VehicleDocumentSlot, uri: string): Promise<void> {
  const contentType = 'image/jpeg';
  let blob: Blob;
  try {
    blob = await (await fetch(uri)).blob();
  } catch {
    throw new Error('The document could not be read from the phone.');
  }
  const target = await api.getVehicleDocumentUploadUrl(vehicleId, { slot, content_type: contentType, size: blob.size });
  let response: Response;
  try {
    response = await fetch(target.signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: blob,
    });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw new ApiError(`The document could not be uploaded (${response.status})`, response.status);
  await api.saveVehicleDocument(vehicleId, slot, target.path);
}

/** Uploads the documents picked before the vehicle existed. Returns the slots that failed. */
export async function uploadStagedDocuments(vehicleId: string, staged: Partial<Record<VehicleDocumentSlot, string>>): Promise<VehicleDocumentSlot[]> {
  const failed: VehicleDocumentSlot[] = [];
  for (const { slot } of DOCUMENT_SLOTS) {
    const uri = staged[slot];
    if (!uri) continue;
    try {
      await uploadVehicleDocument(vehicleId, slot, uri);
    } catch {
      failed.push(slot);
    }
  }
  return failed;
}
