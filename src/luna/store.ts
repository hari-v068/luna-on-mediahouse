import { createClient } from "@supabase/supabase-js";
import { JobRecord, State } from "./types";
import fs from "fs";
import path from "path";

const stateFilePath = path.join(process.cwd(), "src/database/luna.db.json");

type Domain = "Twitter" | "Strategy" | "Avatar" | "Video" | "Meme" | "Asset";

interface CompletedJobData {
  tokenName: string;
  narrative: string;
  goToMarketStrategy: string;
  avatarMediaUrl: string;
  avatarMintingUrl: string;
  memeMediaUrl: string;
  memeMintingUrl: string;
  videoMediaUrl: string;
  videoMintingUrl: string;
}

export class Store {
  private supabaseClient;

  constructor() {
    this.supabaseClient = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_KEY as string,
    );
  }

  private async readState(): Promise<State> {
    try {
      if (!fs.existsSync(stateFilePath)) {
        fs.writeFileSync(stateFilePath, JSON.stringify({}), "utf-8");
        return {};
      }
      const stateData = fs.readFileSync(stateFilePath, "utf-8");
      return stateData.trim() === "" ? {} : JSON.parse(stateData);
    } catch (error) {
      console.error("Error reading state:", error);
      return {};
    }
  }

  private async writeState(state: State): Promise<void> {
    try {
      fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error("Error writing state:", error);
    }
  }

  async getActiveJobFromSupabase(): Promise<{
    twitter_job_id: string;
    job_details: any;
    wallet_address: string;
  } | null> {
    try {
      const { data: activeJobDetails, error: activeJobDetailsError } =
        await this.supabaseClient.rpc("get_oldest_active_job");

      if (activeJobDetailsError) {
        console.error("Error fetching from Supabase:", activeJobDetailsError);
        return null;
      }

      return activeJobDetails;
    } catch (error) {
      console.error("Error in getActiveJobFromSupabase:", error);
      return null;
    }
  }

  async addNewJob(
    jobId: string,
    jobDetails: any,
    walletAddress: string,
  ): Promise<void> {
    const currentState = await this.readState();

    // Only add if it doesn't exist
    if (!currentState[jobId]) {
      const newUserJob: JobRecord = {
        status: "PENDING",
        value: jobDetails,
        wallet_address: walletAddress,
      };

      const updatedState = {
        ...currentState,
        [jobId]: {
          Twitter: newUserJob,
        },
      };

      await this.writeState(updatedState);
    }
  }

  async setJob(jobId: string, domain: Domain, job: JobRecord): Promise<void> {
    const currentState = await this.readState();
    const updatedState = {
      ...currentState,
      [jobId]: {
        ...currentState[jobId],
        [domain]: job,
      },
    };
    await this.writeState(updatedState);
  }

  async fetchStrategy(acpState: any): Promise<void> {
    const state = await this.readState();
    const projectId = Object.keys(state)[0];

    const completedStrategyJob = acpState.jobs.completed.find(
      (job: { jobId: number }) =>
        job.jobId === state[projectId].Strategy.acpJobId,
    );

    if (completedStrategyJob) {
      const strategyJson = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedStrategyJob.jobId && item.type === "json",
      );

      if (strategyJson) {
        const strategy = JSON.parse(strategyJson.value);
        await this.setJob(projectId, "Strategy", {
          status: "COMPLETED",
          value: strategy,
        });
      }
    }
  }

  async fetchVideo(acpState: any): Promise<void> {
    const state = await this.readState();
    const projectId = Object.keys(state)[0];

    // Find the completed job that matches our stored ACP job ID
    const completedVideoJob = acpState.jobs.completed.find(
      (job: { jobId: number }) => job.jobId === state[projectId].Video.acpJobId,
    );

    if (completedVideoJob) {
      // Find the URL for this specific job in inventory
      const videoUrl = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedVideoJob.jobId && item.type === "url",
      );

      if (videoUrl) {
        await this.setJob(projectId, "Video", {
          status: "COMPLETED",
          url: videoUrl.value,
        });
      }
    }
  }

  async fetchMeme(acpState: any): Promise<void> {
    const state = await this.readState();
    const projectId = Object.keys(state)[0];

    // Find the completed job that matches our stored ACP job ID
    const completedMemeJob = acpState.jobs.completed.find(
      (job: { jobId: number }) => job.jobId === state[projectId].Meme.acpJobId,
    );

    if (completedMemeJob) {
      // Find the URL for this specific job in inventory
      const memeUrl = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedMemeJob.jobId && item.type === "url",
      );

      if (memeUrl) {
        await this.setJob(projectId, "Meme", {
          status: "COMPLETED",
          url: memeUrl.value,
        });
      }
    }
  }

  async fetchAsset(acpState: any): Promise<void> {
    const state = await this.readState();
    const projectId = Object.keys(state)[0];

    // Find the completed job that matches our stored ACP job ID
    const completedAssetJob = acpState.jobs.completed.find(
      (job: { jobId: number }) => job.jobId === state[projectId].Asset.acpJobId,
    );

    if (completedAssetJob) {
      // Find the JSON for this specific job in inventory
      const assetJson = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedAssetJob.jobId && item.type === "json",
      );

      if (assetJson) {
        const assetValue = JSON.parse(assetJson.value);

        await this.setJob(projectId, "Asset", {
          status: "COMPLETED",
          url: {
            avatar: assetValue.avatar,
            video: assetValue.video,
            meme: assetValue.meme,
          },
        });

        // Mark the Twitter job as completed since this is the final step
        await this.setJob(projectId, "Twitter", {
          ...state[projectId].Twitter,
          status: "COMPLETED",
        });
      }
    }
  }

  private async pushCompletedJobToDatabase(
    projectId: string,
    state: State,
  ): Promise<void> {
    const job = state[projectId];
    if (!job) return;

    const completedJobData: CompletedJobData = {
      tokenName: job.Twitter.value.token_name,
      narrative: job.Strategy.value.narrative,
      goToMarketStrategy: job.Strategy.value.gtm_strategy,
      avatarMediaUrl: job.Avatar.url,
      avatarMintingUrl: job.Asset.url.avatar,
      memeMediaUrl: job.Meme.url,
      memeMintingUrl: job.Asset.url.meme,
      videoMediaUrl: job.Video.url,
      videoMintingUrl: job.Asset.url.video,
    };

    await this.supabaseClient
      .from("agent_state")
      .update({
        twitter_completed_job: completedJobData,
      })
      .eq("twitter_job_id", projectId)
      .throwOnError();
  }

  private async isAllJobsCompleted(
    state: State,
    projectId: string,
  ): Promise<boolean> {
    const job = state[projectId];
    if (!job) return false;

    const requiredDomains: Domain[] = [
      "Twitter",
      "Strategy",
      "Avatar",
      "Video",
      "Meme",
      "Asset",
    ];
    return requiredDomains.every(
      (domain) => job[domain]?.status === "COMPLETED",
    );
  }

  private async clearDatabase(): Promise<void> {
    try {
      console.log("CLEARING DATABASE");
      for (let i = 5; i > 0; i--) {
        console.log(`${i}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await this.writeState({});
    } catch (error) {
      console.error("Error clearing database:", error);
    }
  }

  async getAgentState(acpPlugin?: any): Promise<{ project: State; acp: any }> {
    const state = await this.readState();

    // Only check Supabase if database is empty
    if (!state || Object.keys(state).length === 0) {
      const activeJob = await this.getActiveJobFromSupabase();
      if (activeJob) {
        await this.addNewJob(
          activeJob.twitter_job_id,
          activeJob.job_details,
          activeJob.wallet_address,
        );
      }
    }

    const acpState = acpPlugin ? await acpPlugin.getAcpState() : {};

    if (acpPlugin) {
      const projectId = Object.keys(state)[0];

      // Only proceed if we have a twitter job
      if (projectId && state[projectId]?.Twitter) {
        // Only check strategy if we have a pending strategy job
        if (state[projectId]?.Strategy?.status === "PENDING") {
          await this.fetchStrategy(acpState);
        }

        // Only check video if we have a completed avatar, narrative and pending video job
        if (
          state[projectId]?.Avatar?.status === "COMPLETED" &&
          state[projectId]?.Strategy?.status === "COMPLETED" &&
          state[projectId]?.Video?.status === "PENDING"
        ) {
          await this.fetchVideo(acpState);
        }

        // Only check meme if we have a completed avatar, narrative and pending meme job
        if (
          state[projectId]?.Avatar?.status === "COMPLETED" &&
          state[projectId]?.Strategy?.status === "COMPLETED" &&
          state[projectId]?.Meme?.status === "PENDING"
        ) {
          await this.fetchMeme(acpState);
        }

        // Only check token if we have completed avatar, video and meme jobs
        if (
          state[projectId]?.Avatar?.status === "COMPLETED" &&
          state[projectId]?.Video?.status === "COMPLETED" &&
          state[projectId]?.Meme?.status === "COMPLETED" &&
          state[projectId]?.Asset?.status === "PENDING"
        ) {
          await this.fetchAsset(acpState);
        }

        if (await this.isAllJobsCompleted(state, projectId)) {
          await this.pushCompletedJobToDatabase(projectId, state);
          await this.clearDatabase();
        }
      }
    }

    return {
      project: await this.readState(),
      acp: acpState,
    };
  }

  async getJob(jobId: string, domain: Domain): Promise<JobRecord | undefined> {
    const state = await this.readState();
    return state[jobId]?.[domain];
  }
}
