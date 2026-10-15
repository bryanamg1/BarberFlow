import { useLocalSearchParams } from 'expo-router';
import { ExpenseCategoryEditScreen } from '@/features/expenses/screens/ExpenseCategoryEditScreen';
export default function ExpenseCategoryEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <ExpenseCategoryEditScreen
      expenseCategoryId={typeof id === 'string' && id.trim() ? id : null}
    />
  );
}
