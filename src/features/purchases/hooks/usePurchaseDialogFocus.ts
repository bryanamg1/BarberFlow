import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, type TextInput, type View } from 'react-native';

// RN Web's modal cannot always infer its opener when the input autofocuses.
// Keep focus ownership with this purchase detail; never retain a DOM node after unmount.
export function usePurchaseDialogFocus(open: boolean) {
  const triggerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closing = wasOpen.current && !open;
    wasOpen.current = open;
    if (!open && !closing) return;
    const timer = setTimeout(() => {
      if (open) inputRef.current?.focus();
      else if (triggerRef.current) {
        triggerRef.current.focus();
        if (Platform.OS !== 'web')
          AccessibilityInfo.sendAccessibilityEvent(triggerRef.current, 'focus');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);
  return { triggerRef, inputRef };
}
