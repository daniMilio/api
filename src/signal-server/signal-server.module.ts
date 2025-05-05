import { Module } from "@nestjs/common";
import { HasuraModule } from "src/hasura/hasura.module";
import { SignalServerGateway } from "./signal-server.gateway";
import { RedisModule } from "src/redis/redis.module";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  imports: [HasuraModule, RedisModule],
  providers: [SignalServerGateway, loggerFactory()],
})
export class SignalServerModule {}
