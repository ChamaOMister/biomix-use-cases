import type { SalesField } from "./columns";
import type { ImportIssue, IssueCode, IssueSeverity } from "./types";

/**
 * Allowlisted, log-safe projection of an issue: only fields whose values the importer itself
 * defines. Sheet names, header text, messages, suggestions and caller identifiers are excluded.
 */
export interface IssueDiagnostic {
  severity: IssueSeverity;
  code: IssueCode;
  row: number | null;
  cell: string | null;
  field: SalesField | null;
}

export function issueDiagnostics(issue: ImportIssue): IssueDiagnostic {
  return {
    severity: issue.severity,
    code: issue.code,
    row: issue.row,
    cell: issue.cell,
    field: issue.field,
  };
}
