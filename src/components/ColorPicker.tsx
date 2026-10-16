import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ITEM_COLORS, type ItemColor } from '../db/types';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { ITEM_COLOR_HEX, spacing } from '../theme/theme';

export function ColorPicker({ value, onChange, label = 'Colour label' }: { value: ItemColor | null; onChange: (c: ItemColor | null) => void; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable
          testID="color-none"
          accessibilityRole="radio"
          accessibilityState={{ checked: value === null }}
          accessibilityLabel="No colour"
          onPress={() => {
            haptic.tap();
            onChange(null);
          }}
          style={[styles.swatch, { borderColor: value === null ? colors.text : colors.border, backgroundColor: colors.surface }]}
        >
          <Ionicons name="close" size={16} color={colors.textFaint} />
        </Pressable>
        {ITEM_COLORS.map((c) => (
          <Pressable
            key={c}
            testID={`color-${c}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === c }}
            accessibilityLabel={`${c} label`}
            onPress={() => {
              haptic.tap();
              onChange(c);
            }}
            style={[styles.swatch, { backgroundColor: ITEM_COLOR_HEX[c], borderColor: value === c ? colors.text : 'transparent' }]}
          >
            {value === c ? <Ionicons name="checkmark" size={18} color="#FFFFFF" /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600' },
  row: { gap: spacing.sm, paddingRight: spacing.lg, paddingVertical: 2 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
