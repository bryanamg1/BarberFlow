import { Overlay, type ModalProps } from './Modal';

export type BottomSheetProps = ModalProps;

export function BottomSheet(props: BottomSheetProps) {
  return <Overlay {...props} placement="bottom" />;
}
