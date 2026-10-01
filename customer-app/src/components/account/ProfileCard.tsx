import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Banner, Button, Card, ErrorBanner, OptionPicker, Text, TextField } from '../ui';
import { api } from '../../services/api';
import { INDIAN_STATES } from '../../constants/indianStates';
import { useTranslation } from '../../hooks/useTranslation';
import { changedFields, profileToForm, type ProfileField, type ProfileForm } from '../../utils/profile';
import { emailError, gstinError, pincodeError } from '../../utils/validation';
import { colors, size, space } from '../../theme';

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));

/**
 * The customer's billing details: name, company, GSTIN, address. They print as the buyer on invoices.
 * Only the fields that were edited are sent; the server's own message for a refused value shows under the form.
 */
export function ProfileCard() {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<ProfileForm | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .getProfile()
      .then((p) => {
        const f = profileToForm(p);
        // Keep what the customer is typing if this screen regains focus mid-edit.
        setInitial((prev) => prev ?? f);
        setForm((prev) => prev ?? f);
      })
      .catch((e: any) => setLoadError(e?.message || t('profile_load_failed')));
  }, [t]);

  useFocusEffect(load);

  if (!form || !initial) {
    return (
      <Card style={styles.card}>
        <Text variant="title" accessibilityRole="header">
          {t('profile_title')}
        </Text>
        {loadError ? <ErrorBanner message={loadError} action={{ label: t('try_again'), onPress: load }} /> : <ActivityIndicator color={colors.accent} />}
      </Card>
    );
  }

  const set = (field: ProfileField) => (value: string) => {
    setForm({ ...form, [field]: value });
    setSaved(false);
    setServerError(null);
  };

  const errors: Partial<Record<ProfileField, string | null>> = {
    gstin: gstinError(form.gstin.trim()),
    email: emailError(form.email.trim()),
    pincode: pincodeError(form.pincode.trim()),
  };
  const msg = (f: ProfileField) => (showErrors && errors[f] ? t(errors[f] as string) : undefined);
  const changes = changedFields(initial, form);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setSaved(false);
    setServerError(null);
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const profile = await api.updateProfile(changes);
      const f = profileToForm(profile);
      setInitial(f);
      setForm(f);
      setShowErrors(false);
      setSaved(true);
    } catch (e: any) {
      setServerError(e?.message || t('err_server'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('profile_title')}
      </Text>
      <Text variant="bodySmall" color="textMuted">
        {t('profile_intro')}
      </Text>
      <TextField label={t('profile_full_name')} value={form.full_name} onChangeText={set('full_name')} autoCapitalize="words" textContentType="name" maxLength={120} />
      <TextField label={t('profile_company')} value={form.company_name} onChangeText={set('company_name')} autoCapitalize="words" maxLength={200} />
      <TextField
        label={t('profile_gstin')}
        hint={t('profile_gstin_hint')}
        value={form.gstin}
        onChangeText={(v) => set('gstin')(v.toUpperCase().replace(/\s/g, ''))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={15}
        error={msg('gstin')}
      />
      <TextField
        label={t('profile_email')}
        value={form.email}
        onChangeText={set('email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        maxLength={200}
        error={msg('email')}
      />
      <TextField label={t('profile_address')} value={form.billing_address} onChangeText={set('billing_address')} multiline maxLength={500} textContentType="fullStreetAddress" />
      <TextField label={t('profile_city')} value={form.city} onChangeText={set('city')} autoCapitalize="words" maxLength={100} />
      <OptionPicker
        label={t('profile_state')}
        value={form.state}
        options={STATE_OPTIONS}
        onChange={set('state')}
        placeholder={t('profile_state_choose')}
        closeLabel={t('close')}
      />
      <TextField
        label={t('profile_pincode')}
        value={form.pincode}
        onChangeText={(v) => set('pincode')(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={6}
        error={msg('pincode')}
      />
      {serverError ? <ErrorBanner message={serverError} /> : null}
      {saved ? <Banner tone="neutral" icon="check-circle" message={t('profile_saved')} /> : null}
      <Button
        title={t('profile_save')}
        onPress={save}
        loading={saving}
        disabled={!dirty || saving}
        icon={(color) => <Feather name="save" size={size.icon.md} color={color} />}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
});
