import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Tag } from '../db/types';
import { parseTagInput } from '../lib/text';
import { useTheme } from '../theme/ThemeProvider';
import { font, spacing } from '../theme/theme';
import { Chip, IconButton, TextField } from './ui';

/** Edits a list of tag names, suggesting existing tags as the user types. */
export function TagEditor({
  value,
  onChange,
  allTags,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  allTags: Tag[];
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');

  const add = (input: string) => {
    const names = parseTagInput(input);
    if (names.length === 0) return;
    const existing = new Set(value.map((v) => v.toLowerCase()));
    const merged = [...value];
    for (const n of names) {
      // Reuse the existing tag's spelling when it matches case-insensitively.
      const known = allTags.find((t) => t.name.toLowerCase() === n.toLowerCase());
      const name = known?.name ?? n;
      if (!existing.has(name.toLowerCase())) {
        merged.push(name);
        existing.add(name.toLowerCase());
      }
    }
    onChange(merged);
    setDraft('');
  };

  const query = draft.trim().toLowerCase();
  const suggestions = allTags
    .filter((t) => !value.some((v) => v.toLowerCase() === t.name.toLowerCase()))
    .filter((t) => !query || t.name.toLowerCase().includes(query))
    .slice(0, 12);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>Tags</Text>
      {value.length ? (
        <View style={styles.wrap}>
          {value.map((name) => (
            <Chip
              key={name}
              testID={`tag-chip-${name}`}
              label={`#${name}`}
              onRemove={() => onChange(value.filter((v) => v !== name))}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextField
          testID="tag-input"
          containerStyle={{ flex: 1 }}
          value={draft}
          onChangeText={(t) => (t.endsWith(',') ? add(t) : setDraft(t))}
          placeholder="Add a tag"
          accessibilityLabel="Add a tag"
          autoCapitalize="none"
          returnKeyType="done"
          submitBehavior="submit"
          // react-native-web ignores submitBehavior; keep focus here so several tags can be typed in a row.
          blurOnSubmit={false}
          onSubmitEditing={(e) => add(e.nativeEvent.text ?? draft)}
          maxLength={40}
        />
        <IconButton icon="add-circle" label="Add tag" color={colors.primary} onPress={() => add(draft)} disabled={!draft.trim()} />
      </View>
      {suggestions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.wrapRow}>
          {suggestions.map((t) => (
            <Chip key={t.id} label={`#${t.name}`} icon="add" onPress={() => add(t.name)} />
          ))}
        </ScrollView>
      ) : (
        <Text style={[font.small, { color: colors.textFaint }]}>Separate tags with commas.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wrapRow: { gap: spacing.sm, paddingRight: spacing.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
