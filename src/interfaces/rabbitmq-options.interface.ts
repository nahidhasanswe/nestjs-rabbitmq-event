export interface RabbitMQOptions {
  urls: string[];
  queue?: string;
  queueOptions?: {
    durable?: boolean;
    exclusive?: boolean;
    autoDelete?: boolean;
    arguments?: any;
  };
  exchange?: string;
  exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
  prefetchCount?: number;
  noAck?: boolean;
  persistent?: boolean;
  retryOptions?: {
    maxRetries?: number;
    delayInMs?: number;
    timeoutInMs?: number;
  };
}

export interface RabbitMQMessage<T = any> {
  pattern: string;
  data: T;
  id: string;
  timestamp: Date;
  correlationId?: string;
  replyTo?: string;
}