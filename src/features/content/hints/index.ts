// SERVER ONLY. Do not import this from a component or any code that runs in the browser: it would send every hint to every student.
import { hints_13to17_arts_design } from "./13to17/arts-design";
import { hints_13to17_business_marketing } from "./13to17/business-marketing";
import { hints_13to17_computer_science } from "./13to17/computer-science";
import { hints_13to17_engineering } from "./13to17/engineering";
import { hints_13to17_health_medicine } from "./13to17/health-medicine";
import { hints_13to17_humanities_social } from "./13to17/humanities-social";
import { hints_13to17_school_general } from "./13to17/school-general";
import { hints_13to17_science } from "./13to17/science";
import { hints_18plus_arts_design } from "./18plus/arts-design";
import { hints_18plus_business_marketing } from "./18plus/business-marketing";
import { hints_18plus_computer_science } from "./18plus/computer-science";
import { hints_18plus_engineering } from "./18plus/engineering";
import { hints_18plus_health_medicine } from "./18plus/health-medicine";
import { hints_18plus_humanities_social } from "./18plus/humanities-social";
import { hints_18plus_school_general } from "./18plus/school-general";
import { hints_18plus_science } from "./18plus/science";
import { hints_18plus_management_leadership } from "./18plus/management-leadership";
import { hints_18plus_management_hr } from "./18plus/management-hr";
import { hints_18plus_management_finance } from "./18plus/management-finance";
import { hints_18plus_management_operations } from "./18plus/management-operations";
import { hints_under13_arts_design } from "./under13/arts-design";
import { hints_under13_business_marketing } from "./under13/business-marketing";
import { hints_under13_computer_science } from "./under13/computer-science";
import { hints_under13_engineering } from "./under13/engineering";
import { hints_under13_health_medicine } from "./under13/health-medicine";
import { hints_under13_humanities_social } from "./under13/humanities-social";
import { hints_under13_school_general } from "./under13/school-general";
import { hints_under13_science } from "./under13/science";

/** What a strong answer contains for each question of each module, by module id. */
const ALL: Record<string, string[]> = {
  ...hints_13to17_arts_design,
  ...hints_13to17_business_marketing,
  ...hints_13to17_computer_science,
  ...hints_13to17_engineering,
  ...hints_13to17_health_medicine,
  ...hints_13to17_humanities_social,
  ...hints_13to17_school_general,
  ...hints_13to17_science,
  ...hints_18plus_arts_design,
  ...hints_18plus_business_marketing,
  ...hints_18plus_computer_science,
  ...hints_18plus_engineering,
  ...hints_18plus_health_medicine,
  ...hints_18plus_humanities_social,
  ...hints_18plus_school_general,
  ...hints_18plus_science,
  ...hints_18plus_management_leadership,
  ...hints_18plus_management_hr,
  ...hints_18plus_management_finance,
  ...hints_18plus_management_operations,
  ...hints_under13_arts_design,
  ...hints_under13_business_marketing,
  ...hints_under13_computer_science,
  ...hints_under13_engineering,
  ...hints_under13_health_medicine,
  ...hints_under13_humanities_social,
  ...hints_under13_school_general,
  ...hints_under13_science,
};

export function answerHintsFor(moduleId: string): string[] | undefined {
  return ALL[moduleId];
}

export const ALL_ANSWER_HINTS = ALL;
