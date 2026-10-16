import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { boldRuns, checklistProgress, parseNote, toggleCheck } from '../lib/checklist';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

function Rich({ text, style }: { text: string; style: object }) {
  return (
    <Text style={style} selectable>
      {boldRuns(text).map((r, i) => (
        <Text key={i} style={r.bold ? { fontWeight: '800' } : undefined}>
          {r.text}
        </Text>
      ))}
    </Text>
  );
}

/** Renders formatted notes with interactive checklists. */
export function NoteView({ note, onChange }: { note: string; onChange?: (next: string) => void }) {
  const { colors } = useTheme();
  const blocks = parseNote(note);
  const progress = checklistProgress(note);
  return (
    <View testID="detail-note" style={{ gap: 6 }}>
      {progress ? (
        <View style={styles.progressRow}>
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <View style={[styles.fill, { width: `${(progress.done / progress.total) * 100}%`, backgroundColor: colors.success }]} />
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700' }}>
            {progress.done}/{progress.total} done
          </Text>
        </View>
      ) : null}
      {blocks.map((b, i) => {
        if (b.kind === 'blank') return <View key={i} style={{ height: 6 }} />;
        if (b.kind === 'heading') {
          return <Rich key={i} text={b.text} style={[b.level === 1 ? font.title : font.heading, { color: colors.text, marginTop: 4 }]} />;
        }
        if (b.kind === 'bullet') {
          return (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
              <Rich text={b.text} style={[font.body, { color: colors.text, flex: 1 }]} />
            </View>
          );
        }
        if (b.kind === 'check') {
          return (
            <Pressable
              key={i}
              testID={`check-${b.line}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: b.checked }}
              accessibilityLabel={b.text}
              disabled={!onChange}
              onPress={() => {
                haptic.light();
                onChange?.(toggleCheck(note, b.line));
              }}
              style={styles.checkRow}
            >
              <View style={[styles.box, { borderColor: b.checked ? colors.success : colors.border, backgroundColor: b.checked ? colors.success : 'transparent' }]}>
                {b.checked ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
              </View>
              <Text style={[font.body, { color: b.checked ? colors.textFaint : colors.text, flex: 1, textDecorationLine: b.checked ? 'line-through' : 'none' }]}>
                {b.text}
              </Text>
            </Pressable>
          );
        }
        return <Rich key={i} text={b.text} style={[font.body, { color: colors.text }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  track: { flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: 4 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
