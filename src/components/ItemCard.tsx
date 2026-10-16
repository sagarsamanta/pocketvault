import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ItemType, ItemWithRelations } from '../db/types';
import { checklistProgress, plainText } from '../lib/checklist';
import { formatRelative } from '../lib/dates';
import { hostnameOf } from '../lib/text';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, font, ITEM_COLOR_HEX, radius, spacing, TYPE_GRADIENT } from '../theme/theme';
import { GradientIcon, PressableScale } from './motion';
import type { IconName } from './ui';

export const TYPE_ICON: Record<ItemType, IconName> = {
  note: 'document-text',
  link: 'link',
  image: 'image',
  document: 'document',
  audio: 'mic',
};

export const TYPE_LABEL: Record<ItemType, string> = {
  note: 'Note',
  link: 'Link',
  image: 'Photo',
  document: 'Document',
  audio: 'Voice note',
};

export function itemDisplayTitle(item: Pick<ItemWithRelations, 'title' | 'url' | 'note' | 'attachments'> & { previewTitle?: string | null }): string {
  return (
    item.title ||
    item.previewTitle ||
    hostnameOf(item.url) ||
    plainText(item.note).split('\n').find((l) => l.trim())?.trim() ||
    item.attachments.find((a) => a.role !== 'preview')?.originalName ||
    'Untitled'
  );
}

