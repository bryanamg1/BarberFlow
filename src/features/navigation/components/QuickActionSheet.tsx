import { BottomSheet, Button } from '@/components/ui';

import { isQuickActionAllowed, quickActions, type QuickActionId } from '../quickActions';

export type QuickActionSheetProps = {
  visible: boolean;
  role: 'OWNER' | 'BARBER';
  onClose: () => void;
  onSelect: (action: QuickActionId) => void;
};

export function QuickActionSheet({ visible, role, onClose, onSelect }: QuickActionSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Acciones rápidas">
      {quickActions
        .filter((action) => isQuickActionAllowed(action.id, role))
        .map((action) => (
          <Button
            key={action.id}
            label={action.label}
            variant="ghost"
            onPress={() => onSelect(action.id)}
          />
        ))}
    </BottomSheet>
  );
}
