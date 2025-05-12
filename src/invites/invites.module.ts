import { Module } from "@nestjs/common";
import { InvitesController } from "./invites.controller";
import { HasuraModule } from "src/hasura/hasura.module";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  imports: [HasuraModule],
  providers: [loggerFactory()],
  controllers: [InvitesController],
})
export class InvitesModule {}
