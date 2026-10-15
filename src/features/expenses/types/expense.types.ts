// SDK row projection, including historical payment method text. Write inputs
// are separate: the legacy expenses CHECK must be aligned before enabling them.
export type ExpenseRow = {
  id: string;
  business_id: string;
  category_id: string;
  source_type: 'MANUAL' | 'PURCHASE';
  purchase_id: string | null;
  description: string;
  amount: number;
  payment_method: string;
  expense_date: string;
  receipt_path: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
