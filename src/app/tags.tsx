import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { EmptyState, ErrorView, Group, IconButton, ListRow, LoadingView } from '../components/ui';
import type { Tag } from '../db/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/theme';

export default function TagsScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tags = useLiveQuery(() => services.repo.listTags(), []);

  const rename = async (t: Tag) => {
    const name = await dialog.prompt({ title: 'Rename tag', initialValue: t.name, confirmLabel: 'Rename' });
    if (!name || name === t.name) return;
    try {
      await services.repo.renameTag(t.id, name.replace(/^#/, ''));
      services.notifyChanged();
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const remove = async (t: Tag) => {
    const ok = await dialog.confirm({
      title: `Delete #${t.name}?`,
      message: t.itemCount ? `It will be removed from ${t.itemCount} item${t.itemCount === 1 ? '' : 's'}. The items are kept.` : undefined,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await services.repo.deleteTag(t.id);
      services.notifyChanged();
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  if (tags.loading && !tags.data) return <LoadingView />;
  if (tags.error) return <ErrorView message={errorMessage(tags.error)} onRetry={tags.reload} />;

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={tags.data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
      ListEmptyComponent={
        <EmptyState icon="pricetags-outline" title="No tags yet" message="Add tags when you save or edit an item." />
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item: t }) => (
        <Group>
          <ListRow
            testID={`tag-row-${t.name}`}
            icon="pricetag-outline"
            title={`#${t.name}`}
            subtitle={`${t.itemCount ?? 0} item${t.itemCount === 1 ? '' : 's'}`}
            onPress={() => router.navigate({ pathname: '/', params: { tag: t.id, collection: '' } })}
            right={
              <View style={{ flexDirection: 'row' }}>
                <IconButton icon="pencil-outline" label={`Rename ${t.name}`} onPress={() => rename(t)} />
                <IconButton icon="trash-outline" label={`Delete ${t.name}`} color={colors.danger} onPress={() => remove(t)} />
              </View>
            }
          />
        </Group>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
});
