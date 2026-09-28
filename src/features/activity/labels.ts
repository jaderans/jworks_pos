/** Short names for audit actions, shared by the Activity page and the top-bar activity menu. */
export const ACTIVITY_LABELS: Record<string, string> = {
  price: 'Price',
  void: 'Void',
  payment: 'Payment',
  cost: 'Cost',
  batch: 'Batch',
  stock: 'Stock',
  open: 'Register',
  close: 'Register',
  reopen: 'Register',
  cash: 'Cash',
  create: 'Added',
  update: 'Changed',
  delete: 'Deleted',
  status: 'Status',
  role: 'Role',
  roster: 'Roster',
  payouts: 'Payouts',
  payout: 'Payout',
  security: 'Security',
  merge: 'Merge',
  setup: 'Setup',
  sync: 'Sync',
};

export const activityTone = (action: string): 'bad' | 'yellow' | 'teal' | undefined =>
  action === 'void' ? 'bad' : action === 'price' ? 'yellow' : action === 'cost' || action === 'batch' ? 'teal' : undefined;
