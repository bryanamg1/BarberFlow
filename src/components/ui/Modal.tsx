import { useEffect, useId, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal as NativeModal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@/theme';

import { Button } from './Button';

export type ModalProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  dismissible?: boolean;
  accessibilityLabel?: string;
  closeLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

let webScrollLocks = 0;
let previousOverflow = '';

export function Modal(props: ModalProps) {
  return <Overlay {...props} placement="center" />;
}

// Shared implementation for the two public overlays; intentionally omitted from the UI barrel.
export function Overlay({
  visible,
  onClose,
  title,
  description,
  children,
  actions,
  dismissible = true,
  accessibilityLabel,
  closeLabel = 'Cerrar',
  style,
  testID,
  placement,
}: ModalProps & { placement: 'center' | 'bottom' }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const sheet = placement === 'bottom';

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const body = document.body;
    if (webScrollLocks === 0) {
      previousOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }
    webScrollLocks++;
    return () => {
      webScrollLocks--;
      if (webScrollLocks === 0) body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return null;

  const requestClose = () => {
    if (dismissible) onClose();
  };
  const webProps = Platform.select({
    web: {
      'aria-labelledby': title && !accessibilityLabel ? titleId : undefined,
      'aria-describedby': description ? descriptionId : undefined,
    },
    default: {},
  });

  return (
    <NativeModal
      {...webProps}
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      allowSwipeDismissal={false}
      supportedOrientations={['portrait', 'landscape']}
      statusBarTranslucent
      navigationBarTranslucent
      aria-label={accessibilityLabel ?? title ?? (sheet ? 'Panel' : 'Diálogo')}
      onRequestClose={requestClose}
      testID={testID}
    >
      <SafeAreaProvider>
        <View
          style={styles.backdrop}
          accessible={false}
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          onStartShouldSetResponder={() => dismissible}
          onResponderRelease={requestClose}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          enabled={Platform.OS !== 'web'}
          style={styles.fill}
        >
          <SafeAreaView
            edges={sheet ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}
            style={[styles.layout, sheet ? styles.bottomLayout : styles.centerLayout]}
          >
            <View
              accessibilityViewIsModal
              onAccessibilityEscape={requestClose}
              style={[styles.panel, style, styles.bounds]}
              testID={testID ? `${testID}-panel` : undefined}
            >
              <ScrollView
                style={styles.scroll}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.content}
              >
                <View style={styles.header}>
                  {title && (
                    <Text id={titleId} role="heading" style={styles.title}>
                      {title}
                    </Text>
                  )}
                  {dismissible && (
                    <Button
                      label={closeLabel}
                      variant="ghost"
                      onPress={requestClose}
                      style={styles.close}
                    />
                  )}
                </View>
                {description && (
                  <Text id={descriptionId} style={styles.description}>
                    {description}
                  </Text>
                )}
                {children}
                {actions && <View style={styles.actions}>{actions}</View>}
                {sheet && <SafeAreaView edges={['bottom']} />}
              </ScrollView>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, pointerEvents: 'box-none' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: theme.colors.overlay },
  layout: { flex: 1, alignItems: 'center', pointerEvents: 'box-none' },
  centerLayout: { justifyContent: 'center', padding: theme.spacing[16] },
  bottomLayout: { justifyContent: 'flex-end', paddingTop: theme.spacing[16] },
  panel: {
    backgroundColor: theme.colors.surfaceRaised,
    borderColor: theme.colors.border,
    borderWidth: theme.borderWidths.thin,
    borderRadius: theme.radius.card,
    width: Platform.OS === 'web' ? 'auto' : '100%',
    flexShrink: 1,
    ...theme.shadows.floating,
  },
  bounds: { maxWidth: '100%', maxHeight: '100%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[16] },
  title: { ...theme.typography.heading, color: theme.colors.textPrimary, flex: 1 },
  close: { marginLeft: 'auto' },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
  actions: { gap: theme.spacing[8] },
});
