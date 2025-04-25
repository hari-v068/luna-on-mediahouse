export type JobStatus = "PENDING" | "COMPLETED" | "FAILED";

export type JobRecord = {
  status: JobStatus;
  [key: string]: any;
};

export type State = {
  [twitterJobId: string]: {
    [agentName: string]: JobRecord;
  };
};
