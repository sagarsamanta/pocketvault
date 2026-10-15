import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, forwardRef, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing, TOUCH_TARGET } from '../theme/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.text} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  testID,
  accessibilityLabel,
  compact,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const bg = {
    primary: colors.primary,
    secondary: colors.surfaceAlt,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant];
  const fg = {
    primary: colors.primaryText,
    secondary: colors.text,
    ghost: colors.primary,
    danger: '#FFFFFF',
  }[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonLabel, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
  disabled,
  testID,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.surfaceAlt : 'transparent', opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

export const TextField = forwardRef<
  TextInput,
  TextInputProps & { label?: string; error?: string | null; containerStyle?: StyleProp<ViewStyle> }
>(function TextField({ label, error, style, containerStyle, multiline, ...props }, ref) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      {label ? <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={props.accessibilityLabel ?? label ?? props.placeholder}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.danger : colors.border,
            color: colors.text,
          },
          style,
        ]}
        {...props}
      />
      {error ? <Text style={[styles.small, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
});

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color,
  onRemove,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  color?: string;
  onRemove?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const fg = selected ? colors.primaryText : colors.text;
  const chipColors = {
    backgroundColor: selected ? colors.primary : colors.surface,
    borderColor: selected ? colors.primary : colors.border,
  };
  const content = (
    <>
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={[styles.chipLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  if (onRemove) {
    // Removable chips: the label is static and the remove button is its own target,
    // so buttons are never nested (invalid on web).
    return (
      <View testID={testID} style={[styles.chip, chipColors, { paddingRight: 0 }]}>
        {content}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          onPress={onRemove}
          style={styles.chipRemove}
        >
          <Ionicons name="close" size={16} color={fg} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.chip, chipColors, { opacity: pressed ? 0.8 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function Card({ children, style, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>
  );
  if (!rest.onPress) return content;
  return (
    <Pressable accessibilityRole="button" {...rest} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {content}
    </Pressable>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textMuted }]}>
        {children.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty} accessibilityRole="summary">
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={[font.heading, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[font.body, { color: colors.textMuted, textAlign: 'center', maxWidth: 320 }]}>{message}</Text>
      ) : null}
      {action}
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="alert-circle-outline"
      title="Something went wrong"
      message={message}
      action={onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : undefined}
    />
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  destructive,
  testID,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const color = destructive ? colors.danger : colors.text;
  // `right` may contain its own buttons, so it is rendered beside (not inside) the row's press target.
  return (
    <View style={[styles.rowWrap, { backgroundColor: colors.surface }]}>
      <Pressable
        testID={testID}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceAlt : 'transparent' }]}
      >
        {icon ? <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.textMuted} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[font.body, { color, fontWeight: '500' }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right === undefined && onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
      </Pressable>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.surface }]}>{children}</View>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  testIDPrefix?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: colors.surface }]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={selected ? colors.primary : colors.textMuted} /> : null}
            <Text style={[font.small, { color: selected ? colors.text : colors.textMuted, fontWeight: '600' }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceAlt, colors.textMuted],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    success: [colors.primarySoft, colors.success],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[font.tiny, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: spacing.md },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  iconButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
  small: { fontSize: 13 },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipLabel: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  chipRemove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    minHeight: 24,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl, flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  rowRight: { paddingRight: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  row: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
