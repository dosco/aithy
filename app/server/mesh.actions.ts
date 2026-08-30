import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  meshPairInput,
  meshCatalogInput,
  meshEnabledInput,
  meshPeerInput,
  meshSharingInput,
  meshTrustInput,
} from "./action-schemas";
import { meshPageStateDto } from "./web-state.dto";

export const openMeshPairingWindow = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.mesh.openPairingWindow();
    return meshPageStateDto(runtime);
  });

export const pairMeshPeer = createServerFn({ method: "POST" })
  .validator(meshPairInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.mesh.pairWithDiscoveredPeer(data.peerId, data.code);
    return meshPageStateDto(runtime);
  });

export const setMeshPeerTrust = createServerFn({ method: "POST" })
  .validator(meshTrustInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.mesh.setTrustLevel(data.peerId, data.trustLevel);
    return meshPageStateDto(runtime);
  });

export const revokeMeshPeer = createServerFn({ method: "POST" })
  .validator(meshPeerInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.mesh.revokePeer(data.peerId);
    return meshPageStateDto(runtime);
  });

export const unpairMeshPeer = createServerFn({ method: "POST" })
  .validator(meshPeerInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.mesh.unpairPeer(data.peerId);
    return meshPageStateDto(runtime);
  });

export const saveMeshSharing = createServerFn({ method: "POST" })
  .validator(meshSharingInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.mesh.updateSharing(data);
    return meshPageStateDto(runtime);
  });

export const saveMeshEnabled = createServerFn({ method: "POST" })
  .validator(meshEnabledInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.mesh.setEnabled(data.enabled);
    return meshPageStateDto(runtime);
  });

export const getMeshFamilyCatalogs = createServerFn({ method: "POST" })
  .validator(meshCatalogInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return runtime.mesh.liveCatalogs(data.kind ?? "all");
  });

export const regenerateMeshIdentity = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.mesh.regenerateIdentity();
    return meshPageStateDto(runtime);
  });
