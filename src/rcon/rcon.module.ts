import { Module } from "@nestjs/common";
import { RconService } from "./rcon.service";
import { RconGateway } from "./rcon.gateway";
import { HasuraModule } from "../hasura/hasura.module";
import { loggerFactory } from "../utilities/LoggerFactory";
import { EncryptionModule } from "../encryption/encryption.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [HasuraModule, EncryptionModule, NotificationsModule],
  exports: [RconService],
  providers: [RconGateway, RconService, loggerFactory()],
})
export class RconModule {}
