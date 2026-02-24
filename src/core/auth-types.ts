export type SubscriptionSummary = {
  id: string;
  type: "solo" | "team";
  status: string;
  seatCount: number | null;
  teamId: string | null;
  currentPeriodEnd: string | null;
};

export type AuthenticatedUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  subscriptions: SubscriptionSummary[];
};

export type AuthResult = {
  accessToken: string;
  expiresAt: string;
  user: AuthenticatedUser;
};

export type OtpRequestResult = {
  ok: true;
  expiresAt: string;
  otp?: string;
};

export type GithubDeviceStartResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: string;
  interval: number;
};

export type GithubDevicePollResult =
  | { status: "pending"; interval: number }
  | { status: "slow_down"; interval: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; auth: AuthResult };

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: AuthenticatedUser;
};
