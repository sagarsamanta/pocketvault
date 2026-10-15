import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button, EmptyState } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';

export default function NotFound() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyState
        icon="help-circle-outline"
        title="This page doesn't exist"
        action={<Button label="Go to library" onPress={() => router.replace('/')} />}
      />
    </View>
  );
}
