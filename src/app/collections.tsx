import { Stack, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { Button, EmptyState, ErrorView, Group, IconButton, ListRow, LoadingView } from '../components/ui';
import type { Collection } from '../db/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/theme';

export default function CollectionsScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const collections = useLiveQuery(() => services.repo.listCollections(), []);

  const create = async () => {
    const name = await dialog.prompt({ title: 'New collection', placeholder: 'e.g. Recipes', confirmLabel: 'Create' });
    if (!name) return;
    try {
      await services.repo.createCollection(name);
      services.notifyChanged();
      dialog.toast(`Created “${name}”`);
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const rename = async (c: Collection) => {
    const name = await dialog.prompt({ title: 'Rename collection', initialValue: c.name, confirmLabel: 'Rename' });
    if (!name || name === c.name) return;
    try {
      await services.repo.renameCollection(c.id, name);
      services.notifyChanged();
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const remove = async (c: Collection) => {
    const ok = await dialog.confirm({
      title: `Delete “${c.name}”?`,
      message: c.itemCount
        ? `The ${c.itemCount} item${c.itemCount === 1 ? '' : 's'} in it will be kept and moved out of the collection.`
        : 'This collection is empty.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await services.repo.deleteCollection(c.id);
      services.notifyChanged();
      dialog.toast('Collection deleted');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{ headerRight: () => <IconButton testID="collection-add" icon="add" label="New collection" onPress={create} /> }}
      />
      {collections.loading && !collections.data ? (
        <LoadingView />
      ) : collections.error ? (
        <ErrorView message={errorMessage(collections.error)} onRetry={collections.reload} />
      ) : (
        <FlatList
          data={collections.data}
          keyExtractor={(c) => c.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title="No collections yet"
              message="Group related items — like Recipes, Work or Travel."
              action={<Button testID="collection-create-empty" label="Create collection" icon="add" onPress={create} />}
            />
          }
          renderItem={({ item: c }) => (
            <Group>
              <ListRow
                testID={`collection-row-${c.name}`}
                icon="folder-outline"
                title={c.name}
                subtitle={`${c.itemCount ?? 0} item${c.itemCount === 1 ? '' : 's'}`}
                onPress={() => router.navigate({ pathname: '/', params: { collection: c.id, tag: '' } })}
                right={
                  <View style={{ flexDirection: 'row' }}>
                    <IconButton testID={`collection-rename-${c.name}`} icon="pencil-outline" label={`Rename ${c.name}`} onPress={() => rename(c)} />
                    <IconButton testID={`collection-delete-${c.name}`} icon="trash-outline" label={`Delete ${c.name}`} color={colors.danger} onPress={() => remove(c)} />
                  </View>
                }
              />
            </Group>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: spacing.lg, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
});
