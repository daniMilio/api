import { WorkerHost } from "@nestjs/bullmq";
import { GameServerQueues } from "../enums/GameServerQueues";
import { Job } from "bullmq";
import { HasuraService } from "../../hasura/hasura.service";
import { UseQueue } from "../../utilities/QueueProcessors";
import { NotificationsService } from "../../notifications/notifications.service";

@UseQueue("GameServerNode", GameServerQueues.NodeOffline)
export class MarkGameServerOffline extends WorkerHost {
  constructor(
    protected readonly hasura: HasuraService,
    protected readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(
    job: Job<{
      serverId: string;
    }>,
  ): Promise<void> {
    await this.hasura.mutation({
      update_servers_by_pk: {
        __args: {
          pk_columns: {
            id: job.data.serverId,
          },
          _set: {
            connected: false,
          },
        },
        __typename: true,
      },
    });

    this.notifications.send("DedicatedServerStatus", {
      message: `Dedicated Server ${job.data.serverId} is Offline.`,
      title: "Dedicated Server Offline",
      role: "administrator",
      entity_id: job.data.serverId,
    });
  }
}
