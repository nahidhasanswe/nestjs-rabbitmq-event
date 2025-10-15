import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { defaultIfEmpty, lastValueFrom, Observable } from 'rxjs';
import { RabbitMQTransport } from '../transports/rabbitmq.transport';
import type { RabbitMQOptions } from '../interfaces/rabbitmq-options.interface';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private transport: RabbitMQTransport;

  constructor(private readonly options: RabbitMQOptions) {
    this.transport = new RabbitMQTransport(options);
  }

  async onModuleInit() {
    await this.transport.connect();
  }

  async onModuleDestroy() {
    await this.transport.close();
  }

  send<TResult = any, TInput = any>(pattern: string, data: TInput): Observable<TResult> {
    return this.transport.send(pattern, data);
  }

  async sendAsync<TResult = any, TInput = any>(pattern: string, data: TInput): Promise<TResult> {
    return lastValueFrom(
      this.transport.send(pattern, data).pipe(
        defaultIfEmpty(undefined as void)
      )
    );
  }

  emit<TResult = any, TInput = any>(pattern: string, data: TInput): Observable<TResult> {
    return this.transport.emit(pattern, data);
  }

  async emitAsync<TInput = any>(pattern: string, data: TInput): Promise<void> {
    return lastValueFrom(
        this.transport.emit(pattern, data).pipe(
        defaultIfEmpty(undefined as void)
        )
    );
  }

  registerHandler(pattern: string, handler: (data: any) => Promise<any>) {
    this.transport.registerHandler(pattern, handler);
  }

  getClient(): RabbitMQTransport {
    return this.transport;
  }

  unwrap(): any {
    return this.transport.unwrap();
  }

  isConnected(): boolean {
    return this.transport.getConnectionStatus();
  }
}