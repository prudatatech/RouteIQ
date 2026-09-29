/**
 * Font files for the theme, loaded once at app start with expo-font's useFonts.
 * Imported per weight so only these files are bundled.
 */
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { fontFamily } from './index';

export const themeFonts = {
  [fontFamily.regular]: Inter_400Regular,
  [fontFamily.medium]: Inter_500Medium,
  [fontFamily.semibold]: Inter_600SemiBold,
  [fontFamily.mono]: JetBrainsMono_400Regular,
  [fontFamily.monoMedium]: JetBrainsMono_500Medium,
};
