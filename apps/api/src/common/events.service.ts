import { Global, Injectable, Logger, Module } from "@nestjs/common";

/**
 * Minimal in-process event bus. Producers (orders, leads) emit domain
 * events; consumers (workflows) subscribe. Emission is fire-and-forget:
 * a failing consumer is logged, never allowed to break the producer's
 * operation (e.g. an order sync must not fail because an email failed -
 * the workflow run records the failure instead).
 */
type Handler = (payload: any) => Promise<void> | void;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, payload: any): void {
    const list = this.handlers.get(event) ?? [];
    for (const handler of list) {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((e) => this.logger.warn(`Event handler failed (${event}): ${e instanceof Error ? e.message : e}`));
    }
  }
}

@Global()
@Module({ providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
