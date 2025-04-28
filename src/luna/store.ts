import { createClient } from "@supabase/supabase-js";
import { JobRecord, State } from "./types";
import fs from "fs";
import path from "path";

const stateFilePath = path.join(process.cwd(), "src/database/luna.db.json");

type Domain = "User" | "Narrative" | "Avatar" | "Video" | "Meme" | "Token";

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
        job_details: jobDetails,
        wallet_address: walletAddress,
      };

      const updatedState = {
        ...currentState,
        [jobId]: {
          User: newUserJob,
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

  async updateNarrativeFromAcp(acpState: any): Promise<void> {
    const state = await this.readState();
    const twitterJobId = Object.keys(state)[0];

    // Find the completed job that has token_name in its description
    const completedNarrativeJob = acpState.jobs.completed.find(
      (job: { desc: string }) => {
        try {
          const desc = JSON.parse(job.desc);
          return (
            desc.token_name === state[twitterJobId].User.job_details.token_name
          );
        } catch {
          return false;
        }
      },
    );

    if (completedNarrativeJob) {
      // Find the json for this specific job in inventory
      const narrativeJson = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedNarrativeJob.jobId && item.type === "json",
      );

      if (narrativeJson) {
        const narrativeValue = JSON.parse(narrativeJson.value);
        // Parse the avatar_recommendations string into an object
        narrativeValue.avatar_recommendations = JSON.parse(
          narrativeValue.avatar_recommendations,
        );

        await this.setJob(twitterJobId, "Narrative", {
          status: "COMPLETED",
          narrative: narrativeValue,
        });
      }
    }
  }

  async updateVideoFromAcp(acpState: any): Promise<void> {
    const state = await this.readState();
    const twitterJobId = Object.keys(state)[0];

    // Find any completed video job by checking for the string
    const completedVideoJob = acpState.jobs.completed.find(
      (job: { desc: string }) => job.desc.includes("video_recommendations"),
    );

    if (completedVideoJob) {
      // Find the URL for this specific job in inventory
      const videoUrl = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedVideoJob.jobId && item.type === "url",
      );

      if (videoUrl) {
        await this.setJob(twitterJobId, "Video", {
          status: "COMPLETED",
          url: videoUrl.value,
          sellerWalletAddress: state[twitterJobId].Video.sellerWalletAddress,
        });
      }
    }
  }

  async updateMemeFromAcp(acpState: any): Promise<void> {
    const state = await this.readState();
    const twitterJobId = Object.keys(state)[0];

    // Find any completed meme job by checking for the string
    const completedMemeJob = acpState.jobs.completed.find(
      (job: { desc: string }) => job.desc.includes("meme_recommendations"),
    );

    if (completedMemeJob) {
      // Find the URL for this specific job in inventory
      const memeUrl = acpState.inventory.acquired.find(
        (item: { jobId: number; type: string }) =>
          item.jobId === completedMemeJob.jobId && item.type === "url",
      );

      if (memeUrl) {
        await this.setJob(twitterJobId, "Meme", {
          status: "COMPLETED",
          url: memeUrl.value,
          sellerWalletAddress: state[twitterJobId].Meme.sellerWalletAddress,
        });
      }
    }
  }

  private async pushCompletedJobToDatabase(
    twitterJobId: string,
    state: State,
  ): Promise<void> {
    const job = state[twitterJobId];
    if (!job) return;

    const completedJobData: CompletedJobData = {
      tokenName: job.User.job_details.token_name,
      narrative: job.Narrative.narrative.narrative,
      goToMarketStrategy: job.Narrative.narrative.gtm_strategy,
      avatarMediaUrl: job.Avatar.url,
      avatarMintingUrl: job.Avatar.mintingUrl,
      memeMediaUrl: job.Meme.url,
      memeMintingUrl: job.Meme.mintingUrl,
      videoMediaUrl: job.Video.url,
      videoMintingUrl: job.Video.mintingUrl,
    };

    await this.supabaseClient
      .from("agent_state")
      .update({
        twitter_completed_job: completedJobData,
      })
      .eq("twitter_job_id", twitterJobId)
      .throwOnError();
  }

  async updateTokenFromAcp(acpState: any): Promise<void> {
    const state = await this.readState();
    const twitterJobId = Object.keys(state)[0];

    const latestToken = acpState.inventory.acquired
      .filter(
        (item: { type: string; jobId: number; value: string }) =>
          item.type === "url",
      )
      .reduce(
        (
          latest: { jobId: number; value: string },
          current: { jobId: number; value: string },
        ) => (current.jobId > latest.jobId ? current : latest),
        acpState.inventory.acquired[0],
      );

    if (latestToken) {
      // Split the comma-separated URLs
      const [avatarUrl, videoUrl, memeUrl] = latestToken.value.split(",");

      await this.setJob(twitterJobId, "Token", {
        status: "COMPLETED",
        token: {
          avatar_url: avatarUrl.trim(),
          video_url: videoUrl.trim(),
          meme_url: memeUrl.trim(),
        },
        sellerWalletAddress: state[twitterJobId].Token.sellerWalletAddress,
      });

      // Mark the User job as completed since this is the final step
      await this.setJob(twitterJobId, "User", {
        ...state[twitterJobId].User,
        status: "COMPLETED",
      });

      // Push completed job data to database
      await this.pushCompletedJobToDatabase(twitterJobId, state);
    }
  }

  private async isAllJobsCompleted(
    state: State,
    twitterJobId: string,
  ): Promise<boolean> {
    const job = state[twitterJobId];
    if (!job) return false;

    const requiredDomains: Domain[] = [
      "User",
      "Narrative",
      "Avatar",
      "Video",
      "Meme",
      "Token",
    ];
    return requiredDomains.every(
      (domain) => job[domain]?.status === "COMPLETED",
    );
  }

  private async clearDatabase(): Promise<void> {
    try {
      await this.writeState({});
    } catch (error) {
      console.error("Error clearing database:", error);
    }
  }

  async getAgentState(acpPlugin?: any): Promise<{ twitter: State; acp: any }> {
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
      const twitterJobId = Object.keys(state)[0];

      // Only proceed if we have a user job
      if (twitterJobId && state[twitterJobId]?.User) {
        // Only check narrative if we have a pending narrative job
        if (state[twitterJobId]?.Narrative?.status === "PENDING") {
          await this.updateNarrativeFromAcp(acpState);
        }

        // Only check video if we have a completed avatar, narrative and pending video job
        if (
          state[twitterJobId]?.Avatar?.status === "COMPLETED" &&
          state[twitterJobId]?.Narrative?.status === "COMPLETED" &&
          state[twitterJobId]?.Video?.status === "PENDING"
        ) {
          await this.updateVideoFromAcp(acpState);
        }

        // Only check meme if we have a completed avatar, narrative and pending meme job
        if (
          state[twitterJobId]?.Avatar?.status === "COMPLETED" &&
          state[twitterJobId]?.Narrative?.status === "COMPLETED" &&
          state[twitterJobId]?.Meme?.status === "PENDING"
        ) {
          await this.updateMemeFromAcp(acpState);
        }

        // Only check token if we have completed avatar, video and meme jobs
        if (
          state[twitterJobId]?.Avatar?.status === "COMPLETED" &&
          state[twitterJobId]?.Video?.status === "COMPLETED" &&
          state[twitterJobId]?.Meme?.status === "COMPLETED" &&
          state[twitterJobId]?.Token?.status === "PENDING"
        ) {
          await this.updateTokenFromAcp(acpState);
        }

        if (await this.isAllJobsCompleted(state, twitterJobId)) {
          await this.clearDatabase();
        }
      }
    }

    return {
      twitter: await this.readState(),
      acp: acpState,
    };
  }

  async getJob(jobId: string, domain: Domain): Promise<JobRecord | undefined> {
    const state = await this.readState();
    return state[jobId]?.[domain];
  }
}
