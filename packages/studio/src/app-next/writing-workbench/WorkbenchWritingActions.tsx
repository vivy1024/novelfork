export interface WorkbenchWritingAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export function WorkbenchWritingActions({ actions, onRun }: { actions: readonly WorkbenchWritingAction[]; onRun: (action: WorkbenchWritingAction) => void }) {
  return (
    <div className="workbench-writing-actions">
      {actions.map((action) => (
        <button key={action.id} type="button" disabled={action.disabled} onClick={() => onRun(action)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
