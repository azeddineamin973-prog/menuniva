import { z } from 'zod';
import { DAY_KEYS, type OpeningHours } from './opening-hours';

/** Validation of opening hours sent by forms and found by discovery (server side only). */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const range = z.object({ open: hhmm, close: hhmm });
export const openingHoursSchema: z.ZodType<OpeningHours> = z.partialRecord(z.enum(DAY_KEYS), z.array(range).max(3));
