import type { BotEvent, BotEventHandler } from "./types";

export class EventBus {
  private readonly handlers = new Set<BotEventHandler>();

  subscribe(handler: BotEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: BotEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
