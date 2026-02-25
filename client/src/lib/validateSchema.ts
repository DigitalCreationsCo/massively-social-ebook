import { parseISO, isAfter } from 'date-fns';

export interface SchemaParams {
  startDate: string;
  endDate: string;
  validFrom: string;
}

/**
 * Validates that all critical JSON-LD dates are logically sound.
 * Ensures the start date is in the future and the end date follows the start date.
 */
export function validateSchemaDates(paramsSchemaJson: SchemaParams, referenceDate: Date = new Date()): boolean {
  try {
    const dateStart = parseISO(paramsSchemaJson.startDate);
    const dateEnd = parseISO(paramsSchemaJson.endDate);
    const dateValidFrom = parseISO(paramsSchemaJson.validFrom);

    const isStartInFuture = isAfter(dateStart, referenceDate);
    const isEndAfterStart = isAfter(dateEnd, dateStart);
    const isValidFromBeforeStart = isAfter(dateStart, dateValidFrom);

    if (!isStartInFuture) {
      console.error(`[Trace: SchemaError] startDate ${paramsSchemaJson.startDate} must be in the future (relative to ${referenceDate.toISOString()}).`);
      return false;
    }

    if (!isEndAfterStart) {
      console.error(`[Trace: SchemaError] endDate must be after startDate.`);
      return false;
    }

    if (!isValidFromBeforeStart) {
        console.error(`[Trace: SchemaError] validFrom must be before startDate.`);
        return false;
    }

    return isStartInFuture && isEndAfterStart && isValidFromBeforeStart;
  } catch (error) {
    console.error(`[Trace: SchemaCritialError] Failed to parse schema dates:`, error);
    return false;
  }
}
