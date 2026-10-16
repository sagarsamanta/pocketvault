import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { itemDisplayTitle } from '../components/ItemCard';
import { EmptyState, IconButton, LoadingView } from '../components/ui';
import { readingMinutes } from '../lib/links';
import { hostnameOf } from '../lib/text';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/theme';

/** Distraction-free, offline reading view for saved articles. */
export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(18);
  const item = useLiveQuery(async () => {
    const raw = await services.repo.getItemWithRelations(id);
    return raw?.isSecret ? services.vault.getSecretItem(id) : raw;
  }, [id]);

  if (item.loading && !item.data) return <LoadingView />;
  const data = item.data;
  if (!data?.readerText) return <EmptyState icon="book-outline" title="Nothing to read offline" message="This link has no saved article text yet." />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: 'Reader',
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton testID="reader-smaller" icon="remove-circle-outline" label="Smaller text" onPress={() => setSize((s) => Math.max(14, s - 2))} />
              <IconButton testID="reader-larger" icon="add-circle-outline" label="Larger text" onPress={() => setSize((s) => Math.min(28, s + 2))} />
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <Animated.View entering={FadeIn}>
          <Text style={[styles.site, { color: colors.primary }]}>{(data.previewSite || hostnameOf(data.url)).toUpperCase()}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{itemDisplayTitle(data)}</Text>
          <Text style={[styles.meta, { color: colors.textFaint }]}>{readingMinutes(data.readerText)} min read · saved for offline</Text>
          <View testID="reader-text" style={{ gap: size * 0.8, marginTop: spacing.xl }}>
            {data.readerText.split('\n\n').map((block, i) =>
              block.startsWith('## ') ? (
                <Text key={i} style={{ color: colors.text, fontSize: size + 4, fontWeight: '800', lineHeight: (size + 4) * 1.3 }}>
                  {block.slice(3)}
                </Text>
              ) : (
                <Text key={i} selectable style={{ color: colors.text, fontSize: size, lineHeight: size * 1.65 }}>
                  {block}
                </Text>
              ),
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, width: '100%', maxWidth: 720, alignSelf: 'center' },
  site: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36, marginTop: spacing.sm, letterSpacing: -0.5 },
  meta: { fontSize: 13, marginTop: spacing.sm },
});
