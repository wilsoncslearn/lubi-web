import { isDate, isTime } from '@lubi/domain';
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const filled = (value: unknown): boolean => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0) && (!object(value) || Object.keys(value).length > 0);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
export type PreviewIssue = { code: string; count: number; severity: 'error'|'unsupported' };
export type ObsidianPreview = { format: 'lubi-data'; version: 1; sourceSchema: number; counts: { projects: number; tasks: number; records: number; archivedContainers: number }; issues: PreviewIssue[]; readyForDirectImport: false };
/** Read-only shape/coverage inventory. Does not map, write, or store source data. */
export function previewObsidianExport(value: unknown): { result?: ObsidianPreview; error?: string } {
  if (!object(value) || value.format !== 'lubi-data' || value.version !== 1 || !object(value.taskStore) || !Array.isArray(value.records))
    return {error:'Not a supported Lubi plugin export'};
  const store = value.taskStore;
  if (store.version !== 14 || !Array.isArray(store.tasks) || (store.projects !== undefined && !Array.isArray(store.projects)) ||
      (store.projectContainers !== undefined && !Array.isArray(store.projectContainers))) return {error:'Expected task schema v14'};
  if (store.tasks.length > 10000 || value.records.length > 50000 || (store.projects as unknown[]|undefined)?.length! > 5000) return {error:'Export exceeds preview limits'};
  const tasks = store.tasks as unknown[], records = value.records as unknown[], projects = (store.projects || []) as unknown[], containers = (store.projectContainers || []) as unknown[];
  const counts = new Map<string,{count:number;severity:'error'|'unsupported'}>();
  const issue = (code:string,severity:'error'|'unsupported'='unsupported') => {const prior=counts.get(code);counts.set(code,{count:(prior?.count || 0)+1,severity});};
  const taskIds = new Set<string>(), projectIds = new Set<string>();
  for(const project of projects) {
    if(!object(project) || !text(project.id) || !text(project.title)) {issue('INVALID_PROJECT','error');continue;}
    if(projectIds.has(project.id)) issue('DUPLICATE_PROJECT_ID','error');projectIds.add(project.id);
    if(filled(project.budgetMinutes)) issue('PROJECT_BUDGET_NOT_MODELED');
  }
  for(const item of tasks) {
    if(!object(item) || !text(item.id) || !text(item.title)) {issue('INVALID_TASK','error');continue;}
    if(taskIds.has(item.id)) issue('DUPLICATE_TASK_ID','error');taskIds.add(item.id);
    if(item.project && (!text(item.project) || !projectIds.has(item.project))) issue('MISSING_PROJECT','error');
    if(item.date && (!text(item.date) || !isDate(item.date))) issue('INVALID_TASK_DATE','error');
    if(filled(item.parent)) issue('PARENT_HIERARCHY_NOT_MODELED');
    if(filled(item.start)) issue('SCHEDULE_TIME_NOT_MODELED');
    if(filled(item.location)) issue('LOCATION_NOT_MODELED');
    if(filled(item.notes)) issue('NOTES_NOT_MODELED');
    if(item.blocked === true) issue('BLOCKED_STATUS_NOT_MODELED');
    if(filled(item.executor) && item.executor !== 'self') issue('BACKGROUND_EXECUTION_NOT_MODELED');
    if(filled(item.backgroundRuns)) issue('BACKGROUND_RUNS_NOT_MODELED');
    if(filled(item.doneLogs)) issue('LEGACY_RECORD_LINKS_NOT_MODELED');
    if(filled(item.outcome)) issue('OUTCOME_NOT_MODELED');
    if(filled(item.budgetMinutes)) issue('TASK_BUDGET_NOT_MODELED');
    if(filled(item.origin)) issue('RECORD_ORIGIN_NOT_MODELED');
  }
  for(const item of records) {
    if(!object(item) || !text(item.date) || !isDate(item.date) || !text(item.start) || !isTime(item.start) ||
       !text(item.title) || typeof item.minutes !== 'number' || !Number.isFinite(item.minutes) || item.minutes<0) {issue('INVALID_RECORD','error');continue;}
    if(item.task && (!text(item.task) || !taskIds.has(item.task))) issue('MISSING_TASK_LINK','error');
    if(filled(item.amount) || filled(item.expenseType)) issue('EXPENSE_NOT_MODELED');
    if(filled(item.notes)) issue('RECORD_NOTES_NOT_MODELED');
    if(filled(item.extra)) issue('EXTRA_FIELDS_OR_PENDING_NOT_MODELED');
    const [hour,minute]=item.start.split(':').map(Number);
    if(hour*60+minute+(item.minutes as number)>1440) issue('CROSSES_MIDNIGHT_NOT_MODELED');
  }
  if(containers.length) issue('ARCHIVED_PROJECT_CONTAINERS_NOT_MODELED');
  if(filled(store.legacyParentLinks)) issue('LEGACY_PARENT_LINKS_NOT_MODELED');
  return {result:{format:'lubi-data',version:1,sourceSchema:14,
    counts:{projects:projects.length,tasks:tasks.length,records:records.length,archivedContainers:containers.length},
    issues:[...counts.entries()].map(([code,v])=>({code,count:v.count,severity:v.severity})).sort((a,b)=>a.severity.localeCompare(b.severity)||a.code.localeCompare(b.code)),
    readyForDirectImport:false}};
}
