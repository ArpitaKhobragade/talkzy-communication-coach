import { artsDesign18plus } from "./library/18plus/arts-design";
import { businessMarketing18plus } from "./library/18plus/business-marketing";
import { computerScience18plus } from "./library/18plus/computer-science";
import { engineering18plus } from "./library/18plus/engineering";
import { healthMedicine18plus } from "./library/18plus/health-medicine";
import { humanitiesSocial18plus } from "./library/18plus/humanities-social";
import { schoolGeneral18plus } from "./library/18plus/school-general";
import { science18plus } from "./library/18plus/science";
import { managementLeadership18plus } from "./library/18plus/management-leadership";
import { managementHr18plus } from "./library/18plus/management-hr";
import { managementFinance18plus } from "./library/18plus/management-finance";
import { managementOperations18plus } from "./library/18plus/management-operations";
import { artsDesign13to17 } from "./library/13to17/arts-design";
import { businessMarketing13to17 } from "./library/13to17/business-marketing";
import { computerScience13to17 } from "./library/13to17/computer-science";
import { engineering13to17 } from "./library/13to17/engineering";
import { healthMedicine13to17 } from "./library/13to17/health-medicine";
import { humanitiesSocial13to17 } from "./library/13to17/humanities-social";
import { schoolGeneral13to17 } from "./library/13to17/school-general";
import { science13to17 } from "./library/13to17/science";
import { artsDesignUnder13 } from "./library/under13/arts-design";
import { businessMarketingUnder13 } from "./library/under13/business-marketing";
import { computerScienceUnder13 } from "./library/under13/computer-science";
import { engineeringUnder13 } from "./library/under13/engineering";
import { healthMedicineUnder13 } from "./library/under13/health-medicine";
import { humanitiesSocialUnder13 } from "./library/under13/humanities-social";
import { schoolGeneralUnder13 } from "./library/under13/school-general";
import { scienceUnder13 } from "./library/under13/science";
import type { AgeGroup, FieldId, Goal, Level, LearningModule } from "./types";

/**
 * Every subject has one module for each difficulty, each thing a student can want to improve, and each age
 * group: 8 subjects x 3 levels x 5 goals x 3 age groups = 360 modules, plus 4 management subjects written for adults only (60 modules). Each one has its own passage and its
 * own questions, ordered from easy to difficult. The level is about the English; the age group is about the
 * topic, the people in the story and the tone.
 */
export const MODULES: LearningModule[] = [
  ...computerScienceUnder13,
  ...businessMarketingUnder13,
  ...scienceUnder13,
  ...engineeringUnder13,
  ...healthMedicineUnder13,
  ...humanitiesSocialUnder13,
  ...artsDesignUnder13,
  ...schoolGeneralUnder13,
  ...computerScience13to17,
  ...businessMarketing13to17,
  ...science13to17,
  ...engineering13to17,
  ...healthMedicine13to17,
  ...humanitiesSocial13to17,
  ...artsDesign13to17,
  ...schoolGeneral13to17,
  ...computerScience18plus,
  ...businessMarketing18plus,
  ...science18plus,
  ...engineering18plus,
  ...healthMedicine18plus,
  ...humanitiesSocial18plus,
  ...artsDesign18plus,
  ...schoolGeneral18plus,
  ...managementLeadership18plus,
  ...managementHr18plus,
  ...managementFinance18plus,
  ...managementOperations18plus,
];

/** Sessions saved before goals had their own modules used `${field}-${level}`. Those were the "explain clearly" passages. */
const LEGACY_GOAL: Goal = "clarity";
/** Sessions saved before age groups had their own modules used `${field}-${level}-${goal}`. Those were the 13 to 17 modules. */
const LEGACY_AGE: AgeGroup = "13to17";

export function moduleId(field: FieldId, level: Level, goal: Goal, age: AgeGroup): string {
  return `${field}-${level}-${goal}-${age}`;
}

