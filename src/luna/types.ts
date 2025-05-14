export type JobStatus = "PENDING" | "COMPLETED" | "FAILED";

export type JobRecord = {
  status: JobStatus;
  acpRef?: number;
  [key: string]: any;
};

export type State = {
  [project: string]: {
    [domain: string]: JobRecord;
  };
};
