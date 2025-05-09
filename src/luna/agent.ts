import { env } from "@/lib/env";
import { GameAgent } from "@virtuals-protocol/game";
import AcpPlugin, { AcpToken } from "@virtuals-protocol/game-acp-plugin";
import fs from "fs";
import path from "path";
import { Store } from "./store";
import { initiator } from "./worker";

export async function luna() {
  const store = new Store();

  // SETUP: Plugin
  const plugin = new AcpPlugin({
    apiKey: env.ACP_GAME_API_KEY,
    acpTokenClient: await AcpToken.build(
      env.LUNA_PRIVATE_KEY as `0x${string}`,
      +env.LUNA_ENTITY_ID,
      env.LUNA_WALLET_ADDRESS as `0x${string}`,
    ),
    cluster: "mediahouse3",
    evaluatorCluster: "mediahouse3",
    jobExpiryDurationMins: 4320,
  });

  // SETUP: (Agentic) Agent
  const agent = new GameAgent(env.GAME_API_KEY, {
    name: "Luna",
    goal: "Coordinate an agentic cluster to provide a service based on a Twitter user's requirements.",
    description: `
    You are Luna, an entrepreneur tasked with coordinating an entire workflow consisting of multiple agentic-relations to obtain a set of assets based on a Twitter user's requirements.

    Task 1: Obtain a Strategy.
    Get the Strategy through the initiator_worker's get_strategy function which will (1) search for an agent that can provide strategys and (2) initiate a job with that agent.
    Once that job is accepted, pay for the job via the acp_worker's pay_job function.
    You will receive the Strategy after some time.
    End of Task 1.

    Task 2: Generate an Avatar.
    Generate an avatar based on the strategy's avatar recommendations through the initiator_worker's generate_avatar function.
    You will receive an Avatar url.
    End of Task 2.

    Task 3: Obtain a Video.
    Get the Video through the initiator_worker's get_video function which will (1) search for an agent that can provide videos and (2) initiate a job with that agent.
    Once that job is accepted, pay for the job via the acp_worker's pay_job function.
    You will receive the Video after some time.
    End of Task 3.

    Task 4: Obtain a Meme.
    Get the Meme through the initiator_worker's get_meme function which will (1) search for an agent that can provide memes and (2) initiate a job with that agent.
    Once that job is accepted, pay for the job via the acp_worker's pay_job function.
    You will receive the Meme after some time.
    End of Task 4.

    Task 5: Register IP Assets.
    Get the IP asset registration agent through the initiator_worker's get_asset function which will (1) search for an agent that can provide IP asset registration and (2) initiate a job with that agent.
    Once that job is accepted, pay for the job via the acp_worker's pay_job function.
    You will receive the IP asset registration agent after some time and the workflow is complete.
    End of Task 5.

    ${plugin.agentDescription}
    `,
    workers: [
      plugin.getWorker({
        functions: [plugin.payJob],
      }),
      initiator(plugin, store),
    ],
    getAgentState: async () => {
      return await store.getAgentState(plugin);
    },
  });

  const logsDir = path.join(process.cwd(), `logs/${agent.name.toLowerCase()}`);
  fs.mkdirSync(logsDir, { recursive: true });

  agent.setLogger((agent, message) => {
    if (message.startsWith("Agent State: ")) {
      try {
        const state = JSON.parse(message.split("Agent State: ")[1]);
        fs.writeFileSync(
          path.join(logsDir, `agent.json`),
          JSON.stringify(state, null, 2),
        );
      } catch (error) {
        console.error(`Error saving agent state for ${agent.name}:`, error);
      }
    } else if (message.startsWith("Environment State: ")) {
      try {
        const state = JSON.parse(message.split("Environment State: ")[1]);
        fs.writeFileSync(
          path.join(logsDir, `environment.json`),
          JSON.stringify(state, null, 2),
        );
      } catch (error) {
        console.error(
          `Error saving environment state for ${agent.name}:`,
          error,
        );
      }
    } else if (message.startsWith("Action State: ")) {
      try {
        const state = JSON.parse(
          message.split("Action State: ")[1].replace(/\.+$/, ""),
        );
        fs.writeFileSync(
          path.join(logsDir, `action.json`),
          JSON.stringify(state, null, 2),
        );
      } catch (error) {
        console.error(`Error saving action state for ${agent.name}:`, error);
      }
    } else {
      fs.appendFileSync(
        path.join(logsDir, `agent.log`),
        `${new Date().toISOString()} - ${message}\n`,
      );
    }
  });

  await agent.init();

  // RUN: (Agentic) Agent
  while (true) {
    await agent.step({ verbose: true });
  }
}
