import { Input } from '@/components/ui';

export type AppointmentNotesFieldProps = {
  value: string | null;
  onChange: (value: string) => void;
};

// null is visually empty only. Text edits emit the exact string, including ''.
// Rendering or receiving a new value never emits a change or persists anything.
export function AppointmentNotesField({ value, onChange }: AppointmentNotesFieldProps) {
  return <Input label="Notas" multiline value={value ?? ''} onChangeText={onChange} />;
}
