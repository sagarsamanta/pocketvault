import { FlexWidget, TextWidget } from 'react-native-android-widget';

export interface WidgetData {
  count: number;
  recent: { id: string; title: string; emoji: string }[];
}

const ACTIONS = [
  { emoji: '📝', label: 'Note', uri: 'pocketvault://edit?type=note' },
  { emoji: '🔗', label: 'Link', uri: 'pocketvault://edit?type=link' },
  { emoji: '🎙️', label: 'Voice', uri: 'pocketvault://record' },
  { emoji: '📄', label: 'Scan', uri: 'pocketvault://scan' },
];

/** Home-screen widget: quick capture buttons plus the latest saved items. */
export function QuickCaptureWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        borderRadius: 24,
        padding: 14,
        backgroundGradient: { from: '#4F46E5', to: '#C026D3', orientation: 'TL_BR' },
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      clickAction="OPEN_APP"
    >
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent', alignItems: 'center' }}>
        <TextWidget text="PocketVault" style={{ fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' }} />
        <TextWidget text={`${data.count} saved`} style={{ fontSize: 12, color: '#E9D5FF' }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', marginTop: 8 }}>
        {ACTIONS.map((a) => (
          <FlexWidget
            key={a.label}
            clickAction="OPEN_URI"
            clickActionData={{ uri: a.uri }}
            accessibilityLabel={`New ${a.label}`}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.18)',
              borderRadius: 16,
              paddingVertical: 8,
              paddingHorizontal: 10,
              alignItems: 'center',
              flexDirection: 'column',
            }}
          >
            <TextWidget text={a.emoji} style={{ fontSize: 18 }} />
            <TextWidget text={a.label} style={{ fontSize: 11, color: '#FFFFFF', fontWeight: '600' }} />
          </FlexWidget>
        ))}
      </FlexWidget>
      {!compact && data.recent.length ? (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', marginTop: 8 }}>
          {data.recent.slice(0, 2).map((r) => (
            <FlexWidget
              key={r.id}
              clickAction="OPEN_URI"
              clickActionData={{ uri: `pocketvault://item/${r.id}` }}
              style={{ flexDirection: 'row', width: 'match_parent', paddingVertical: 3 }}
            >
              <TextWidget text={`${r.emoji}  ${r.title}`} maxLines={1} truncate="END" style={{ fontSize: 13, color: '#FFFFFF' }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}
