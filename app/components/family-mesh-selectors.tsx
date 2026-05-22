import type { Dispatch, SetStateAction } from "react";
import { RefreshCw } from "lucide-react";
import { Field, selectClass } from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import type { ConfigDto, MeshLiveCatalogPeerDto } from "@/server/dto";
import {
  meshInferenceProviderId,
  meshSearchProviderId,
  parseMeshProviderId,
} from "../../src/mesh/types";

export function FamilyInferenceSelector({
  catalogs,
  config,
  setConfig,
  purpose,
  onRefresh,
}: {
  catalogs: MeshLiveCatalogPeerDto[];
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  purpose: "primary" | "fast";
  onRefresh?: () => void;
}) {
  const providerId = purpose === "primary" ? config.aiProvider : config.fastAiProvider;
  const selected = parseMeshProviderId(providerId);
  const peer = catalogs.find((item) => item.peerId === selected?.peerId) ?? catalogs.find((item) => item.inference.length > 0);
  const service = peer?.inference.find((item) => item.id === selected?.serviceId) ?? peer?.inference[0];
  const model = purpose === "primary" ? config.aiModel : config.fastAiModel;
  const models = service?.models ?? [];
  const selectedUnavailable = selected && !catalogs.some((item) =>
    item.peerId === selected.peerId && item.inference.some((service) => service.id === selected.serviceId)
  );

  const choose = (peerId: string, serviceId: string, modelId?: string) => {
    const next = meshInferenceProviderId(peerId, serviceId);
    setConfig((current) => purpose === "primary"
      ? { ...current, aiProvider: next, aiApiUrl: "", aiModel: modelId ?? current.aiModel }
      : { ...current, fastAiProvider: next, fastAiApiUrl: "", fastAiModel: modelId ?? current.fastAiModel });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Family member">
        <select
          className={selectClass}
          value={peer?.peerId ?? selected?.peerId ?? ""}
          onChange={(event) => {
            const nextPeer = catalogs.find((item) => item.peerId === event.target.value);
            const nextService = nextPeer?.inference[0];
            if (nextPeer && nextService) choose(nextPeer.peerId, nextService.id, nextService.models[0]?.id ?? "");
          }}
        >
          {!peer && selected ? <option value={selected.peerId}>Selected family member unavailable</option> : null}
          {catalogs.filter((item) => item.inference.length > 0 || item.peerId === selected?.peerId).map((item) => (
            <option key={item.peerId} value={item.peerId} disabled={item.inference.length === 0}>
              {item.name}{item.error ? ` (${item.error})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Provider slot">
        <select
          className={selectClass}
          value={service?.id ?? selected?.serviceId ?? ""}
          onChange={(event) => {
            const nextService = peer?.inference.find((item) => item.id === event.target.value);
            if (peer && nextService) choose(peer.peerId, nextService.id, nextService.models[0]?.id ?? "");
          }}
        >
          {selectedUnavailable ? <option value={selected?.serviceId}>Selected service unavailable</option> : null}
          {peer?.inference.map((item) => (
            <option key={item.id} value={item.id}>
              {item.providerLabel} / {item.slotLabel}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model">
        <select
          className={selectClass}
          value={models.some((item) => item.id === model) ? model : ""}
          disabled={!service}
          onChange={(event) => {
            if (peer && service) choose(peer.peerId, service.id, event.target.value);
          }}
        >
          {!models.some((item) => item.id === model) && model ? <option value="">{model} (unavailable)</option> : null}
          {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </Field>
      {onRefresh ? (
        <div className="sm:col-span-3">
          <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh family catalog
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function FamilySearchSelector({
  catalogs,
  config,
  setConfig,
  onRefresh,
}: {
  catalogs: MeshLiveCatalogPeerDto[];
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  onRefresh?: () => void;
}) {
  const selected = parseMeshProviderId(config.searchProvider);
  const peer = catalogs.find((item) => item.peerId === selected?.peerId) ?? catalogs.find((item) => item.search.length > 0);
  const service = peer?.search.find((item) => item.id === selected?.serviceId) ?? peer?.search[0];
  const choose = (peerId: string, serviceId: string) => {
    const provider = meshSearchProviderId(peerId, serviceId) as ConfigDto["searchProvider"];
    setConfig((current) => ({ ...current, searchProvider: provider, searchApiUrl: "" }));
  };
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Family member">
        <select
          className={selectClass}
          value={peer?.peerId ?? selected?.peerId ?? ""}
          onChange={(event) => {
            const nextPeer = catalogs.find((item) => item.peerId === event.target.value);
            const nextService = nextPeer?.search[0];
            if (nextPeer && nextService) choose(nextPeer.peerId, nextService.id);
          }}
        >
          {!peer && selected ? <option value={selected.peerId}>Selected family member unavailable</option> : null}
          {catalogs.filter((item) => item.search.length > 0 || item.peerId === selected?.peerId).map((item) => (
            <option key={item.peerId} value={item.peerId} disabled={item.search.length === 0}>
              {item.name}{item.error ? ` (${item.error})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Search service">
        <select
          className={selectClass}
          value={service?.id ?? selected?.serviceId ?? ""}
          onChange={(event) => {
            if (peer) choose(peer.peerId, event.target.value);
          }}
        >
          {selected && !service ? <option value={selected.serviceId}>Selected service unavailable</option> : null}
          {peer?.search.map((item) => (
            <option key={item.id} value={item.id}>
              {item.providerLabel} / {item.mode}
            </option>
          ))}
        </select>
      </Field>
      {onRefresh ? (
        <Button type="button" variant="ghost" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      ) : null}
    </div>
  );
}
