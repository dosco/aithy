import type { UsageAdvisor } from "../../src/usage/advisor";

export type UsageAdvisorLabelDto = UsageAdvisor["rows"][number]["label"];
export type UsageAdvisorConfidenceDto = UsageAdvisor["rows"][number]["confidence"];
export type UsageAdvisorReliabilityDto = UsageAdvisor["rows"][number]["reliability"];
export type UsageAdvisorRowDto = UsageAdvisor["rows"][number];
export type UsageAdvisorComponentDto = UsageAdvisor["components"][number];
export type UsageAdvisorDto = UsageAdvisor;
