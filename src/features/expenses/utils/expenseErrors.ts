import type { ExpenseError, ExpenseErrorCode } from '../types/expense.types';

const messages: Record<ExpenseErrorCode, string> = {
  EXPENSE_ACCESS_DENIED: 'No se pudo acceder al gasto.',
  EXPENSE_NOT_FOUND: 'No se encontró el gasto o no está disponible.',
  INVALID_INPUT: 'Revisa los datos del gasto.',
  NETWORK_ERROR: 'No se pudo conectar con los gastos. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del gasto. Inténtalo nuevamente.',
};

export function expenseError(code: ExpenseErrorCode): ExpenseError {
  return { code, message: messages[code] };
}

// Service errors are already safe. Unexpected mutation-runtime failures never
// acquire a public message merely because they carry a familiar code.
export function safeExpenseError(reason: unknown): ExpenseError {
  if (
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    typeof reason.code === 'string' &&
    Object.prototype.hasOwnProperty.call(messages, reason.code)
  ) {
    const code = reason.code as ExpenseErrorCode;
    if ('message' in reason && reason.message === messages[code]) return expenseError(code);
  }
  return expenseError('UNKNOWN_ERROR');
}
