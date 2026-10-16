import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { ItemCard } from '../components/ItemCard';
import { LockScreen } from '../components/LockScreen';
import { SwipeRow } from '../components/SwipeRow';
import { EmptyState, IconButton } from '../components/ui';
import { authSupported } from '../security/auth';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

/** Encrypted, hidden items. Always asks for fingerprint / screen lock before showing them. */
export default function VaultScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [unlocked, setUnlocked] = useState(false);
  const [query, setQuery] = useState('');
  const items = useLiveQuery(() => (unlocked ? services.vault.listSecretItems(query) : Promise.resolve([])), [unlocked, query]);

  // Decrypted temporary files are wiped when leaving the vault.
  useEffect(() => () => void services.vault.clearCache().catch(() => undefined), [services]);

  if (!authSupported || !services.vault.supported) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: 'Secret vault' }} />
        <EmptyState icon="lock-closed-outline" title="Secret vault" message="The encrypted vault is available in the Android app." />
      </View>
    );
  }

  if (!unlocked) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <LockScreen testID="vault-lock" title="Secret vault" subtitle="Encrypted items, hidden from your library and search." reason="Unlock your secret vault" onUnlocked={() => setUnlocked(true)} />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        testID="vault-list"
        data={items.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm + 2 }} />}
        ListHeaderComponent={
          <LinearGradient colors={['#1E1B4B', '#4C1D95', '#831843']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
            <View style={styles.heroTop}>
              <IconButton icon="arrow-back" label="Back" color="#FFFFFF" onPress={() => router.back()} />
              <View style={{ flex: 1 }} />
              <IconButton testID="vault-lock-now" icon="lock-closed" label="Lock vault" color="#FFFFFF" onPress={() => setUnlocked(false)} />
            </View>
            <View style={styles.titleRow}>
              <Ionicons name="shield-checkmark" size={30} color="#C4B5FD" />
              <View style={{ flex: 1 }}>
                <Text style={[font.title, { color: '#FFFFFF' }]}>Secret vault</Text>
                <Text style={[font.small, { color: 'rgba(255,255,255,0.75)' }]}>AES-256 encrypted · {items.data?.length ?? 0} item{items.data?.length === 1 ? '' : 's'}</Text>
              </View>
            </View>
            <View style={[styles.search, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
              <Ionicons name="search" size={18} color="rgba(255,255,255,0.8)" />
              <TextInput testID="vault-search" value={query} onChangeText={setQuery} placeholder="Search secrets" placeholderTextColor="rgba(255,255,255,0.6)" style={styles.searchInput} />
            </View>
          </LinearGradient>
        }
        ListEmptyComponent={
          <Animated.View entering={FadeInDown} style={{ paddingTop: spacing.xl }}>
            <EmptyState
              icon="lock-closed-outline"
              title={query ? 'No matches' : 'Your vault is empty'}
              message={query ? 'Try other words.' : 'Open any item and tap “Vault”, or swipe an item left in your library. It will be encrypted and hidden everywhere else.'}
            />
          </Animated.View>
        }
        renderItem={({ item, index }) => (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <SwipeRow
              rightActions={[
                {
                  key: 'unvault',
                  label: 'Unlock',
                  icon: 'lock-open',
                  color: colors.primary,
                  onPress: async () => {
                    try {
                      await services.vault.revealSecret(item.id);
                      dialog.toast('Moved back to your library');
                    } catch (e) {
                      dialog.toast(errorMessage(e), 'error');
                    }
                  },
                },
              ]}
            >
              <ItemCard item={item} index={index} onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} onToggleFavorite={() => services.updateItem(item.id, { isFavorite: !item.isFavorite })} />
            </SwipeRow>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, marginBottom: spacing.lg, gap: spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginLeft: -spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 16 },
});
