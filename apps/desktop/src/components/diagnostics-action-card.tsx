export function DiagnosticsActionCard({
  description,
  disabled,
  label,
  onClick,
}: {
  description: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <article className="diagnostics-action-card">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button disabled={disabled} onClick={onClick} type="button">
        Trigger
      </button>
    </article>
  );
}
