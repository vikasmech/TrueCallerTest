export const NOTICE_VERSION = process.env.NEXT_PUBLIC_NOTICE_VERSION ?? "2026-10-v1";

export const LABEL_TEXT: Record<string, string> = {
  insufficient_reports: "Unknown / insufficient reports",
  some_suspicious_reports: "Some suspicious reports",
  elevated_community_risk_signal: "Elevated community risk signal",
  strong_community_risk_signal: "Strong community risk signal",
};

export const BAND_TEXT: Record<string, string> = {
  fewer_than_3_recent_eligible_reporters: "fewer than 3 recent reporters",
  "3_to_4_recent_eligible_reporters": "3–4 recent reporters",
  "5_to_9_recent_eligible_reporters": "5–9 recent reporters",
  "10_or_more_recent_eligible_reporters": "10 or more recent reporters",
};
