import { Job } from "bullmq";
import { WorkerHost } from "@nestjs/bullmq";
import { MatchmakingQueues } from "../enums/MatchmakingQueues";
import { UseQueue } from "../../utilities/QueueProcessors";
import { MatchmakingLobbyService } from "../matchmaking-lobby.service";
import { HasuraService } from "../../hasura/hasura.service";

@UseQueue("Matchmaking", MatchmakingQueues.Matchmaking)
export class MarkPlayerOffline extends WorkerHost {
  constructor(
    private readonly hasura: HasuraService,
    private readonly matchmakingLobbyService: MatchmakingLobbyService,
  ) {
    super();
  }

  async process(
    job: Job<{
      steamId: string;
    }>,
  ): Promise<void> {
    const { steamId } = job.data;

    await this.hasura.mutation({
      delete_lobby_players: {
        __args: {
          where: {
            steam_id: {
              _eq: steamId,
            },
            status: {
              _eq: "Accepted",
            },
          },
        },
        __typename: true,
      },
    });

    const lobby = await this.matchmakingLobbyService.getPlayerLobby(steamId);

    if (!lobby) {
      return;
    }

    await this.matchmakingLobbyService.removeLobbyFromQueue(lobby.id);
    await this.matchmakingLobbyService.removeLobbyDetails(lobby.id);
  }
}
