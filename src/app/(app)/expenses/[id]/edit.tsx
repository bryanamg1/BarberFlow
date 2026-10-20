import { useLocalSearchParams } from 'expo-router';

import { ExpenseEditScreen } from '@/features/expenses/screens/ManualExpenseScreen';

export default function ExpenseEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <ExpenseEditScreen expenseId={typeof id === 'string' && id.trim().length > 0 ? id : null} />
  );
}
