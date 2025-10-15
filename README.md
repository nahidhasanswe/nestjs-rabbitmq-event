# NestJS RabbitMQ Transport

A production-ready NestJS microservices transport layer for RabbitMQ. Provides seamless integration between NestJS microservices patterns and RabbitMQ messaging.

## Features

Features
- ✅ Full NestJS Microservices Compatibility - Works with @MessagePattern and @EventPattern
- ✅ RabbitMQ Transport - Native RabbitMQ/AMQP integration
- ✅ Request-Response Messaging - Using send() and MessagePattern
- ✅ Event-Driven Messaging - Using emit() and EventPattern
- ✅ Multiple Exchange Types - Direct, Topic, Fanout, Headers
- ✅ TypeScript Support - Fully typed for better development experience
- ✅ Async Configuration - Support for ConfigService and environment variables
- ✅ Error Handling & Retries - Built-in retry logic and error handling
- ✅ Connection Management - Automatic connection lifecycle management
- ✅ Queue Options - Durable, exclusive, auto-delete queues

## Installation

```bash
npm install nestjs-rabbitmq-transport
```

## Peer Dependencies
- `@nestjs/common`
- `@nestjs/core`
- `@nestjs/microservices`
- `amqplib`

## Quick Start

1. Basic Setup

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from 'nestjs-rabbitmq-transport';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        urls: [config.get('RABBITMQ_URL')],
        queue: config.get('RABBITMQ_QUEUE', 'nestjs-app'),
        queueOptions: {
          durable: true,
        },
        prefetchCount: 10,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

2. Environment Configuration
``` .env
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_QUEUE=nestjs-app
```

3. Create Message Handlers

```typescript
// users.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, EventPattern } from '@nestjs/microservices';

@Controller()
export class UsersController {
  
  @MessagePattern('user.create')
  async createUser(data: any) {
    console.log('Creating user:', data);
    return { 
      id: Date.now().toString(), 
      ...data, 
      createdAt: new Date() 
    };
  }

  @MessagePattern('user.get')
  async getUser(data: { id: string }) {
    return { 
      id: data.id, 
      name: 'John Doe', 
      email: 'john@example.com' 
    };
  }

  @EventPattern('user.created')
  async handleUserCreated(data: any) {
    console.log('User created event received:', data);
    // Handle event (send email, update analytics, etc.)
  }
}
```

4. Send Messages from Services

```typescript
// orders.service.ts
import { Injectable } from '@nestjs/common';
import { RabbitMQService } from 'nestjs-rabbitmq-transport';

@Injectable()
export class OrdersService {
  constructor(private readonly rabbitMQ: RabbitMQService) {}

  async createOrder(orderData: any) {
    // Get user info (request-response)
    const user = await this.rabbitMQ.sendAsync('user.get', { 
      id: orderData.userId 
    });

    // Create order
    const order = { ...orderData, user };

    // Emit event (fire-and-forget)
    await this.rabbitMQ.emitAsync('order.created', order);

    return order;
  }

  // Using Observable pattern
  getUserObservable(id: string) {
    return this.rabbitMQ.send('user.get', { id });
  }
}
```

# Advanced Configuration

## Custom Exchange and Queue Options
```typescript
// app.module.ts
@Module({
  imports: [
    RabbitMQModule.forRoot({
      urls: ['amqp://localhost:5672'],
      queue: 'my-app',
      exchange: 'my-exchange',
      exchangeType: 'topic', // direct, topic, fanout, headers
      queueOptions: {
        durable: true,
        exclusive: false,
        autoDelete: false,
        arguments: {
          'x-message-ttl': 60000,
        },
      },
      prefetchCount: 5,
      persistent: true,
      retryOptions: {
        maxRetries: 3,
        delayInMs: 1000,
        timeoutInMs: 30000,
      },
    }),
  ],
})
```

## Multiple Connection URLs
```typescript
RabbitMQModule.forRoot({
  urls: [
    'amqp://user:pass@host1:5672',
    'amqp://user:pass@host2:5672',
    'amqp://user:pass@host3:5672',
  ],
  queue: 'my-app',
})
```

# API Reference

## RabbitMQService

### Methods
- send(pattern: string, data: any): Observable<any> - Send message and wait for response
- sendAsync(pattern: string, data: any): Promise<any> - Send message (Promise version)
- emit(pattern: string, data: any): Observable<any> - Emit event (fire-and-forget)
- emitAsync(pattern: string, data: any): Promise<void> - Emit event (Promise version)
- registerHandler(pattern: string, handler: (data: any) => Promise<any>) - Register custom handler
- isConnected(): boolean - Check connection status
- unwrap(): any - Get native RabbitMQ clients

## Configuration Options
```typescript
interface RabbitMQOptions {
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
```

## Error Handling
The library automatically handles:

- Connection failures with retries
- Message timeouts
- Serialization errors
- Network issues

## Monitoring
```typescript
// monitoring.service.ts
import { Injectable } from '@nestjs/common';
import { RabbitMQService } from 'nestjs-rabbitmq-transport';

@Injectable()
export class MonitoringService {
  constructor(private readonly rabbitMQ: RabbitMQService) {}

  getStatus() {
    const nativeClient = this.rabbitMQ.unwrap();
    
    return {
      isConnected: this.rabbitMQ.isConnected(),
      connection: nativeClient.connection ? 'Connected' : 'Disconnected',
      channel: nativeClient.channel ? 'Open' : 'Closed',
    };
  }
}
```

# Common Pattern

## Request-Response Pattern
```typescript
// Service A - Sends request
const user = await this.rabbitMQ.sendAsync('user.get', { id: '123' });

// Service B - Handles request
@MessagePattern('user.get')
async getUser(data: { id: string }) {
  return await this.usersService.findById(data.id);
}
```

## Event-Driven Pattern
```typescript
// Service A - Emits event
await this.rabbitMQ.emitAsync('order.created', order);

// Multiple services can handle the same event
@EventPattern('order.created')
async handleOrderCreated(data: any) {
  // Service B - Send confirmation email
}

@EventPattern('order.created')  
async updateInventory(data: any) {
  // Service C - Update inventory
}
```

# Troubleshooting
## Connection Issues
1. Check RabbitMQ server is running
2. Verify connection URL format: amqp://user:pass@host:port
3. Check credentials and permissions

## Message Not Delivered
1. Verify exchange and queue names
2. Check routing keys/patterns match
3. Ensure consumers are running

## License
MIT

## Support
For issues and questions, please open an issue on the GitHub repository.