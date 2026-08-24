import { objectFromUnknown, toList, toText } from "./schema-utils";

export type RoleData = {
  jobTitle: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
};

export type RoleRow = RoleData & { id: string };

export function roleFromUnknown(input: unknown): RoleData {
  const map = objectFromUnknown(input);

  return {
    jobTitle: toText(map.jobTitle),
    description: toText(map.description),
    responsibilities: toList(map.responsibilities, /\r?\n|;/),
    requirements: toList(map.requirements, /\r?\n|;/),
    skills: toList(map.skills, /[,;]|\r?\n/),
  };
}
