import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';
import { Button, TextField } from './ui';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  requireText?: string;
}

interface PromptOptions {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  /** Hide the typed text (passwords). */
  secure?: boolean;
  maxLength?: number;
}

interface DialogApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  toast(message: string, tone?: 'info' | 'error'): void;
}

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toastState, setToastState] = useState<{ message: string; tone: 'info' | 'error'; key: number } | null>(null);
  const [toastOpacity] = useState(() => new Animated.Value(0));
  const inputRef = useRef<TextInput>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setText('');
        setError(null);
        setDialog({ kind: 'confirm', options, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setText(options.initialValue ?? '');
        setError(null);
        setDialog({ kind: 'prompt', options, resolve });
      }),
    [],
  );

  const toast = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setToastState({ message, tone, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toastState) return;
    toastOpacity.setValue(0);
    Animated.timing(toastOpacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start(() =>
        setToastState((t) => (t?.key === toastState.key ? null : t)),
      );
    }, 3200);
    return () => clearTimeout(timer);
  }, [toastState, toastOpacity]);

  const close = (result: boolean) => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') {
      dialog.resolve(result);
    } else {
      if (result) {
        const message = dialog.options.validate?.(text) ?? (text.trim() ? null : 'Please enter a value.');
        if (message) {
          setError(message);
          return;
        }
        dialog.resolve(text.trim());
      } else {
        dialog.resolve(null);
      }
    }
    setDialog(null);
  };

  const api = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);
  const confirmOptions = dialog?.kind === 'confirm' ? dialog.options : null;
  const confirmDisabled = !!confirmOptions?.requireText && text.trim() !== confirmOptions.requireText;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog || Platform.OS !== 'web' ? (
      <Modal
        visible={!!dialog}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={() => close(false)}
        statusBarTranslucent
        onShow={() => setTimeout(() => inputRef.current?.focus(), 50)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable
            style={[styles.backdrop, { backgroundColor: colors.overlay }]}
            onPress={() => close(false)}
            accessibilityLabel="Dismiss dialog"
          >
            <Pressable
              style={[styles.dialog, { backgroundColor: colors.surface }]}
              onPress={() => undefined}
              accessibilityViewIsModal
              accessibilityRole="alert"
              testID="dialog"
            >
              {dialog ? (
                <>
                  <Text style={[font.heading, { color: colors.text }]}>{dialog.options.title}</Text>
                  {dialog.options.message ? (
                    <Text style={[font.body, { color: colors.textMuted }]}>{dialog.options.message}</Text>
                  ) : null}
                  {dialog.kind === 'prompt' ? (
                    <TextField
                      ref={inputRef}
                      testID="dialog-input"
                      value={text}
                      onChangeText={(v) => {
                        setText(v);
                        setError(null);
                      }}
                      placeholder={dialog.options.placeholder}
                      error={error}
                      autoFocus
                      maxLength={dialog.options.maxLength ?? 40}
                      secureTextEntry={!!dialog.options.secure}
                      autoCapitalize={dialog.options.secure ? 'none' : undefined}
                      autoCorrect={!dialog.options.secure}
                      returnKeyType="done"
                      onSubmitEditing={() => close(true)}
                    />
                  ) : null}
                  {confirmOptions?.requireText ? (
                    <TextField
                      ref={inputRef}
                      testID="dialog-input"
                      value={text}
                      onChangeText={setText}
                      placeholder={`Type ${confirmOptions.requireText} to confirm`}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                  ) : null}
                  <View style={styles.actions}>
                    <Button
                      testID="dialog-cancel"
                      label={(dialog.kind === 'confirm' && dialog.options.cancelLabel) || 'Cancel'}
                      variant="secondary"
                      onPress={() => close(false)}
                      compact
                    />
                    <Button
                      testID="dialog-confirm"
                      label={dialog.options.confirmLabel ?? (dialog.kind === 'confirm' ? 'OK' : 'Save')}
                      variant={confirmOptions?.destructive ? 'danger' : 'primary'}
                      onPress={() => close(true)}
                      disabled={confirmDisabled}
                      compact
                    />
                  </View>
                </>
              ) : null}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      ) : null}
      {toastState ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.toastWrap, { bottom: insets.bottom + 24, opacity: toastOpacity }]}
          accessibilityLiveRegion="polite"
        >
          <View
            testID="toast"
            style={[styles.toast, { backgroundColor: toastState.tone === 'error' ? colors.danger : colors.text }]}
          >
            <Text style={[font.small, { color: toastState.tone === 'error' ? '#fff' : colors.background }]}>
              {toastState.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider');
  return ctx;
}

/** Shows a user-friendly error toast for a caught error. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, maxWidth: 440, width: '100%', alignSelf: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  toastWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  toast: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, maxWidth: 480 },
});
