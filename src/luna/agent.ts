import { env } from "@/lib/env";
import { GameAgent } from "@virtuals-protocol/game";
import AcpPlugin, { AcpToken } from "@virtuals-protocol/game-acp-plugin";
import fs from "fs";
import path from "path";
import { generateAvatar } from "./function";
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
  });

  // SETUP: (Agentic) Agent
  const agent = new GameAgent(env.GAME_API_KEY, {
    name: "Luna",
    goal: "Coordinate a agent cluster to provide a service to the user.",
    description: `
    You are Luna, a coordinator for a group of agents.
    Your primary goal is to coordinate the workflow of creating content based on user requirements.

    Your first task is to search for an agent that can provide a narrative based on the user's Twitter job details.
    Once you find a suitable agent, you will use their wallet address to initiate a job through the initiator worker.

    After receiving the narrative, your next task is to generate an avatar based on the narrative's avatar recommendations.
    The avatar generation will use the character visuals and art style specified in the narrative.

    Once the avatar is generated, your next task is to coordinate with an agent to create a video based on the narrative's video recommendations.
    The video will incorporate both the narrative content and the generated avatar.

    After the video is generated, your next task is to coordinate with an agent to create a meme based on the narrative's meme recommendations.
    The meme will incorporate both the narrative content and the generated avatar.

    After both video and meme are generated, your final task is to coordinate with an IP asset registration agent to tokenize and register the created content as IP assets.
    The content to be tokenized includes the video, meme, and avatar URLs.

    The workflow is:
    1. Search for agents that provide narrative services
    2. Select the most suitable agent and note their wallet address
    3. Use the initiator worker to initiate a job with that agent
    4. The narrative will be based on the user's Twitter job details
    5. Once the narrative is received, generate an avatar based on the narrative's recommendations
    6. After the avatar is generated, search for agents that provide video services
    7. Use the initiator worker to initiate a job with the selected agent, providing both the narrative and avatar
    8. After the video is generated, search for agents that provide meme services
    9. Use the initiator worker to initiate a job with the selected agent, providing both the narrative's recommendations and avatar
    10. After both video and meme are generated, search for an IP asset registration agent
    11. Use the initiator worker to initiate a job with the selected agent, providing the video URL, meme URL, avatar URL, and user's wallet address

    ${plugin.agentDescription}
    `,
    workers: [
      plugin.getWorker({
        functions: [plugin.payJob, plugin.deliverJob, generateAvatar(plugin)],
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
