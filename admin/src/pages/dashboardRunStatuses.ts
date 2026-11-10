// Waiting for a user is a resumable workflow state, not an execution failure.
export const failureRunStatuses = [
  { status: 'failed', label: '失败任务' },
  { status: 'expired', label: '已过期任务' },
] as const;
export const waitingRunStatuses = [
  { status: 'awaiting_input', label: '等待用户输入' },
  { status: 'awaiting_approval', label: '等待用户确认' },
] as const;
