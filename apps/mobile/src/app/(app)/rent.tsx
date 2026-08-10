import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RentSection } from '@/components/RentSection';
import { ScreenHeader } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors } from '@/lib/theme';

/**
 * Аренда: active passes and the daily/weekly plans.
 *
 * A route of its own now. It used to be the second panel of an «Общий /
 * Аренда» switcher over the map; with the map reduced to the map, it is
 * reached from the ☰ sheet like everything else.
 */
export default function RentScreen() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t.rentalTitle} onBack={() => router.back()} />
      <RentSection />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
});
