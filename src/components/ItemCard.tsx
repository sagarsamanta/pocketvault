import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemWithRelations } from '../db/types';
import { formatRelative } from '../lib/dates';
import { hostnameOf, isImageMime } from '../lib/text';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';
import { Icon, IconName } from './ui';

const TYPE_ICON: Record<ItemWithRelations['type'], IconName> = {
  note: 'document-text-outline',
  link: 'link-outline',
  image: 'image-outline',
  document: 'document-outline',
};

export function itemDisplayTitle(item: Pick<ItemWithRelations, 'title' | 'url' | 'note' | 'attachments'>): string {
  return (
    item.title ||
    hostnameOf(item.url) ||
    item.note.split('\n').find((l) => l.trim())?.trim() ||
    item.attachments[0]?.originalName ||
    'Untitled'
  );
}

function subtitle(item: ItemWithRelations): string {
  if (item.type === 'link') return hostnameOf(item.url) || item.url || '';
  if (item.note.trim() && item.note.trim() !== item.title) return item.note.trim().replace(/\s+/g, ' ');
  if (item.contentText.trim()) return item.contentText.trim().replace(/\s+/g, ' ');
  return item.attachments[0]?.originalName ?? '';
}

export const ItemCard = memo(function ItemCard({
  item,
  thumbnailUri,
  onPress,
  onToggleFavorite,
}: {
  item: ItemWithRelations;
  thumbnailUri?: string | null;
  onPress: () => void;
  onToggleFavorite: () => void;
}) {
  const { colors } = useTheme();
  const title = itemDisplayTitle(item);
  const sub = subtitle(item);
  const image = item.attachments.find((a) => isImageMime(a.mimeType, a.originalName));
  const showThumb = !!(image && thumbnailUri);

  // The favorite button is a sibling of the card (not a child) so buttons never nest.
  return (
    <View testID={`item-card-${item.id}`} style={styles.wrap}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${item.isFavorite ? ', favorite' : ''}, ${item.type}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? colors.surfaceAlt : colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.primarySoft }]}>
        {showThumb ? (
          <Image
            source={{ uri: thumbnailUri! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
            recyclingKey={image!.id}
          />
        ) : (
          <Icon name={TYPE_ICON[item.type]} color={colors.primary} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
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
        {item.collection || item.tags.length || item.ocrStatus === 'processing' || item.ocrStatus === 'pending' || item.ocrStatus === 'failed' ? (
          <View style={styles.meta}>
            {item.collection ? (
              <View style={styles.metaItem}>
                <View style={[styles.dot, { backgroundColor: item.collection.color }]} />
                <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
                  {item.collection.name}
                </Text>
              </View>
            ) : null}
            {item.tags.slice(0, 3).map((t) => (
              <Text key={t.id} style={[styles.metaText, { color: colors.primary }]} numberOfLines={1}>
                #{t.name}
              </Text>
            ))}
            {item.tags.length > 3 ? (
              <Text style={[styles.metaText, { color: colors.textFaint }]}>+{item.tags.length - 3}</Text>
            ) : null}
            {item.ocrStatus === 'pending' || item.ocrStatus === 'processing' ? (
              <Text style={[styles.metaText, { color: colors.textFaint }]}>Reading text…</Text>
            ) : null}
            {item.ocrStatus === 'failed' ? (
              <Text style={[styles.metaText, { color: colors.warning }]}>Text not read</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
      <Pressable
        testID={`favorite-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        accessibilityState={{ checked: item.isFavorite }}
        onPress={onToggleFavorite}
        hitSlop={4}
        style={styles.star}
      >
        <Icon name={item.isFavorite ? 'star' : 'star-outline'} size={20} color={item.isFavorite ? colors.favorite : colors.textFaint} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    paddingRight: 52,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  body: { flex: 1, gap: 3, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2, alignItems: 'center' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 },
  metaText: { fontSize: 12, fontWeight: '500', maxWidth: 120 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  star: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
