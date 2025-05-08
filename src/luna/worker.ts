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
      getNarrative(acpPlugin, store),
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

export const getNarrative = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_narrative",
    description: "Initiate a job with an agent that provides a narrative.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the narrative generation",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const twitterJobId = Object.keys(agentState.twitter)[0];

      if (!twitterJobId || !agentState.twitter[twitterJobId]?.User) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No user job found to process",
        );
      }

      const narrativeJob = agentState.twitter[twitterJobId]?.Narrative;
      if (narrativeJob) {
        if (narrativeJob.status === "PENDING") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Narrative job is already pending",
          );
        } else if (narrativeJob.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Narrative job is already completed",
          );
        }
      }

      const initiator = new GameAgent(env.GAME_API_KEY, {
        name: "Luna",
        goal: "Initiate a job with an agent that provides a narrative based on Twitter job details.",
        description: `
        You are an agent that initiates a job with an agent that provides a narrative based on Twitter job details.

        1. Search for an agent that can create narratives based on Twitter job details using the searchAgents function.
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

      const twitterJobDetails =
        agentState.twitter[twitterJobId].User.job_details;
      const serviceRequirements = JSON.stringify(twitterJobDetails);

      const currentAcpState = await acpPlugin.getAcpState();
      const currentActiveJobs = currentAcpState.jobs.active.asABuyer || [];

      await initiator
        .getWorkerById("acp_worker")
        .runTask(
          `Find an agent that can create narratives` +
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

      store.setJob(twitterJobId, "Narrative", {
        status: "PENDING",
        narrative: null,
        acpJobId: newJob.jobId,
      });

      initiator.log(`${initiator.name} has initiated the narrative job`);
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        "NARRATIVE_JOB_INITIATED",
      );
    },
  });

export const getVideo = (acpPlugin: AcpPlugin, store: Store) =>
  new GameFunction({
    name: "get_video",
    description:
      "Initiate a job with an agent that provides a video based on the narrative.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the video generation",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const twitterJobId = Object.keys(agentState.twitter)[0];

      if (!twitterJobId || !agentState.twitter[twitterJobId]?.User) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No user job found to process",
        );
      }

      if (
        agentState.twitter[twitterJobId]?.Avatar?.status !== "COMPLETED" ||
        agentState.twitter[twitterJobId]?.Narrative?.status !== "COMPLETED"
      ) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar or narrative are not yet completed",
        );
      }

      const videoJob = agentState.twitter[twitterJobId]?.Video;
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
        goal: "Initiate a job with an agent that provides a video based on the narrative.",
        description: `
        You are an agent that initiates a job with an agent that provides a video based on the narrative.

        1. Search for an agent that can create videos based on the narrative using the searchAgents function.
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

      const narrative = agentState.twitter[twitterJobId].Narrative.narrative;

      const avatar = agentState.twitter[twitterJobId].Avatar;
      if (!avatar || avatar.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      const serviceRequirements = JSON.stringify({
        narrative: narrative.narrative,
        video_recommendations: narrative.video_recommendations,
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

      store.setJob(twitterJobId, "Video", {
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
      "Initiate a job with an agent that provides a meme based on the narrative.",
    args: [
      {
        name: "reasoning",
        type: "string",
        description: "The reasoning for the meme generation",
      },
    ],
    executable: async (args) => {
      const agentState = await store.getAgentState(acpPlugin);
      const twitterJobId = Object.keys(agentState.twitter)[0];

      if (!twitterJobId || !agentState.twitter[twitterJobId]?.User) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No user job found to process",
        );
      }

      if (
        agentState.twitter[twitterJobId]?.Avatar?.status !== "COMPLETED" ||
        agentState.twitter[twitterJobId]?.Narrative?.status !== "COMPLETED"
      ) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar or narrative are not yet completed",
        );
      }

      const memeJob = agentState.twitter[twitterJobId]?.Meme;
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
        goal: "Initiate a job with an agent that provides a meme based on the narrative.",
        description: `
        You are an agent that initiates a job with an agent that provides a meme based on the narrative.

        1. Search for an agent that can create memes based on the narrative using the searchAgents function.
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

      const narrative = agentState.twitter[twitterJobId].Narrative.narrative;

      const avatar = agentState.twitter[twitterJobId].Avatar;
      if (!avatar || avatar.status !== "COMPLETED") {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar is not yet completed",
        );
      }

      const serviceRequirements = JSON.stringify({
        meme_recommendations: narrative.meme_recommendations,
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

      store.setJob(twitterJobId, "Meme", {
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
      const twitterJobId = Object.keys(agentState.twitter)[0];

      if (!twitterJobId || !agentState.twitter[twitterJobId]?.User) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "No user job found to process",
        );
      }

      if (
        agentState.twitter[twitterJobId]?.Avatar?.status !== "COMPLETED" ||
        agentState.twitter[twitterJobId]?.Video?.status !== "COMPLETED" ||
        agentState.twitter[twitterJobId]?.Meme?.status !== "COMPLETED"
      ) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "Avatar, video or meme are not yet completed",
        );
      }

      const assetJob = agentState.twitter[twitterJobId]?.Asset;
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

      const video = agentState.twitter[twitterJobId].Video;
      const meme = agentState.twitter[twitterJobId].Meme;
      const avatar = agentState.twitter[twitterJobId].Avatar;
      const user = agentState.twitter[twitterJobId].User;

      const serviceRequirements = JSON.stringify({
        avatar_url: avatar.url,
        video_url: video.url,
        meme_url: meme.url,
        user_wallet_address: user.wallet_address,
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

      store.setJob(twitterJobId, "Asset", {
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
