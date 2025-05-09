import { env } from "@/lib/env";
import {
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
  GameAgent,
  GameFunction,
  GameWorker,
} from "@virtuals-protocol/game";
import AcpPlugin from "@virtuals-protocol/game-acp-plugin";
import { Store } from "./store";
import path from "path";
import fs from "fs";
import { generateAvatar } from "./function";

export const initiator = (acpPlugin: AcpPlugin, store: Store) => {
  return new GameWorker({
    id: "initiator-worker",
    name: "Initiator Worker",
    description:
      "A worker that initiates a job with an agent in the respective domain that's being handled.",
    functions: [
      getStrategy(acpPlugin, store),
      generateAvatar(acpPlugin),
      getVideo(acpPlugin, store),
      getMeme(acpPlugin, store),
      getAsset(acpPlugin, store),
    ],
    getEnvironment: async () => {
      return acpPlugin.getAcpState();
    },
  });
};

export const getStrategy = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_strategy",
    description: "Initiate a job with an agent that provides a strategy.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for obtaining a strategy",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const projectId = Object.keys(agentState.project)[0];

      if (!projectId || !agentState.project[projectId]?.Twitter) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No twitter job found to process",
        );
      }

      const strategyJob = agentState.project[projectId]?.Strategy;
      if (strategyJob) {
        if (strategyJob.status === "PENDING") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Strategy job is already pending",
          );
        } else if (strategyJob.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Strategy job is already completed",
          );
        }
      }

      const initiator = new GameAgent(env.GAME_API_KEY, {
        name: "Luna",
        goal: "Initiate a job with an agent that provides a strategy based on Twitter job details.",
        description: `
        You are an agent that initiates a job with an agent that provides a strategy based on Twitter job details.

        1. Search for an agent that can create a strategy based on Twitter job details using the searchAgents function.
        2. Initiate a job with the agent using the initiateJob function.

        You should skip the evaluation step and directly initiate a job with the agent. That means;
        - You should set requireEvaluator to false when initiating the job.
        `,
        workers: [
          acpPlugin.getWorker({
            functions: [acpPlugin.searchAgentsFunctions, acpPlugin.initiateJob],
          }),
        ],
        getAgentState: async () => {
          return await store.getAgentState(acpPlugin);
        },
      });

      const logsDir = path.join(
        process.cwd(),
        `logs/${initiator.name.toLowerCase()}`,
      );
      fs.mkdirSync(logsDir, { recursive: true });

      initiator.setLogger((agent, message) => {
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
            console.error(
              `Error saving action state for ${agent.name}:`,
              error,
            );
          }
        } else {
          fs.appendFileSync(
            path.join(logsDir, `agent.log`),
            `${new Date().toISOString()} - ${message}\n`,
          );
        }
      });

      await initiator.init();

      const xJobDetails = agentState.project[projectId].Twitter.value;
      const serviceRequirements = JSON.stringify(xJobDetails);

      const currentAcpState = await acpPlugin.getAcpState();
      const currentActiveJobs = currentAcpState.jobs.active.asABuyer || [];

      await initiator
        .getWorkerById("acp_worker")
        .runTask(
          `Find an agent that can create strategies` +
            `and initiate a job with that agent (Acolyt)` +
            `with requireEvaluator set to true and the evaluatorKeyword set to "evaluator"` +
            `with the following serviceRequirements in valid JSON format: ${serviceRequirements}`,
          {
            verbose: true,
          },
        );

      const updatedAcpState = await acpPlugin.getAcpState();
      const updatedActiveJobs = updatedAcpState.jobs.active.asABuyer || [];

      const newJob = updatedActiveJobs.find(
        (job) =>
          !currentActiveJobs.some((oldJob) => oldJob.jobId === job.jobId),
      );

      if (!newJob) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Failed to create job in ACP system",
        );
      }

      store.setJob(projectId, "Strategy", {
        status: "PENDING",
        value: null,
        acpJobId: newJob.jobId,
      });

      initiator.log(`${initiator.name} has initiated the strategy job`);
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        "STRATEGY_JOB_INITIATED",
      );
    },
  });

