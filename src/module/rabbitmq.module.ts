import { DynamicModule, Module, Global, Provider } from '@nestjs/common';
import { RabbitMQService } from '../services/rabbitmq.service';
import { RabbitMQOptions } from '../interfaces/rabbitmq-options.interface';
import { RABBITMQ_CLIENT, RABBITMQ_OPTIONS } from '../constants/rabbitmq.constants';

@Global()
@Module({})
export class RabbitMQModule {
  static forRoot(options: RabbitMQOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: RABBITMQ_OPTIONS,
        useValue: options,
      },
      {
        provide: RABBITMQ_CLIENT,
        useFactory: (options: RabbitMQOptions) => {
          return new RabbitMQService(options);
        },
        inject: [RABBITMQ_OPTIONS],
      },
      RabbitMQService,
    ];

    return {
      module: RabbitMQModule,
      providers,
      exports: [RabbitMQService, RABBITMQ_CLIENT],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<RabbitMQOptions> | RabbitMQOptions;
    inject?: any[];
  }): DynamicModule {
    const providers: Provider[] = [
      {
        provide: RABBITMQ_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
      {
        provide: RABBITMQ_CLIENT,
        useFactory: (options: RabbitMQOptions) => {
          return new RabbitMQService(options);
        },
        inject: [RABBITMQ_OPTIONS],
      },
      RabbitMQService,
    ];

    return {
      module: RabbitMQModule,
      providers,
      exports: [RabbitMQService, RABBITMQ_CLIENT],
    };
  }
}