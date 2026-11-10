import { defaultInterventionPreferences, interventionPreferencesSchema } from "@dietdigidose/contracts";
export function formatInterventionPreferences(row: Record<string,unknown> | null) {
  if (!row) return { ...defaultInterventionPreferences,version: 0 };
  const fields = Object.fromEntries(Object.keys(defaultInterventionPreferences).map(key => [key,row[key]]));
  for (const key of ["enabled","expiry_rescue","dinner_window"]) fields[key] = row[key] === true || row[key] === 1;
  return { ...interventionPreferencesSchema.parse(fields),version: Number(row.version) };
}
