import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { connect, Channel, Message, ChannelModel } from 'amqplib';
import { Observable, Observer } from 'rxjs';
import type { RabbitMQMessage, RabbitMQOptions } from '../interfaces/rabbitmq-options.interface';
import { DEFAULT_EXCHANGE, DEFAULT_EXCHANGE_TYPE, DEFAULT_PREFETCH_COUNT, DEFAULT_QUEUE } from '../constants/rabbitmq.constants';

@Injectable()
export class RabbitMQTransport extends ClientProxy implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQTransport.name);
  private connection: ChannelModel;
  private channel: Channel;
  private readonly options: RabbitMQOptions;
  private readonly handlers: Map<string, (data: any) => Promise<any>> = new Map();
  private readonly pendingRequests: Map<string, (packet: WritePacket) => void> = new Map();
  private isConnected = false;
  private replyQueue: string;

  constructor(options: RabbitMQOptions) {
    super();
    this.options = options;
  }

  async onModuleInit() {
    await this.connect();
  }

  async connect(): Promise<any> {
    if (this.isConnected) return;

    try {
      this.connection = await connect(Array.isArray(this.options.urls) ? this.options.urls[0] : this.options.urls);
      this.channel = await this.connection.createChannel();

      const queue = this.options.queue || DEFAULT_QUEUE;
      const exchange = this.options.exchange || DEFAULT_EXCHANGE;
      const exchangeType = this.options.exchangeType || DEFAULT_EXCHANGE_TYPE;

      // Assert exchange
      await this.channel.assertExchange(exchange, exchangeType, { durable: true });

      // Assert main queue
      await this.channel.assertQueue(queue, this.options.queueOptions || { durable: true });
      await this.channel.bindQueue(queue, exchange, '#');

      // Create reply queue for request-response
      const replyQueue = await this.channel.assertQueue('', { exclusive: true });
      this.replyQueue = replyQueue.queue;

      // Prefetch for fair dispatch
      await this.channel.prefetch(this.options.prefetchCount || DEFAULT_PREFETCH_COUNT);

      this.startMessageListener(queue);
      this.startReplyListener();

      this.isConnected = true;
      this.logger.log(`Connected to RabbitMQ. Queue: ${queue}, Exchange: ${exchange}`);

      return this.connection;
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.isConnected = false;
    this.pendingRequests.clear();
    this.logger.log('RabbitMQ connection closed');
  }

  async onModuleDestroy() {
    await this.close();
  }

  unwrap(): any {
    return {
      connection: this.connection,
      channel: this.channel,
      isConnected: this.isConnected,
      options: this.options,
    };
  }

  protected dispatchEvent<T = any>(packet: ReadPacket<T>): Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        const message: RabbitMQMessage = {
          pattern: packet.pattern,
          data: packet.data,
          id: this.generateMessageId(),
          timestamp: new Date(),
        };

        const exchange = this.options.exchange || DEFAULT_EXCHANGE;

        await this.channel.publish(
          exchange,
          packet.pattern,
          Buffer.from(JSON.stringify(message)),
          { persistent: this.options.persistent !== false }
        );

        this.logger.debug(`Event dispatched: ${packet.pattern}`);
        resolve(undefined);
      } catch (error) {
        this.logger.error(`Failed to dispatch event: ${packet.pattern}`, error);
        reject(error);
      }
    });
  }

  protected publish<T = any, R = any>(
    packet: ReadPacket<T>,
    callback: (packet: WritePacket<R>) => void,
  ): () => void {
    const messageId = this.generateMessageId();
    this.pendingRequests.set(messageId, callback);

    const message: RabbitMQMessage = {
      pattern: packet.pattern,
      data: packet.data,
      id: messageId,
      timestamp: new Date(),
      replyTo: this.replyQueue,
      correlationId: messageId,
    };

    const exchange = this.options.exchange || DEFAULT_EXCHANGE;

    // Send message and handle response
    this.channel.sendToQueue(
      this.options.queue || DEFAULT_QUEUE,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: this.options.persistent !== false,
        replyTo: this.replyQueue,
        correlationId: messageId,
      }
    );

    this.logger.debug(`Message published: ${packet.pattern}`);

    const timeout = this.options.retryOptions?.timeoutInMs || 30000;
    const timeoutId = setTimeout(() => {
      if (this.pendingRequests.has(messageId)) {
        callback({ err: new Error(`Request timeout for pattern: ${packet.pattern}`) });
        this.pendingRequests.delete(messageId);
      }
    }, timeout);

    // Return cleanup function
    return () => {
      clearTimeout(timeoutId);
      this.pendingRequests.delete(messageId);
    };
  }

  send<TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    if (!this.isConnected) {
      throw new Error('RabbitMQ is not connected. Call connect() first.');
    }

    return new Observable((observer: Observer<TResult>) => {
      const cleanup = this.publish(
        { pattern, data },
        this.createObserver(observer),
      );

      return () => {
        cleanup();
        observer.complete();
      };
    });
  }

  emit<TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    if (!this.isConnected) {
      throw new Error('RabbitMQ is not connected. Call connect() first.');
    }

    return new Observable((observer: Observer<TResult>) => {
      this.dispatchEvent({ pattern, data })
        .then(() => {
          observer.next(undefined as any);
          observer.complete();
        })
        .catch(err => {
          observer.error(err);
        });
    });
  }

  public createObserver<T>(observer: Observer<T>): (packet: WritePacket) => void {
    return ({ err, response, isDisposed }: WritePacket) => {
      if (err) {
        this.logger.error(`Error in message response: ${err.message}`);
        observer.error(err);
        return;
      }

      if (isDisposed) {
        observer.complete();
        return;
      }

      observer.next(response);
    };
  }

  private startMessageListener(queue: string) {
    this.channel.consume(queue, async (msg: Message | null) => {
      if (!msg) return;

      try {
        const message: RabbitMQMessage = JSON.parse(msg.content.toString());
        await this.handleIncomingMessage(message, msg);
        if (!this.options.noAck) {
          this.channel.ack(msg);
        }
      } catch (error) {
        this.logger.error('Error processing message:', error);
        if (!this.options.noAck) {
          this.channel.nack(msg);
        }
      }
    }, { noAck: this.options.noAck || false });

    this.logger.log(`Message listener started for queue: ${queue}`);
  }

  private startReplyListener() {
    this.channel.consume(this.replyQueue, (msg: Message | null) => {
      if (!msg) return;

      try {
        const message: RabbitMQMessage = JSON.parse(msg.content.toString());
        this.handleResponseMessage(message);
        this.channel.ack(msg);
      } catch (error) {
        this.logger.error('Error processing reply:', error);
        this.channel.nack(msg);
      }
    }, { noAck: false });

    this.logger.log(`Reply listener started for queue: ${this.replyQueue}`);
  }

  private async handleIncomingMessage(message: RabbitMQMessage, msg: Message) {
    if (this.handlers.has(message.pattern)) {
      await this.handleRequestMessage(message, msg);
    } else {
      this.logger.warn(`No handler found for pattern: ${message.pattern}`);
    }
  }

  private async handleRequestMessage(message: RabbitMQMessage, msg: Message) {
    const handler = this.handlers.get(message.pattern);

    if (!handler) {
      this.logger.warn(`No handler found for pattern: ${message.pattern}`);
      return;
    }

    try {
      const result = await handler(message.data);

      if (message.replyTo && msg.properties.correlationId) {
        await this.sendResponse(message, result, msg.properties.correlationId);
      }
    } catch (error) {
      this.logger.error(`Error executing handler for ${message.pattern}:`, error);

      if (message.replyTo && msg.properties.correlationId) {
        await this.sendErrorResponse(message, error, msg.properties.correlationId);
      }
    }
  }

  private handleResponseMessage(message: RabbitMQMessage) {
    const callback = this.pendingRequests.get(message.correlationId || '');
    if (callback) {
      if (message.data?.error) {
        callback({ err: new Error(message.data.error) });
      } else {
        callback({ response: message.data, isDisposed: true });
      }
      this.pendingRequests.delete(message.correlationId || '');
    }
  }

  private async sendResponse(originalMessage: RabbitMQMessage, result: any, correlationId: string) {
    const responseMessage: RabbitMQMessage = {
      pattern: 'RESPONSE',
      data: result,
      id: this.generateMessageId(),
      timestamp: new Date(),
      correlationId: correlationId,
    };

    this.channel.sendToQueue(
      originalMessage.replyTo || DEFAULT_QUEUE,
      Buffer.from(JSON.stringify(responseMessage)),
      { correlationId }
    );
  }

  private async sendErrorResponse(originalMessage: RabbitMQMessage, error: Error, correlationId: string) {
    const errorResponse: RabbitMQMessage = {
      pattern: 'RESPONSE',
      data: { error: error.message },
      id: this.generateMessageId(),
      timestamp: new Date(),
      correlationId: correlationId,
    };

    this.channel.sendToQueue(
      originalMessage.replyTo || DEFAULT_QUEUE,
      Buffer.from(JSON.stringify(errorResponse)),
      { correlationId }
    );
  }

  public registerHandler(pattern: string, handler: (data: any) => Promise<any>) {
    this.handlers.set(pattern, handler);
    this.logger.log(`Handler registered for pattern: ${pattern}`);
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}