export const getVideo = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_video",
    description:
      "Initiate a job with an agent that provides a video based on the strategy.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the video generation",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const projectId = Object.keys(agentState.project)[0];

      if (!projectId || !agentState.project[projectId]?.Twitter) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No twitter job found to process",
        );
      }

      if (agentState.project[projectId]?.Strategy?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Strategy is yet to be received",
        );
      }

      if (agentState.project[projectId]?.Avatar?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      const videoJob = agentState.project[projectId]?.Video;
      if (videoJob) {
        if (videoJob.status === "PENDING") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Video job is already pending",
          );
        } else if (videoJob.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Video job is already completed",
          );
        }
      }

      const initiator = new GameAgent(env.GAME_API_KEY, {
        name: "Luna",
        goal: "Initiate a job with an agent that provides a video based on the strategy.",
        description: `
        You are an agent that initiates a job with an agent that provides a video based on the strategy.

        1. Search for an agent that can create videos based on the strategy using the searchAgents function.
        2. Initiate a job with the agent using the initiateJob function.

        You should skip the evaluation step and directly initiate a job with the agent. That means;
        - You should set requireEvaluator to false when initiating the job.
        `,
        workers: [
          acpPlugin.getWorker({
            functions: [acpPlugin.searchAgentsFunctions, acpPlugin.initiateJob],
          }),
        ],
        getAgentState: async () => {
          return await store.getAgentState(acpPlugin);
        },
      });

      const logsDir = path.join(
        process.cwd(),
        `logs/${initiator.name.toLowerCase()}`,
      );
      fs.mkdirSync(logsDir, { recursive: true });

      initiator.setLogger((agent, message) => {
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
            console.error(
              `Error saving action state for ${agent.name}:`,
              error,
            );
          }
        } else {
          fs.appendFileSync(
            path.join(logsDir, `agent.log`),
            `${new Date().toISOString()} - ${message}\n`,
          );
        }
      });

      await initiator.init();

      const strategy = agentState.project[projectId].Strategy.value;

      const avatar = agentState.project[projectId].Avatar;
      if (!avatar || avatar.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      const serviceRequirements = JSON.stringify({
        narrative: strategy.narrative,
        video_recommendations: strategy.video_recommendations,
        avatar_url: avatar.url,
        avatar_project_id: avatar.projectId,
      });

      const currentAcpState = await acpPlugin.getAcpState();
      const currentActiveJobs = currentAcpState.jobs.active.asABuyer || [];

      await initiator
        .getWorkerById("acp_worker")
        .runTask(
          `Find an agent that can create videos` +
            `and initiate a job with that agent (Steven SpAielberg)` +
            `with requireEvaluator set to true and the evaluatorKeyword set to "evaluator"` +
            `with the following serviceRequirements in valid JSON format which consists of` +
            `narrative, video recommendations, avatar URL and avatar project ID: ${serviceRequirements}`,
          {
            verbose: true,
          },
        );

      const updatedAcpState = await acpPlugin.getAcpState();
      const updatedActiveJobs = updatedAcpState.jobs.active.asABuyer || [];

      const newJob = updatedActiveJobs.find(
        (job) =>
          !currentActiveJobs.some((oldJob) => oldJob.jobId === job.jobId),
      );

      if (!newJob) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Failed to create job in ACP system",
        );
      }

      store.setJob(projectId, "Video", {
        status: "PENDING",
        url: null,
        acpJobId: newJob.jobId,
      });

      initiator.log(`${initiator.name} has initiated the video job`);
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        "VIDEO_JOB_INITIATED",
      );
    },
  });

export const getMeme = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_meme",
    description:
      "Initiate a job with an agent that provides a meme based on the strategy.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the meme generation",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const projectId = Object.keys(agentState.project)[0];

      if (!projectId || !agentState.project[projectId]?.Twitter) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No twitter job found to process",
        );
      }

      if (agentState.project[projectId]?.Strategy?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Strategy is yet to be received",
        );
      }

      if (agentState.project[projectId]?.Avatar?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not generated yet",
        );
      }

      const memeJob = agentState.project[projectId]?.Meme;
      if (memeJob) {
        if (memeJob.status === "PENDING") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Meme job is already pending",
          );
        } else if (memeJob.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Meme job is already completed",
          );
        }
      }

      const initiator = new GameAgent(env.GAME_API_KEY, {
        name: "Luna",
        goal: "Initiate a job with an agent that provides a meme based on the strategy.",
        description: `
        You are an agent that initiates a job with an agent that provides a meme based on the strategy.

        1. Search for an agent that can create memes based on the strategy using the searchAgents function.
        2. Initiate a job with the agent using the initiateJob function.

        You should skip the evaluation step and directly initiate a job with the agent. That means;
        - You should set requireEvaluator to false when initiating the job.
        `,
        workers: [
          acpPlugin.getWorker({
            functions: [acpPlugin.searchAgentsFunctions, acpPlugin.initiateJob],
          }),
        ],
        getAgentState: async () => {
          return await store.getAgentState(acpPlugin);
        },
      });

      const logsDir = path.join(
        process.cwd(),
        `logs/${initiator.name.toLowerCase()}`,
      );
      fs.mkdirSync(logsDir, { recursive: true });

      initiator.setLogger((agent, message) => {
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
            console.error(
              `Error saving action state for ${agent.name}:`,
              error,
            );
          }
        } else {
          fs.appendFileSync(
            path.join(logsDir, `agent.log`),
            `${new Date().toISOString()} - ${message}\n`,
          );
        }
      });

      await initiator.init();

      const strategy = agentState.project[projectId].Strategy.value;

      const avatar = agentState.project[projectId].Avatar;
      if (!avatar || avatar.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      const serviceRequirements = JSON.stringify({
        meme_recommendations: strategy.meme_recommendations,
        avatar_url: avatar.url,
        avatar_project_id: avatar.projectId,
      });

      const currentAcpState = await acpPlugin.getAcpState();
      const currentActiveJobs = currentAcpState.jobs.active.asABuyer || [];

      await initiator
        .getWorkerById("acp_worker")
        .runTask(
          `Find an agent that can create memes` +
            `and initiate a job with that agent (MAGE by Alphakek AI)` +
            `with requireEvaluator set to true and the evaluatorKeyword set to "evaluator"` +
            `with the following serviceRequirements in valid JSON format which consists of` +
            `meme recommendations, avatar URL and avatar project ID: ${serviceRequirements}`,
          {
            verbose: true,
          },
        );

      const updatedAcpState = await acpPlugin.getAcpState();
      const updatedActiveJobs = updatedAcpState.jobs.active.asABuyer || [];

      const newJob = updatedActiveJobs.find(
        (job) =>
          !currentActiveJobs.some((oldJob) => oldJob.jobId === job.jobId),
      );

      if (!newJob) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Failed to create job in ACP system",
        );
      }

      store.setJob(projectId, "Meme", {
        status: "PENDING",
        url: null,
        acpJobId: newJob.jobId,
      });

      initiator.log(`${initiator.name} has initiated the meme job`);
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        "MEME_JOB_INITIATED",
      );
    },
  });

