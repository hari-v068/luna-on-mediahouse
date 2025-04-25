import { createClient } from "@supabase/supabase-js";
import { JobRecord, State } from "./types";
import fs from "fs";
import path from "path";

const stateFilePath = path.join(process.cwd(), "src/database/state.json");

type Domain = "User" | "Narrative" | "Avatar" | "Video" | "Meme" | "Token";

export class Store {
  private supabaseClient;
  private state: State = {};

  constructor() {
    this.supabaseClient = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_KEY as string,
    );
    this.loadState();
  }

  private loadState() {
    try {
      if (!fs.existsSync(stateFilePath)) {
        fs.writeFileSync(stateFilePath, JSON.stringify({}), "utf-8");
      }
      const stateData = fs.readFileSync(stateFilePath, "utf-8");
      this.state = stateData.trim() === "" ? {} : JSON.parse(stateData);
    } catch (error) {
      console.error("Error loading state:", error);
      this.state = {};
    }
  }

  private saveState() {
    try {
      fs.writeFileSync(stateFilePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error("Error saving state:", error);
    }
  }

  async fetchAndUpdateActiveJob(): Promise<State> {
    try {
      const { data: activeJobDetails, error: activeJobDetailsError } =
        await this.supabaseClient.rpc("get_oldest_active_job");

      if (activeJobDetailsError) {
        console.error("Error fetching from Supabase:", activeJobDetailsError);
        return this.state;
      }

      if (!activeJobDetails) {
        return this.state;
      }

      const jobId = activeJobDetails.twitter_job_id;

      // Only create new state if it doesn't exist
      if (!this.state[jobId]) {
        const cleanJobDetails = activeJobDetails.job_details
          .replace(/\\n/g, "")
          .replace(/\\"/g, '"')
          .replace(/^"|"$/g, "");

        const parsedJobDetails = JSON.parse(cleanJobDetails);
        const { price, paid, wallet_address, ...jobDetails } = parsedJobDetails;

        const newUserJob: JobRecord = {
          status: "PENDING",
          twitter_active_job: jobDetails,
          wallet_address,
        };

        this.state[jobId] = {
          User: newUserJob,
        };

        this.saveState();
      }

      return this.state;
    } catch (error) {
      console.error("Error in fetchAndUpdateActiveJob:", error);
      return this.state;
    }
  }

  async addJob(jobId: string, domain: Domain, job: JobRecord): Promise<void> {
    const currentState = await this.fetchAndUpdateActiveJob();

    // Update the state with the new job
    this.state = {
      ...currentState,
      [jobId]: {
        ...currentState[jobId],
        [domain]: job,
      },
    };

    this.saveState();
  }

  async updateNarrativeFromAcp(acpState: any): Promise<void> {
    const state = await this.fetchAndUpdateActiveJob();
    const twitterJobId = Object.keys(state)[0];

    const latestNarrative = acpState.inventory.acquired
      .filter(
        (item: { type: string; jobId: number; value: string }) =>
          item.type === "text",
      )
      .reduce(
        (
          latest: { jobId: number; value: string },
          current: { jobId: number; value: string },
        ) => (current.jobId > latest.jobId ? current : latest),
        acpState.inventory.acquired[0],
      );

    if (latestNarrative) {
      // Clean the JSON string before storing
      const cleanedNarrative = latestNarrative.value
        .replace(/\\"/g, '"')
        .replace(/^"|"$/g, "")
        .replace(/\\n/g, "\n");

      await this.addJob(twitterJobId, "Narrative", {
        status: "COMPLETED",
        narrative: cleanedNarrative,
        sellerWalletAddress: state[twitterJobId].Narrative.sellerWalletAddress,
      });
    }
  }

  async updateVideoFromAcp(acpState: any): Promise<void> {
    const state = await this.fetchAndUpdateActiveJob();
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
        await this.addJob(twitterJobId, "Video", {
          status: "COMPLETED",
          url: videoUrl.value,
          sellerWalletAddress: state[twitterJobId].Video.sellerWalletAddress,
        });
      }
    }
  }

  async updateMemeFromAcp(acpState: any): Promise<void> {
    const state = await this.fetchAndUpdateActiveJob();
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
        await this.addJob(twitterJobId, "Meme", {
          status: "COMPLETED",
          url: memeUrl.value,
          sellerWalletAddress: state[twitterJobId].Meme.sellerWalletAddress,
        });
      }
    }
  }

  async updateTokenFromAcp(acpState: any): Promise<void> {
    const state = await this.fetchAndUpdateActiveJob();
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

      await this.addJob(twitterJobId, "Token", {
        status: "COMPLETED",
        token: {
          avatar_url: avatarUrl.trim(),
          video_url: videoUrl.trim(),
          meme_url: memeUrl.trim(),
        },
        sellerWalletAddress: state[twitterJobId].Token.sellerWalletAddress,
      });
    }
  }

  async getAgentState(acpPlugin?: any): Promise<{ twitter: State; acp: any }> {
    const state = await this.fetchAndUpdateActiveJob();
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
      }
    }

    return {
      twitter: state,
      acp: acpState,
    };
  }

  getState(): State {
    return this.state;
  }

  getJob(jobId: string, domain: Domain): JobRecord | undefined {
    return this.state[jobId]?.[domain];
  }
}
