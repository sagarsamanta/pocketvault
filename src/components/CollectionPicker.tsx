import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Collection } from '../db/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/theme';
import { Chip } from './ui';

export function CollectionPicker({
  collections,
  value,
  onChange,
  onCreate,
}: {
  collections: Collection[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Collection</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.row}
      >
        <Chip testID="collection-none" label="None" selected={value === null} onPress={() => onChange(null)} />
        {collections.map((c) => (
          <Chip
            key={c.id}
            testID={`collection-option-${c.name}`}
            label={c.name}
            color={c.color}
            selected={value === c.id}
            onPress={() => onChange(c.id)}
          />
        ))}
        {onCreate ? <Chip testID="collection-new" label="New" icon="add" onPress={onCreate} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' },
  row: { gap: spacing.sm, paddingRight: spacing.lg },
});
