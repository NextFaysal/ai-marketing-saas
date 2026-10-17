import { IsIn } from "class-validator";

/** SA-B6: the Answer Store management surface may only toggle a
 * healthy stored answer between serving (active) and held
 * (disabled). "invalidated" is a system state set by SA-B3's
 * live re-verification — never settable or clearable by hand. */
export class SetStoredAnswerStatusDto {
  @IsIn(["active", "disabled"]) status!: string;
}
