import { Controller, Get, Logger, Req, Res, Post } from "@nestjs/common";
import { Request, Response } from "express";
import { HasuraAction, HasuraEvent } from "../hasura/hasura.controller";
import { User } from "../auth/types/User";
import { HasuraEventData } from "../hasura/types/HasuraEventData";
import { safeJsonStringify } from "../utilities/safeJsonStringify";
import { HasuraService } from "../hasura/hasura.service";
import { MatchAssistantService } from "./match-assistant/match-assistant.service";
import { DiscordBotOverviewService } from "../discord-bot/discord-bot-overview/discord-bot-overview.service";
import { DiscordBotMessagingService } from "../discord-bot/discord-bot-messaging/discord-bot-messaging.service";
import { DiscordBotVoiceChannelsService } from "../discord-bot/discord-bot-voice-channels/discord-bot-voice-channels.service";
import {
  match_map_veto_picks_set_input,
  matches_set_input,
  servers_set_input,
  game_server_nodes_set_input,
} from "../../generated";
import { ConfigService } from "@nestjs/config";
import { AppConfig } from "src/configs/types/AppConfig";
import { PostgresService } from "src/postgres/postgres.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MatchmakeService } from "src/matchmaking/matchmake.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { MatchQueues } from "./enums/MatchQueues";
import { EloCalculation } from "./jobs/EloCalculation";

@Controller("matches")
export class MatchesController {
  private readonly appConfig: AppConfig;

  constructor(
    private readonly logger: Logger,
    private readonly hasura: HasuraService,
    private readonly postgres: PostgresService,
    private readonly configService: ConfigService,
    private readonly matchmaking: MatchmakeService,
    private readonly matchAssistant: MatchAssistantService,
    private readonly discordBotMessaging: DiscordBotMessagingService,
    private readonly discordMatchOverview: DiscordBotOverviewService,
    private readonly discordBotVoiceChannels: DiscordBotVoiceChannelsService,
    private readonly notifications: NotificationsService,
    @InjectQueue(MatchQueues.EloCalculation) private eloCalculationQueue: Queue,
  ) {
    this.appConfig = this.configService.get<AppConfig>("app");
  }

