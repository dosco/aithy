import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { soulInput } from "./action-schemas";
import { soulDto } from "./dto";

export const saveSoul = createServerFn({ method: "POST" })
  .validator(soulInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const profile = runtime.updateSoul({
      name: data.name.trim(),
      description: data.description.trim(),
      coreNature: data.coreNature.trim(),
      communicationStyle: data.communicationStyle.trim(),
      behaviour: data.behaviour.trim(),
      negativeBehavior: data.negativeBehavior.trim(),
    });
    return soulDto(profile);
  });