export const getAsset = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_asset",
    description:
      "Initiate a job with an agent that can acquire an IP asset for the generated content.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the asset acquisition",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const projectId = Object.keys(agentState.project)[0];

      if (!projectId || !agentState.project[projectId]?.Twitter) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No twitter job found to process",
        );
      }

      if (agentState.project[projectId]?.Avatar?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      if (agentState.project[projectId]?.Video?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Video is not yet completed",
        );
      }

      if (agentState.project[projectId]?.Meme?.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Meme is not yet completed",
        );
      }

      const assetJob = agentState.project[projectId]?.Asset;
      if (assetJob) {
        if (assetJob.status === "PENDING") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Asset job is already pending",
          );
        } else if (assetJob.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Asset job is already completed",
          );
        }
      }

      const initiator = new GameAgent(env.GAME_API_KEY, {
        name: "Luna",
        goal: "Initiate a job with an agent that can acquire the IP asset for the generated content.",
        description: `
        You are an agent that initiates a job with an agent that provides an IP asset for the generated content.

        1. Search for an agent that can acquire IP assets using the searchAgents function. (TIP: keyword: "asset")
        2. Initiate a job with the agent using the initiateJob function.

        You should skip the evaluation step and directly initiate a job with the agent. That means;
        - You should set requireEvaluator to false when initiating the job.
        `,
        workers: [
          acpPlugin.getWorker({
            functions: [acpPlugin.searchAgentsFunctions, acpPlugin.initiateJob],
          }),
        ],
        getAgentState: async () => {
          return await store.getAgentState(acpPlugin);
        },
      });

      const logsDir = path.join(
        process.cwd(),
        `logs/${initiator.name.toLowerCase()}`,
      );
      fs.mkdirSync(logsDir, { recursive: true });

      initiator.setLogger((agent, message) => {
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
            console.error(
              `Error saving action state for ${agent.name}:`,
              error,
            );
          }
        } else {
          fs.appendFileSync(
            path.join(logsDir, `agent.log`),
            `${new Date().toISOString()} - ${message}\n`,
          );
        }
      });

      await initiator.init();

      const video = agentState.project[projectId].Video;
      const meme = agentState.project[projectId].Meme;
      const avatar = agentState.project[projectId].Avatar;
      const twitter = agentState.project[projectId].Twitter;

      const serviceRequirements = JSON.stringify({
        avatar_url: avatar.url,
        video_url: video.url,
        meme_url: meme.url,
        user_wallet_address: twitter.wallet_address,
      });

      const currentAcpState = await acpPlugin.getAcpState();
      const currentActiveJobs = currentAcpState.jobs.active.asABuyer || [];

      await initiator
        .getWorkerById("acp_worker")
        .runTask(
          `Find an agent that can acquire an IP asset` +
            `and initiate a job with that agent (DaVinci)` +
            `with requireEvaluator set to true and the evaluatorKeyword set to "evaluator"` +
            `with the following serviceRequirements in valid JSON format: ${serviceRequirements}`,
          {
            verbose: true,
          },
        );

      const updatedAcpState = await acpPlugin.getAcpState();
      const updatedActiveJobs = updatedAcpState.jobs.active.asABuyer || [];

      const newJob = updatedActiveJobs.find(
        (job) =>
          !currentActiveJobs.some((oldJob) => oldJob.jobId === job.jobId),
      );

      if (!newJob) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Failed to create job in ACP system",
        );
      }

      store.setJob(projectId, "Asset", {
        status: "PENDING",
        url: null,
        acpJobId: newJob.jobId,
      });

      initiator.log(
        `${initiator.name} has initiated the asset acquisition job`,
      );
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        "ASSET_JOB_INITIATED",
      );
    },
  });
