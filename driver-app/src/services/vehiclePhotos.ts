/**
 * Vehicle photos taken or picked on the phone. Each picture is shrunk to a JPEG
 * (this also turns iPhone HEIC photos into JPEG, which the server accepts) and
 * uploaded with a signed URL the backend issues for one path; then the file is
 * recorded as the vehicle's photo for that slot. All photos are optional.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError, NetworkError, type VehiclePhotoSlot } from './api';

const MAX_WIDTH = 1600;
const QUALITY = 0.7;

export const PHOTO_SLOTS: { slot: VehiclePhotoSlot; labelKey: string }[] = [
  { slot: 'front', labelKey: 'vehicle_photo_front' },
  { slot: 'side', labelKey: 'vehicle_photo_side' },
  { slot: 'back', labelKey: 'vehicle_photo_back' },
  { slot: 'interior', labelKey: 'vehicle_photo_interior' },
  { slot: 'cargo', labelKey: 'vehicle_photo_cargo' },
];

/** Asks camera or gallery, then returns a compressed local JPEG, or null when the driver backed out. */
export async function chooseVehiclePhoto(t: (key: string) => string): Promise<string | null> {
  const source = await new Promise<'camera' | 'gallery' | null>((resolve) => {
    Alert.alert(
      t('vehicle_photo_add'),
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

/** Uploads one local JPEG as the vehicle's photo for `slot`. Throws on failure so the caller can say so. */
export async function uploadVehiclePhoto(vehicleId: string, slot: VehiclePhotoSlot, uri: string): Promise<void> {
  const contentType = 'image/jpeg';
  let blob: Blob;
  try {
    blob = await (await fetch(uri)).blob();
  } catch {
    throw new Error('The photo could not be read from the phone.');
  }
  const target = await api.getVehiclePhotoUploadUrl(vehicleId, { slot, content_type: contentType, size: blob.size });
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
  if (!response.ok) throw new ApiError(`The photo could not be uploaded (${response.status})`, response.status);
  await api.saveVehiclePhoto(vehicleId, slot, target.path);
}

/** Uploads the photos picked before the vehicle existed. Returns the slots that failed. */
export async function uploadStagedPhotos(vehicleId: string, staged: Partial<Record<VehiclePhotoSlot, string>>): Promise<VehiclePhotoSlot[]> {
  const failed: VehiclePhotoSlot[] = [];
  for (const { slot } of PHOTO_SLOTS) {
    const uri = staged[slot];
    if (!uri) continue;
    try {
      await uploadVehiclePhoto(vehicleId, slot, uri);
    } catch {
      failed.push(slot);
    }
  }
  return failed;
}