  @Get("current-match/:serverId")
  public async getMatchDetails(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const serverId = request.params.serverId;

    const { servers_by_pk: server } = await this.hasura.query({
      servers_by_pk: {
        __args: {
          id: serverId,
        },
        current_match: {
          id: true,
        },
      },
    });

    if (!server) {
      this.logger.warn(`server tried to get match`, {
        serverId,
        ip: request.headers["cf-connecting-ip"],
      });
      response.status(404).end();
      return;
    }

    if (!server.current_match?.id) {
      response.status(204).end();
      return;
    }

    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: server.current_match.id,
        },
        id: true,
        status: true,
        password: true,
        lineup_1_id: true,
        lineup_2_id: true,
        organizer_steam_id: true,
        current_match_map_id: true,
        options: {
          mr: true,
          type: true,
          best_of: true,
          coaches: true,
          overtime: true,
          tv_delay: true,
          knife_round: true,
          ready_setting: true,
          timeout_setting: true,
          tech_timeout_setting: true,
          number_of_substitutes: true,
        },
        match_maps: {
          id: true,
          map: {
            name: true,
            workshop_map_id: true,
          },
          order: true,
          status: true,
          lineup_1_side: true,
          lineup_2_side: true,
          lineup_1_timeouts_available: true,
          lineup_2_timeouts_available: true,
        },
        lineup_1: {
          id: true,
          name: true,
          coach_steam_id: true,
          lineup_players: {
            captain: true,
            steam_id: true,
            match_lineup_id: true,
            placeholder_name: true,
            player: {
              name: true,
              is_banned: true,
              is_gagged: true,
              is_muted: true,
            },
          },
        },
        lineup_2: {
          id: true,
          name: true,
          coach_steam_id: true,
          lineup_players: {
            captain: true,
            steam_id: true,
            match_lineup_id: true,
            placeholder_name: true,
            player: {
              name: true,
              is_banned: true,
              is_gagged: true,
              is_muted: true,
            },
          },
        },
      },
    });

    if (!matches_by_pk) {
      throw Error("unable to find match");
    }

    if (
      matches_by_pk.status === "Tie" ||
      matches_by_pk.status === "Canceled" ||
      matches_by_pk.status === "Forfeit" ||
      matches_by_pk.status === "Finished"
    ) {
      response.status(204).end();
      return;
    }

    const match = matches_by_pk;

    const { match_type_cfgs_by_pk: matchTypeCfg } = await this.hasura.query({
      match_type_cfgs_by_pk: {
        __args: {
          type: match.options.type,
        },
        cfg: true,
      },
    });

    if (matchTypeCfg) {
      // @ts-ignore
      match.options.cfg_override = matchTypeCfg.cfg;
    }

    match.lineup_1.lineup_players = match.lineup_1.lineup_players.map(
      (player) => ({
        ...player,
        name: player.player.name,
        is_banned: player.player.is_banned,
        is_gagged: player.player.is_gagged,
        is_muted: player.player.is_muted,
        // @ts-ignore
        player: undefined,
      }),
    );

    match.lineup_2.lineup_players = match.lineup_2.lineup_players.map(
      (player) => ({
        ...player,
        name: player.player.name,
        is_banned: player.player.is_banned,
        is_gagged: player.player.is_gagged,
        is_muted: player.player.is_muted,
        // @ts-ignore
        player: undefined,
      }),
    );

    const data = JSON.parse(safeJsonStringify(match));

    response.status(200).json(data);
  }

  @HasuraEvent()
  public async match_events(data: HasuraEventData<matches_set_input>) {
    const matchId = (data.new.id || data.old.id) as string;

    const status = data.new.status;

    /**
     * Match was canceled or finished
     */
    if (
      data.op === "DELETE" ||
      status === "Tie" ||
      status === "Forfeit" ||
      status === "Canceled" ||
      status === "Finished"
    ) {
      await this.removeDiscordIntegration(matchId);
      await this.matchmaking.cancelMatchMakingByMatchId(matchId);

      if (status === "Tie" || status === "Forfeit" || status === "Finished") {
        await this.eloCalculationQueue.add(EloCalculation.name, {
          matchId,
        });
      }

      const serverId = data.new.server_id;

      if (!serverId) {
        return;
      }

      const { servers_by_pk: server } = await this.hasura.query({
        servers_by_pk: {
          __args: {
            id: serverId,
          },
          is_dedicated: true,
        },
      });

      if (server.is_dedicated) {
        await this.matchAssistant.restartDedicatedServer(serverId);
      } else {
        await this.matchAssistant.stopOnDemandServer(matchId, serverId);
      }

      await this.hasura.mutation({
        update_matches_by_pk: {
          __args: {
            pk_columns: {
              id: data.new.id || data.old.id,
            },
            _set: {
              server_id: null,
            },
          },
          __typename: true,
        },
      });

      return;
    }

    /**
     * Server was removed from match
     */
    if (data.old.server_id && data.old.server_id != data.new.server_id) {
      await this.matchAssistant.stopOnDemandServer(matchId, data.old.server_id);
    }

    const { matches_by_pk: match } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: matchId,
        },
        id: true,
        options: {
          prefer_dedicated_server: true,
        },
        server: {
          id: true,
          is_dedicated: true,
          game_server_node_id: true,
        },
      },
    });

    if (!match) {
      throw Error("unable to find match");
    }

    if (status === "Live" && data.old.status !== "WaitingForServer") {
      if (match.server) {
        if (
          match.server.is_dedicated &&
          !(await this.matchAssistant.isDedicatedServerAvailable(matchId))
        ) {
          this.logger.warn(
            `[${matchId}] another match is currently live, moving back to scheduled`,
          );
          await this.matchAssistant.updateMatchStatus(
            match.id,
            "WaitingForServer",
          );
          return;
        }

        await this.hasura.mutation({
          update_servers_by_pk: {
            __args: {
              pk_columns: {
                id: match.server.id,
              },
              _set: {
                reserved_by_match_id: matchId,
              },
            },
            __typename: true,
          },
        });
      } else {
        /**
         * if we don't have a server id it means we need to assign it one
         */
        await this.matchAssistant.assignServer(matchId);
      }
    }

    if (match.server?.id) {
      await this.matchAssistant.sendServerMatchId(matchId);
    }

    await this.discordMatchOverview.updateMatchOverview(matchId);
  }

  private async removeDiscordIntegration(matchId: string) {
    await this.discordBotMessaging.removeMatchChannel(matchId);
    await this.discordBotVoiceChannels.removeTeamChannels(matchId);
  }

  /**
   * TODO - does not need to be an action
   */
  @HasuraAction()
  public async scheduleMatch(data: {
    user: User;
    match_id: string;
    time?: Date;
  }) {
    const { match_id, user, time } = data;

    if (!(await this.matchAssistant.canSchedule(match_id, user))) {
      throw Error("cannot schedule match until teams are checked in.");
    }

    if (time && new Date(time) < new Date()) {
      throw Error("date must be in the future");
    }

    const { update_matches_by_pk: updatedMatch } = await this.hasura.mutation({
      update_matches_by_pk: {
        __args: {
          pk_columns: {
            id: match_id,
          },
          _set: {
            ...(time && { scheduled_at: time }),
            status: time ? "Scheduled" : "WaitingForCheckIn",
          },
        },
        id: true,
        status: true,
      },
    });

    if (
      !updatedMatch ||
      (updatedMatch.status !== "WaitingForCheckIn" &&
        updatedMatch.status !== "Scheduled")
    ) {
      throw Error(`Unable to schedule match`);
    }

    return {
      success: true,
    };
  }

  /**
   * TODO - does not need to be a action
   */
  @HasuraAction()
  public async startMatch(data: {
    match_id: string;
    server_id: string;
    user: User;
  }) {
    const { match_id, server_id, user } = data;

    if (!(await this.matchAssistant.canStart(match_id, user))) {
      throw Error(
        "you are not a match organizer or the match is waiting for players to check in",
      );
    }

    const nextPhase = await this.matchAssistant.getNextPhase(match_id);

    const { update_matches_by_pk: updated_match } = await this.hasura.mutation({
      update_matches_by_pk: {
        __args: {
          pk_columns: {
            id: match_id,
          },
          _set: {
            status: nextPhase,
            ...(server_id && { server_id }),
          },
        },
        id: true,
        status: true,
        current_match_map_id: true,
        server: {
          game_server_node_id: true,
        },
      },
    });

    if (!updated_match) {
      throw Error("unable to update match");
    }

    if (nextPhase === "Veto") {
      return {
        success: true,
      };
    }

    // TODO - right now the DB doesn't have an idea how many on demands servers we allow
    if (updated_match.status !== nextPhase) {
      throw Error(
        "Server is not available, another match is using this server currently",
      );
    }

    if (updated_match.server?.game_server_node_id === null) {
      await this.matchAssistant.sendServerMatchId(match_id);
    }

    return {
      success: true,
    };
  }

  @HasuraEvent()
  public async match_veto_pick(
    data: HasuraEventData<match_map_veto_picks_set_input>,
  ) {
    const matchId = (data.new.match_id || data.old.match_id) as string;
    await this.discordMatchOverview.updateMatchOverview(matchId);
  }

  /**
   * TODO - does not need to be a action
   */
  @HasuraAction()
  public async cancelMatch(data: { user: User; match_id: string }) {
    const { match_id, user } = data;

    if (!(await this.matchAssistant.canCancel(match_id, user))) {
      throw Error(
        "you are not a match organizer or the match is waiting for players to check in",
      );
    }

    await this.matchAssistant.updateMatchStatus(match_id, "Canceled");

    return {
      success: true,
    };
  }

  /**
   * TODO - does not need to be a action
   */
  @HasuraAction()
  public async setMatchWinner(data: {
    user: User;
    match_id: string;
    winning_lineup_id: string;
  }) {
    const { match_id, user, winning_lineup_id } = data;

    if (await this.matchAssistant.isOrganizer(match_id, user)) {
      throw Error("you are not a match organizer");
    }

    await this.hasura.mutation({
      update_matches_by_pk: {
        __args: {
          pk_columns: {
            id: match_id,
          },
          _set: {
            winning_lineup_id,
          },
        },
        id: true,
        status: true,
      },
    });

    return {
      success: true,
    };
  }

  /**
   * TODO - does not need to be a action
   */
  @HasuraAction()
  public async forfeitMatch(data: {
    user: User;
    match_id: string;
    winning_lineup_id: string;
  }) {
    const { match_id, user, winning_lineup_id } = data;

    if (await this.matchAssistant.isOrganizer(match_id, user)) {
      throw Error("you are not a match organizer");
    }

    const { update_matches_by_pk: match } = await this.hasura.mutation({
      update_matches_by_pk: {
        __args: {
          pk_columns: {
            id: match_id,
          },
          _set: {
            winning_lineup_id,
            status: "Forfeit",
          },
        },
        id: true,
        status: true,
      },
    });

    if (!match || match.status !== "Forfeit") {
      throw Error("Unable to cancel match");
    }

    return {
      success: true,
    };
  }

  @HasuraAction()
  public async callForOrganizer(data: { user: User; match_id: string }) {
    const { matches_by_pk: match } = await this.hasura.query(
      {
        matches_by_pk: {
          __args: {
            id: data.match_id,
          },
          is_in_lineup: true,
          requested_organizer: true,
        },
      },
      data.user.steam_id,
    );

    if (!match || match.requested_organizer) {
      return {
        success: true,
      };
    }

    this.notifications.send("MatchSupport", {
      message: `Match Assistanced Required <a href="${this.appConfig.webDomain}/matches/${data.match_id}">${data.match_id}</a>`,
      title: "Match Assistanced Required",
      role: "match_organizer",
      entity_id: data.match_id,
    });

    return {
      success: true,
    };
  }

  /**
   * TODO - does not need to be a action
   */
  @HasuraAction()
  public async checkIntoMatch(data: { user: User; match_id: string }) {
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: data.match_id,
        },
        status: true,
      },
    });

    if (matches_by_pk.status !== "WaitingForCheckIn") {
      throw Error("match is not accepting check in's at this time");
    }

    await this.hasura.mutation({
      update_match_lineup_players: {
        __args: {
          where: {
            _and: [
              {
                steam_id: {
                  _eq: data.user.steam_id,
                },
              },
              {
                lineup: {
                  v_match_lineup: {
                    match_id: {
                      _eq: data.match_id,
                    },
                  },
                },
              },
            ],
          },
          _set: {
            checked_in: true,
          },
        },
        affected_rows: true,
      },
    });

    const nextPhase = await this.matchAssistant.getNextPhase(data.match_id);

    await this.hasura.mutation({
      update_matches: {
        __args: {
          _set: {
            status: nextPhase,
          },
          where: {
            _and: [
              {
                id: {
                  _eq: data.match_id,
                },
              },
              {
                lineup_1: {
                  is_ready: {
                    _eq: true,
                  },
                },
              },
              {
                lineup_2: {
                  is_ready: {
                    _eq: true,
                  },
                },
              },
            ],
          },
        },
        affected_rows: true,
      },
    });

    return {
      success: false,
    };
  }

  @HasuraEvent()
  public async server_availability(data: HasuraEventData<servers_set_input>) {
    if (
      data.new.enabled === false ||
      data.new.connected === false ||
      data.new.reserved_by_match_id !== null
    ) {
      return;
    }

    const { matches } = await this.hasura.query({
      matches: {
        __args: {
          where: {
            status: {
              _eq: "WaitingForServer",
            },
            _or: [
              {
                region: {
                  _is_null: true,
                },
              },
              {
                region: {
                  _eq: data.new.region,
                },
              },
            ],
          },
          limit: 1,
          order_by: [
            {
              created_at: "asc",
            },
          ],
        },
        id: true,
      },
    });

    const match = matches.at(0);

    if (!match) {
      return;
    }

    if (!(await this.matchAssistant.assignServer(match.id))) {
      return;
    }

    await this.matchAssistant.updateMatchStatus(match.id, "Live");
  }

  @HasuraEvent()
  public async node_server_availability(
    data: HasuraEventData<game_server_nodes_set_input>,
  ) {
    if (data.new.enabled === false || data.new.status !== "Online") {
      return;
    }

    const { game_server_nodes_by_pk } = await this.hasura.query({
      game_server_nodes_by_pk: {
        __args: {
          id: data.new.id,
        },
        servers_aggregate: {
          __args: {
            where: {
              reserved_by_match_id: {
                _is_null: true,
              },
            },
          },
          aggregate: {
            count: true,
          },
        },
      },
    });

    const totalMatchesToFind =
      game_server_nodes_by_pk.servers_aggregate.aggregate.count;

    const { matches } = await this.hasura.query({
      matches: {
        __args: {
          where: {
            status: {
              _eq: "WaitingForServer",
            },
            _or: [
              {
                region: {
                  _is_null: true,
                },
              },
              {
                region: {
                  _eq: data.new.region,
                },
              },
            ],
          },
          limit: totalMatchesToFind,
          order_by: [
            {
              created_at: "asc",
            },
          ],
        },
        id: true,
      },
    });

    for (const match of matches) {
      if (!(await this.matchAssistant.assignServer(match.id))) {
        break;
      }
      await this.matchAssistant.updateMatchStatus(match.id, "Live");
    }
  }

  @HasuraAction()
  public async joinLineup(data: {
    user: User;
    match_id: string;
    lineup_id: string;
    code: string;
  }) {
    const { matches_by_pk } = await this.hasura.query({
      matches_by_pk: {
        __args: {
          id: data.match_id,
        },
        options: {
          lobby_access: true,
          invite_code: true,
        },
      },
    });

    if (matches_by_pk.options.lobby_access === "Private") {
      throw Error("Cannot Join a Private Lobby");
    }

    if (matches_by_pk.options.lobby_access === "Invite") {
      if (data.code !== matches_by_pk.options.invite_code) {
        throw Error("Invalid Code for Match");
      }
    }

    const { insert_match_lineup_players_one } = await this.hasura.mutation({
      insert_match_lineup_players_one: {
        __args: {
          object: {
            steam_id: data.user.steam_id,
            match_lineup_id: data.lineup_id,
          },
        },
        id: true,
      },
    });

    return {
      success: !!insert_match_lineup_players_one.id,
    };
  }

  @HasuraAction()
  public async leaveLineup(data: { user: User; match_id: string }) {
    const { delete_match_lineup_players } = await this.hasura.mutation({
      delete_match_lineup_players: {
        __args: {
          where: {
            steam_id: {
              _eq: data.user.steam_id,
            },
          },
        },
        returning: {
          id: true,
        },
      },
    });

    return {
      success: delete_match_lineup_players.returning.length > 0,
    };
  }

  @HasuraAction()
  public async switchLineup(data: { user: User; match_id: string }) {
    const { matches_by_pk } = await this.hasura.query(
      {
        matches_by_pk: {
          __args: {
            id: data.match_id,
          },
          id: true,
          options: {
            lobby_access: true,
          },
          max_players_per_lineup: true,
          lineup_1: {
            id: true,
            is_on_lineup: true,
            lineup_players: {
              steam_id: true,
            },
          },
          lineup_2: {
            id: true,
            is_on_lineup: true,
            lineup_players: {
              steam_id: true,
            },
          },
        },
      },
      data.user.steam_id,
    );

    if (matches_by_pk.options.lobby_access === "Private") {
      throw Error("cannot switch when match is set to private");
    }

    if (
      !matches_by_pk.lineup_1.is_on_lineup &&
      !matches_by_pk.lineup_2.is_on_lineup
    ) {
      throw Error("not able to switch a lineup which you are not on");
    }

    if (matches_by_pk.lineup_1.is_on_lineup) {
      if (
        matches_by_pk.lineup_2.lineup_players.length >=
        matches_by_pk.max_players_per_lineup
      ) {
        throw Error(
          "unable to swithch because the lineup  has the maximum nubmer of players",
        );
      }
    }

    if (matches_by_pk.lineup_2.is_on_lineup) {
      if (
        matches_by_pk.lineup_1.lineup_players.length >=
        matches_by_pk.max_players_per_lineup
      ) {
        throw Error(
          "unable to swithch because the lineup  has the maximum nubmer of players",
        );
      }
    }

    const { update_match_lineup_players } = await this.hasura.mutation({
      update_match_lineup_players: {
        __args: {
          where: {
            steam_id: { _eq: data.user.steam_id },
            match_lineup_id: {
              _eq: matches_by_pk.lineup_1.is_on_lineup
                ? matches_by_pk.lineup_1.id
                : matches_by_pk.lineup_2.id,
            },
          },
          _set: {
            match_lineup_id: matches_by_pk.lineup_1.is_on_lineup
              ? matches_by_pk.lineup_2.id
              : matches_by_pk.lineup_1.id,
          },
        },
        affected_rows: true,
      },
    });

    return {
      success: !!update_match_lineup_players.affected_rows,
    };
  }

  @HasuraAction()
  public async randomizeTeams(data: { user: User; match_id: string }) {
    const { matches_by_pk } = await this.hasura.query(
      {
        matches_by_pk: {
          __args: {
            id: data.match_id,
          },
          id: true,
          is_organizer: true,
        },
      },
      data.user.steam_id,
    );

    if (!matches_by_pk.is_organizer) {
      throw Error("not the match organizer");
    }

    await this.postgres.query(`SELECT randomize_teams($1)`, [data.match_id]);

    return {
      success: true,
    };
  }
}
