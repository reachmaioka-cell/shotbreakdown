export function displayValue(value: string, confidence?: number) {
  if (confidence !== undefined && confidence < 0.5) return `~ ${value}`;
  return value;
}

export function Row({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string;
  confidence?: number;
  fieldKey?: string;
  submissionId?: string;
}) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-zinc-900 last:border-0">
      <span className="text-sm text-zinc-500 shrink-0">{label}</span>
      <span className="text-sm text-zinc-200 text-right">{displayValue(value, confidence)}</span>
    </div>
  );
}