export function getModule(id: string): LearningModule | undefined {
  return (
    MODULES.find((m) => m.id === id) ??
    MODULES.find((m) => m.age === LEGACY_AGE && `${m.field}-${m.level}-${m.goal}` === id) ??
    MODULES.find((m) => m.age === LEGACY_AGE && m.goal === LEGACY_GOAL && `${m.field}-${m.level}` === id)
  );
}

export function modulesForField(field: FieldId): LearningModule[] {
  return MODULES.filter((m) => m.field === field);
}

/** The module for exactly this subject, level, goal and age group. */
export function findModule(field: FieldId, level: Level, goal: Goal, age: AgeGroup): LearningModule | undefined {
  return MODULES.find((m) => m.field === field && m.level === level && m.goal === goal && m.age === age);
}

/** The modules a student sees: their subject, goal and age group, at every level. */
export function modulesFor(field: FieldId, goal: Goal, age: AgeGroup): LearningModule[] {
  return MODULES.filter((m) => m.field === field && m.goal === goal && m.age === age);
}

// ---------------------------------------------------------------------------------------------
// A student may not know their subject, their difficulty or what they want to improve. Then the
// library shows a small, useful mix instead of nothing.

const LEVELS_EASY_FIRST: Level[] = ["beginner", "intermediate", "advanced"];
const GOALS_IN_ORDER: Goal[] = ["fluency", "clarity", "vocabulary", "confidence", "interview"];
/** Friendliest subjects first, so a student who is not sure meets the easiest topics first. Management subjects come first. */
const SUBJECTS_IN_ORDER: FieldId[] = [
  "business-marketing",
  "management-leadership",
  "management-hr",
  "management-operations",
  "management-finance",
  "computer-science",
];

export interface ProfileChoices {
  field: FieldId | "unsure";
  level: Level | "unsure";
  goal: Goal | "unsure";
  ageBand: AgeGroup;
}

export interface ProfileModules {
  modules: LearningModule[];
  /** Which of the three choices the student has not made. */
  unsure: { field: boolean; level: boolean; goal: boolean };
}

/** The modules to show a student: exactly their choices when they made all three, a helpful mix when they did not. */
export function modulesForProfile(p: ProfileChoices): ProfileModules {
  const age = p.ageBand;
  const unsure = { field: p.field === "unsure", level: p.level === "unsure", goal: p.goal === "unsure" };
  const pick = (field: FieldId, level: Level, goal: Goal) => findModule(field, level, goal, age);
  const field = p.field === "unsure" ? null : p.field;
  const level = p.level === "unsure" ? null : p.level;
  const goal = p.goal === "unsure" ? null : p.goal;
  let list: (LearningModule | undefined)[];

  if (field && level && goal) {
    // Their own level first, then the others from easy to hard.
    const order = [level, ...LEVELS_EASY_FIRST.filter((l) => l !== level)];
    list = order.map((l) => pick(field, l, goal));
  } else if (field && level) {
    list = GOALS_IN_ORDER.map((g) => pick(field, level, g)); // not sure what to improve: one module for every goal
  } else if (field && goal) {
    list = LEVELS_EASY_FIRST.map((l) => pick(field, l, goal)); // not sure how hard: all three, easiest first
  } else if (level && goal) {
    list = SUBJECTS_IN_ORDER.map((f) => pick(f, level, goal)); // not sure what subject: one for every subject
  } else if (field) {
    list = GOALS_IN_ORDER.map((g) => pick(field, "beginner", g)); // only the subject: every goal, easy
  } else if (level) {
    list = GOALS_IN_ORDER.map((g, i) => pick(SUBJECTS_IN_ORDER[i], level, g)); // only the difficulty: every goal, different subjects
  } else if (goal) {
    list = SUBJECTS_IN_ORDER.map((f) => pick(f, "beginner", goal)); // only the goal: every subject, easy
  } else {
    // Nothing chosen: a starter set of easy modules, marketing and management first, covering all five goals.
    list = [...GOALS_IN_ORDER.map((g) => pick("business-marketing", "beginner", g)), pick("management-leadership", "beginner", "fluency")];
  }

  const seen = new Set<string>();
  const modules = list.filter((m): m is LearningModule => {
    if (!m || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return { modules, unsure };
}
