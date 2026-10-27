import { artsDesign } from "./library/arts-design";
import { businessMarketing } from "./library/business-marketing";
import { computerScience } from "./library/computer-science";
import { engineering } from "./library/engineering";
import { healthMedicine } from "./library/health-medicine";
import { humanitiesSocial } from "./library/humanities-social";
import { schoolGeneral } from "./library/school-general";
import { science } from "./library/science";
import type { FieldId, Goal, Level, LearningModule } from "./types";

/**
 * Every subject has one module for each difficulty and each thing a student can want to improve:
 * 8 subjects x 3 levels x 5 goals = 120 modules. Each one has its own passage and its own
 * questions, ordered from easy to difficult.
 */
export const MODULES: LearningModule[] = [
  ...computerScience,
  ...businessMarketing,
  ...science,
  ...engineering,
  ...healthMedicine,
  ...humanitiesSocial,
  ...artsDesign,
  ...schoolGeneral,
];

/** Sessions saved before goals had their own modules used `${field}-${level}`. Those were the "explain clearly" passages. */
const LEGACY_GOAL: Goal = "clarity";

export function moduleId(field: FieldId, level: Level, goal: Goal): string {
  return `${field}-${level}-${goal}`;
}

export function getModule(id: string): LearningModule | undefined {
  return MODULES.find((m) => m.id === id) ?? MODULES.find((m) => `${m.field}-${m.level}` === id && m.goal === LEGACY_GOAL);
}

export function modulesForField(field: FieldId): LearningModule[] {
  return MODULES.filter((m) => m.field === field);
}

/** The module for exactly this subject, level and goal. */
export function findModule(field: FieldId, level: Level, goal: Goal): LearningModule | undefined {
  return MODULES.find((m) => m.field === field && m.level === level && m.goal === goal);
}

/** The modules a student sees: their subject and goal, at every level. */
export function modulesFor(field: FieldId, goal: Goal): LearningModule[] {
  return MODULES.filter((m) => m.field === field && m.goal === goal);
}