function subtitle(item: ItemWithRelations): string {
  if (item.type === 'link') return item.previewDescription || item.previewSite || hostnameOf(item.url) || item.url || '';
  if (item.type === 'audio') return item.contentText.trim() ? `“${item.contentText.trim()}”` : 'Voice note';
  const note = plainText(item.note).trim();
  if (note && note !== item.title) return note.replace(/\s+/g, ' ');
  if (item.contentText.trim()) return item.contentText.trim().replace(/\s+/g, ' ');
  return item.attachments.find((a) => a.role !== 'preview')?.originalName ?? '';
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface CardProps {
  item: ItemWithRelations;
  thumbnailUri?: string | null;
  index?: number;
  onPress: () => void;
  onLongPress?: () => void;
  onToggleFavorite: () => void;
}

function Meta({ item }: { item: ItemWithRelations }) {
  const { colors } = useTheme();
  const total = item.facts.find((f) => f.kind === 'total');
  const progress = checklistProgress(item.note);
  const audio = item.attachments.find((a) => a.role === 'audio');
  const pending = item.ocrStatus === 'pending' || item.ocrStatus === 'processing' || item.previewStatus === 'pending';
  const hasAny = item.collection || item.tags.length || total || progress || audio || pending || item.ocrStatus === 'failed';
  if (!hasAny) return null;
  return (
    <View style={styles.meta}>
      {total ? (
        <View style={[styles.pill, { backgroundColor: colors.successSoft }]}>
          <Ionicons name="receipt-outline" size={11} color={colors.success} />
          <Text style={[styles.pillText, { color: colors.success }]}>{total.value}</Text>
        </View>
      ) : null}
      {audio ? (
        <View style={[styles.pill, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="play" size={10} color={colors.danger} />
          <Text style={[styles.pillText, { color: colors.danger }]}>{formatDuration(audio.durationMs)}</Text>
        </View>
      ) : null}
      {progress ? (
        <View style={[styles.pill, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="checkbox-outline" size={11} color={colors.primary} />
          <Text style={[styles.pillText, { color: colors.primary }]}>
            {progress.done}/{progress.total}
          </Text>
        </View>
      ) : null}
      {item.collection ? (
        <View style={styles.metaItem}>
          <View style={[styles.dot, { backgroundColor: item.collection.color }]} />
          <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
            {item.collection.name}
          </Text>
        </View>
      ) : null}
      {item.tags.slice(0, 2).map((t) => (
        <Text key={t.id} style={[styles.metaText, { color: colors.primary }]} numberOfLines={1}>
          #{t.name}
        </Text>
      ))}
      {item.tags.length > 2 ? <Text style={[styles.metaText, { color: colors.textFaint }]}>+{item.tags.length - 2}</Text> : null}
      {pending ? <Text style={[styles.metaText, { color: colors.textFaint }]}>✨ Enriching…</Text> : null}
      {item.ocrStatus === 'failed' ? <Text style={[styles.metaText, { color: colors.warning }]}>Text not read</Text> : null}
    </View>
  );
}

function Thumb({ item, uri, size }: { item: ItemWithRelations; uri?: string | null; size: number }) {
  if (uri) {
    return (
      <View style={{ width: size, height: size, borderRadius: size * 0.3, overflow: 'hidden' }}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} transition={180} />
      </View>
    );
  }
  return <GradientIcon icon={TYPE_ICON[item.type]} colors={TYPE_GRADIENT[item.type]} size={size} />;
}

function FavoriteButton({ item, onToggle, overlay }: { item: ItemWithRelations; onToggle: () => void; overlay?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={`favorite-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      accessibilityState={{ checked: item.isFavorite }}
      onPress={() => {
        haptic.light();
        onToggle();
      }}
      hitSlop={4}
      style={[styles.star, overlay && styles.starOverlay]}
    >
      <Ionicons
        name={item.isFavorite ? 'star' : 'star-outline'}
        size={20}
        color={item.isFavorite ? colors.favorite : overlay ? '#FFFFFF' : colors.textFaint}
      />
    </Pressable>
  );
}

/** Rich list row. The favorite button is a sibling of the press target so buttons never nest. */
export const ItemCard = memo(function ItemCard({ item, thumbnailUri, index = 0, onPress, onLongPress, onToggleFavorite }: CardProps) {
  const { colors } = useTheme();
  const title = itemDisplayTitle(item);
  const sub = subtitle(item);
  const color = item.color ? ITEM_COLOR_HEX[item.color] : null;
  return (
    <Animated.View
      testID={`item-card-${item.id}`}
      entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}
      style={styles.wrap}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${title}${item.isPinned ? ', pinned' : ''}${item.isFavorite ? ', favorite' : ''}, ${TYPE_LABEL[item.type]}`}
        onPress={onPress}
        onLongPress={onLongPress}
        scaleTo={0.97}
        style={[styles.card, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}
      >
        {color ? <View style={[styles.colorStrip, { backgroundColor: color }]} /> : null}
        <Thumb item={item} uri={thumbnailUri} size={52} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {item.isPinned ? <Ionicons name="pin" size={13} color={colors.accent} style={{ marginRight: 2 }} /> : null}
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[font.small, { color: colors.textFaint }]}>{formatRelative(item.updatedAt)}</Text>
          </View>
          {sub ? (
            <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
          <Meta item={item} />
        </View>
      </PressableScale>
      <FavoriteButton item={item} onToggle={onToggleFavorite} />
    </Animated.View>
  );
});

/** Image-forward tile for the masonry grid. */
export const ItemTile = memo(function ItemTile({ item, thumbnailUri, index = 0, onPress, onLongPress, onToggleFavorite }: CardProps) {
  const { colors } = useTheme();
  const title = itemDisplayTitle(item);
  const sub = subtitle(item);
  const color = item.color ? ITEM_COLOR_HEX[item.color] : null;
  const hasImage = !!thumbnailUri;
  const imageHeight = item.type === 'image' || item.type === 'document' ? 170 : 110;
  return (
    <Animated.View testID={`item-card-${item.id}`} entering={FadeInDown.delay(Math.min(index, 10) * 40).springify().damping(18)} style={styles.tileWrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${TYPE_LABEL[item.type]}`}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[styles.tile, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}
      >
        {hasImage ? (
          <View style={{ height: imageHeight }}>
            <Image source={{ uri: thumbnailUri! }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={thumbnailUri!} transition={180} />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.35)']} style={StyleSheet.absoluteFill} />
          </View>
        ) : (
          <LinearGradient colors={TYPE_GRADIENT[item.type]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tilePlaceholder}>
            <Ionicons name={TYPE_ICON[item.type]} size={26} color="rgba(255,255,255,0.95)" />
          </LinearGradient>
        )}
        <View style={styles.tileBody}>
          <View style={styles.titleRow}>
            {item.isPinned ? <Ionicons name="pin" size={12} color={colors.accent} /> : null}
            {color ? <View style={[styles.dot, { backgroundColor: color, width: 9, height: 9, borderRadius: 5 }]} /> : null}
            <Text style={[styles.tileTitle, { color: colors.text }]} numberOfLines={2}>
              {title}
            </Text>
          </View>
          {sub && !hasImage ? (
            <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={4}>
              {sub}
            </Text>
          ) : null}
          <Meta item={item} />
        </View>
      </PressableScale>
      <FavoriteButton item={item} onToggle={onToggleFavorite} overlay={hasImage} />
    </Animated.View>
  );
});

/** Rough height used to balance the two masonry columns. */
export function estimateTileHeight(item: ItemWithRelations, hasThumb: boolean): number {
  const imageHeight = hasThumb ? (item.type === 'image' || item.type === 'document' ? 170 : 110) : 64;
  const textLines = hasThumb ? 2 : Math.min(4, Math.ceil(subtitle(item).length / 26));
  return imageHeight + 50 + textLines * 18 + (item.tags.length || item.facts.length ? 22 : 0);
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    paddingRight: 50,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  colorStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  body: { flex: 1, gap: 3, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 },
  metaText: { fontSize: 12, fontWeight: '600', maxWidth: 120 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 11, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  star: { position: 'absolute', top: 2, right: 2, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  starOverlay: { top: 0, right: 0 },
  tileWrap: { position: 'relative', marginBottom: spacing.md },
  tile: { borderRadius: radius.lg, overflow: 'hidden' },
  tilePlaceholder: { height: 64, alignItems: 'flex-start', justifyContent: 'flex-end', padding: spacing.md },
  tileBody: { padding: spacing.md, gap: 4 },
  tileTitle: { flex: 1, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
});
